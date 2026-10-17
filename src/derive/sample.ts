// Random points: one Env per trial, with every declared symbol drawn from its domain. Seeded, so a check is
// reproducible and the false-reject sweep can vary the seed.
import { symbolsOf } from "./ast";
import { type Env, evaluate, type Val } from "./evaluate";
import { EvalError, inverse, isMat, isSymmetric, type Mat, mulM, transpose, zeros } from "./linalg";
import type { Domain, SymbolTable } from "./symbols";

export type Rng = () => number;

/** mulberry32: small, fast, good enough for sampling. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const uniform = (r: Rng, lo: number, hi: number) => lo + (hi - lo) * r();
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

/** Typical magnitudes, not the whole domain: points far out (k = 1e9) test nothing a student writes and lose
 *  precision. Root finding still searches the whole domain. */
export function sampleScalar(d: Domain, r: Rng): number {
  switch (d.kind) {
    case "positive":
      return Math.exp(uniform(r, Math.log(0.25), Math.log(4)));
    case "real":
      return uniform(r, -4, 4);
    case "range":
      return uniform(r, d.lo + 0.02 * (d.hi - d.lo), d.hi - 0.02 * (d.hi - d.lo));
  }
}

function sampleDatum(d: Domain, r: Rng): number {
  switch (d.kind) {
    case "positive":
      return uniform(r, 0.5, 10);
    case "real":
      return uniform(r, -5, 5);
    case "range":
      return uniform(r, d.lo, d.hi);
  }
}

/** A random r×c matrix with full rank and a reasonable condition number (entries in (−1, 1)). */
function randomMatrix(rows: number, cols: number, r: Rng): Mat {
  for (let attempt = 0; attempt < 20; attempt++) {
    const m = zeros(rows, cols);
    for (let i = 0; i < m.d.length; i++) m.d[i] = uniform(r, -1, 1);
    try {
      const gram = rows >= cols ? mulM(transpose(m), m) : mulM(m, transpose(m));
      const inv = inverse(gram);
      if (frobRatio(gram, inv) < 1e6) return m;
    } catch (e) {
      if (!(e instanceof EvalError)) throw e;
    }
  }
  throw new Error("couldn't draw a full-rank matrix");
}

function frobRatio(a: Mat, b: Mat): number {
  let sa = 0;
  let sb = 0;
  for (const v of a.d) sa += v * v;
  for (const v of b.d) sb += v * v;
  return Math.sqrt(sa * sb);
}

export interface SampleOptions {
  /** Perturb definitions: "leaf" the innermost ones (see `relaxable`), "all" every one independently. */
  relax?: "leaf" | "all";
}

/** Definitions that use no other definition: P = X(X'X)⁻¹X' when M = I − P is defined through it. Relaxing these
 *  (adding a random perturbation, symmetric if the value is symmetric) turns identities like MX = 0 into ordinary
 *  equations, so two true statements can be told apart by how they fail. Statements that still hold (MX = X − PX
 *  is true for any P once M = I − P) are told apart by relaxing every definition. */
export function relaxable(table: SymbolTable, level: "leaf" | "all"): Set<string> {
  const defs = table.ofKind("defined");
  if (level === "all") return new Set(defs.map((s) => s.key));
  const defined = new Set(defs.map((s) => s.key));
  return new Set(defs.filter((s) => ![...symbolsOf(s.def!)].some((k) => defined.has(k))).map((s) => s.key));
}

export function sampleEnv(table: SymbolTable, r: Rng, opts: SampleOptions = {}): Env {
  const vals = new Map<string, Val>();
  const dims = table.ofKind("dim");
  for (const d of dims.filter((d) => !d.gt)) vals.set(d.key, int(r, d.min ?? 2, d.max ?? 5));
  for (const d of dims.filter((d) => d.gt)) vals.set(d.key, (vals.get(d.gt!) as number) + int(r, d.min ?? 2, d.max ?? 6));
  const dataDim = table.ofKind("data")[0]?.size;
  const n = dataDim ? (vals.get(dataDim) as number) : int(r, 5, 12);

  for (const s of table.ofKind("scalar")) vals.set(s.key, sampleScalar(s.domain, r));
  const data = new Map<string, Float64Array>();
  for (const s of table.ofKind("data")) data.set(s.key, Float64Array.from({ length: n }, () => sampleDatum(s.domain, r)));
  for (const s of table.ofKind("mean")) {
    const xs = data.get(s.of!)!;
    vals.set(s.key, xs.reduce((a, b) => a + b, 0) / n);
  }
  for (const s of table.ofKind("matrix")) vals.set(s.key, randomMatrix(vals.get(s.rows!) as number, vals.get(s.cols!) as number, r));

  const env: Env = { vals, data, n, idx: -1 };
  const relax = opts.relax ? relaxable(table, opts.relax) : new Set<string>();
  for (const s of table.ofKind("defined")) {
    let v = evaluate(s.def!, env, table);
    if (relax.has(s.key)) v = perturb(v, r);
    vals.set(s.key, v);
  }
  return env;
}

function perturb(v: Val, r: Rng): Val {
  if (typeof v === "number") return v + (1 + Math.abs(v)) * uniform(r, 0.3, 1);
  if (!isMat(v)) return v;
  const sym = isSymmetric(v);
  const m = zeros(v.r, v.c);
  for (let i = 0; i < v.r; i++)
    for (let j = 0; j < v.c; j++) {
      if (sym && j < i) m.d[i * v.c + j] = m.d[j * v.c + i]!;
      else m.d[i * v.c + j] = v.d[i * v.c + j]! + uniform(r, -1, 1);
    }
  return m;
}
