// Numeric equivalence. Nothing here manipulates algebra: statements are evaluated at random points, so how the
// student arranged the line doesn't matter.
//
//  - Expressions are equal if they agree at every sampled point (to a tolerance scaled by rounding, see evaluate.ts).
//  - Equations are equivalent if they hold on the same set. For random values of everything else, both are solved
//    for one variable (the step's unknown if it appears) by scanning its whole domain for sign changes and bisecting;
//    each root of one must satisfy the other. This accepts rearranging, multiplying both sides by a nonzero factor
//    and taking logs, and rejects anything that moves a root.
//  - Identities (true at every point, like MX = 0 once M is defined) are compared by relaxing the innermost
//    definition and checking the two residuals are proportional (fold.ts explains why).
//  - Equations with no scalar to solve for (matrix statements that are false) are compared by residual
//    proportionality at the true definitions.
import { type Equation, isEquation, type Node, type Statement, symbolsOf } from "./ast";
import { entries, type Env, residual, residualMag, type Val, valueMag } from "./evaluate";
import { foldDefinitions, sameStatement } from "./fold";
import { EvalError } from "./linalg";
import { rng, type Rng, sampleEnv, sampleScalar } from "./sample";
import type { Domain, SymbolTable } from "./symbols";

export type Regime = "structural" | "expression" | "relation" | "identity" | "proportional";

export interface Equivalence {
  equivalent: boolean;
  regime: Regime;
  /** Why the candidate couldn't be evaluated (shapes, singular inverse, NaN everywhere), if that's the reason. */
  problem?: string;
  /** For equations that aren't equivalent: the candidate's solutions include all the reference's and more ("wider"),
   *  or only some of them ("narrower"). */
  direction?: "wider" | "narrower";
  /** For a one-sided step: a value of the solve variable, the same at every sampled point, that the candidate
   *  adds ("wider") or loses ("narrower"), e.g. the k̄ = 2 that multiplying by (k̄ − 2) adds. */
  at?: { symbol: string; value: number };
}

export interface EquivalenceOptions {
  seed?: number;
  /** Conclusive random points required (default 10). */
  trials?: number;
  /** Variables to prefer when solving an equation, in order (the derivation's unknowns). */
  solveFor?: string[];
}

/** A residual is zero when it is below this fraction of its rounding scale. Equivalent forms land around 1e-14;
 *  wrong ones around 1e-1. */
const TOL = 1e-7;
const DEFAULT_TRIALS = 10;

export function equivalent(cand: Statement, ref: Statement, table: SymbolTable, opts: EquivalenceOptions = {}): Equivalence {
  if (sameStatement(cand, ref, table)) return { equivalent: true, regime: "structural" };
  const seed = opts.seed ?? 1;
  const trials = opts.trials ?? DEFAULT_TRIALS;
  if (!isEquation(cand) && !isEquation(ref)) return expressionEquivalent(cand, ref, table, seed, trials);
  if (isEquation(cand) !== isEquation(ref))
    return { equivalent: false, regime: "structural", problem: isEquation(ref) ? "this step needs an equation (with =)" : "this step needs an expression, not an equation" };
  const c = cand as Equation;
  const r = ref as Equation;
  const pc = probe(c, table, seed);
  if (pc.problem) return { equivalent: false, regime: "structural", problem: pc.problem };
  const pr = probe(r, table, seed);
  if (pr.problem) return { equivalent: false, regime: "structural" };
  if (pr.identity) {
    if (!pc.identity) return { equivalent: false, regime: "identity" };
    if (!table.ofKind("defined").length) return { equivalent: true, regime: "identity" };
    const fc = foldDefinitions(c, table);
    const fr = foldDefinitions(r, table);
    let verdict = proportional(fc, fr, table, seed, trials, "leaf");
    if (verdict === "trivial") verdict = proportional(fc, fr, table, seed, trials, "all");
    return { equivalent: verdict !== "no", regime: "identity" };
  }
  if (pc.identity) return { equivalent: false, regime: "relation" };
  const v = solveVariable(c, r, table, opts.solveFor ?? table.unknowns);
  if (v && pc.scalar && pr.scalar) return relation(c, r, v, table, seed, trials);
  return { equivalent: proportional(c, r, table, seed, trials) !== "no", regime: "proportional" };
}

interface Probe {
  identity: boolean;
  scalar: boolean;
  problem?: string;
}

/** Evaluate at a few random points: does it hold everywhere, is it scalar, can it be evaluated at all? With `relax`,
 *  the definitions are perturbed first (sample.ts), so a statement true only because of them no longer holds. */
export function probe(eq: Equation, table: SymbolTable, seed: number, relax?: "leaf" | "all"): Probe {
  const r = rng(seed ^ 0x5bd1e995);
  let finite = 0;
  let zero = 0;
  let scalar = true;
  for (let t = 0; t < 8; t++) {
    let res: Val;
    let mag: number;
    try {
      [res, mag] = residualMag(eq, sampleEnv(table, r, relax ? { relax } : {}), table);
    } catch (e) {
      if (e instanceof EvalError) return { identity: false, scalar: false, problem: e.message };
      throw e;
    }
    const e = entries(res);
    if (e.r !== 1 || e.c !== 1) scalar = false;
    const size = maxAbs(e.d);
    if (!Number.isFinite(size) || !Number.isFinite(mag)) continue;
    finite++;
    if (size <= TOL * mag) zero++;
  }
  if (!finite) return { identity: false, scalar, problem: "couldn't evaluate this at any test point (a log or root of a negative, or a division by zero?)" };
  return { identity: zero === finite && finite >= 3, scalar };
}

function maxAbs(d: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < d.length; i++) {
    const v = Math.abs(d[i]!);
    if (!(v <= m)) m = v; // NaN propagates
  }
  return m;
}

function expressionEquivalent(a: Node, b: Node, table: SymbolTable, seed: number, trials: number): Equivalence {
  const r = rng(seed);
  let conclusive = 0;
  for (let attempt = 0; attempt < trials * 3 && conclusive < trials; attempt++) {
    const env = sampleEnv(table, r);
    let va: Val, ma: number, vb: Val, mb: number;
    try {
      [va, ma] = valueMag(a, env, table);
    } catch (e) {
      if (e instanceof EvalError) return { equivalent: false, regime: "expression", problem: e.message };
      throw e;
    }
    try {
      [vb, mb] = valueMag(b, env, table);
    } catch (e) {
      if (e instanceof EvalError) return { equivalent: false, regime: "expression" };
      throw e;
    }
    const ea = entries(va);
    const eb = entries(vb);
    if (ea.r !== eb.r || ea.c !== eb.c) return { equivalent: false, regime: "expression" };
    let worst = 0;
    for (let i = 0; i < ea.d.length; i++) worst = Math.max(worst, Math.abs(ea.d[i]! - eb.d[i]!));
    if (!Number.isFinite(worst) || !Number.isFinite(ma + mb)) continue;
    if (worst > TOL * (ma + mb)) return { equivalent: false, regime: "expression" };
    conclusive++;
  }
  if (conclusive < Math.min(3, trials)) return { equivalent: false, regime: "expression", problem: "couldn't evaluate this at enough test points" };
  return { equivalent: true, regime: "expression" };
}

/** The variable to solve for: the first unknown both statements use, else the first one the reference uses, else
 *  any scalar they share. */
export function solveVariable(c: Statement, r: Statement, table: SymbolTable, unknowns: string[]): string | undefined {
  const sc = symbolsOf(c);
  const sr = symbolsOf(r);
  const scalar = (k: string) => table.get(k)?.kind === "scalar";
  return (
    unknowns.find((u) => sr.has(u) && sc.has(u)) ??
    unknowns.find((u) => sr.has(u)) ??
    [...sr].find((k) => scalar(k) && sc.has(k)) ??
    [...sr].find(scalar)
  );
}

// ---- equations: same solution set -------------------------------------------------------------------------------

function logspace(lo: number, hi: number, perDecade: number): number[] {
  const out: number[] = [];
  for (let e = lo; e <= hi + 1e-9; e += 1 / perDecade) out.push(Math.pow(10, e));
  return out;
}

const POSITIVE_GRID = logspace(-12, 12, 6);
const REAL_GRID = [...logspace(-12, 12, 4).map((x) => -x).reverse(), 0, ...logspace(-12, 12, 4)];

function grid(d: Domain): number[] {
  switch (d.kind) {
    case "positive":
      return POSITIVE_GRID;
    case "real":
      return REAL_GRID;
    case "range": {
      const out: number[] = [];
      for (let i = 1; i < 120; i++) out.push(d.lo + ((d.hi - d.lo) * i) / 120);
      return out;
    }
  }
}

type Residual = (x: number) => number;

function scalarResidual(eq: Equation, env: Env, v: string, table: SymbolTable): Residual {
  return (x) => {
    env.vals.set(v, x);
    try {
      const res = residual(eq, env, table);
      return typeof res === "number" ? res : NaN;
    } catch (e) {
      if (e instanceof EvalError) return NaN;
      throw e;
    }
  };
}

function holdsAt(eq: Equation, env: Env, v: string, x: number, table: SymbolTable): boolean {
  env.vals.set(v, x);
  let res: Val, mag: number;
  try {
    [res, mag] = residualMag(eq, env, table);
  } catch (e) {
    if (e instanceof EvalError) return false;
    throw e;
  }
  if (typeof res !== "number" || !Number.isFinite(res) || !Number.isFinite(mag)) return false;
  if (Math.abs(res) <= TOL * mag) return true;
  // A steep residual can miss the tolerance at a root that is only accurate to the last bit: accept a sign change
  // across a tiny bracket, as long as the residual is still small (a pole also changes sign).
  if (Math.abs(res) > 1e-3 * mag) return false;
  const h = x === 0 ? 1e-12 : Math.abs(x) * 1e-10;
  const f = scalarResidual(eq, env, v, table);
  const lo = f(x - h);
  const hi = f(x + h);
  return lo * hi <= 0;
}

interface Roots {
  roots: number[];
  identity: boolean;
}

/** Every root in the domain, found as sign changes on a grid and refined by bisection (geometric when both ends
 *  share a sign, so roots near 1e-9 and 1e9 come out to full precision). Sign changes across poles are dropped. */
function roots(eq: Equation, env: Env, v: string, d: Domain, table: SymbolTable): Roots {
  const xs = grid(d);
  const f = scalarResidual(eq, env, v, table);
  const fs = xs.map(f);
  // Identity: holds at every point we can evaluate.
  const finiteAt = xs.map((_, i) => i).filter((i) => Number.isFinite(fs[i]!));
  if (finiteAt.length) {
    const probeAt = [0, 0.25, 0.5, 0.75, 1].map((q) => finiteAt[Math.floor(q * (finiteAt.length - 1))]!);
    if (probeAt.every((i) => Math.abs(fs[i]!) <= TOL * magAt(eq, env, v, xs[i]!, table))) return { roots: [], identity: true };
  }
  const out: number[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = fs[i]!;
    const b = fs[i + 1]!;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a === 0) {
      push(out, xs[i]!);
      continue;
    }
    if (a * b > 0 || b === 0) continue;
    let lo = xs[i]!;
    let hi = xs[i + 1]!;
    let flo = a;
    for (let it = 0; it < 200; it++) {
      const mid = lo > 0 && hi > 0 ? Math.sqrt(lo * hi) : lo < 0 && hi < 0 ? -Math.sqrt(lo * hi) : (lo + hi) / 2;
      if (mid <= lo || mid >= hi) break;
      const fm = f(mid);
      if (!Number.isFinite(fm)) break;
      if (fm === 0) {
        lo = hi = mid;
        break;
      }
      if (fm * flo < 0) hi = mid;
      else {
        lo = mid;
        flo = fm;
      }
    }
    const x = Math.abs(f(lo)) <= Math.abs(f(hi)) ? lo : hi;
    if (holdsAt(eq, env, v, x, table)) push(out, x);
  }
  if (fs.length && fs[fs.length - 1] === 0) push(out, xs[xs.length - 1]!);
  // A root of even multiplicity, like the one (k̄ − 2)² adds, touches zero without changing sign: look for it at
  // every local minimum of |f| and keep it if the minimum is a zero.
  for (let i = 1; i + 1 < xs.length; i++) {
    const [a, b, c] = [fs[i - 1]!, fs[i]!, fs[i + 1]!];
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || a * b <= 0 || b * c <= 0) continue;
    if (!(Math.abs(b) < Math.abs(a) && Math.abs(b) <= Math.abs(c))) continue;
    const x = minimizeAbs(f, xs[i - 1]!, xs[i + 1]!);
    if (holdsAt(eq, env, v, x, table)) push(out, x);
  }
  return { roots: out, identity: false };
}

/** Golden-section search for the minimum of |f| on [lo, hi] (geometric when the bracket is on one side of 0). */
function minimizeAbs(f: Residual, lo: number, hi: number): number {
  const geo = lo > 0 || hi < 0;
  const sign = hi < 0 ? -1 : 1;
  const to = (u: number) => (geo ? sign * Math.exp(u) : u);
  let a = geo ? Math.log(Math.abs(lo)) : lo;
  let b = geo ? Math.log(Math.abs(hi)) : hi;
  if (a > b) [a, b] = [b, a];
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = Math.abs(f(to(c)));
  let fd = Math.abs(f(to(d)));
  for (let it = 0; it < 100 && b - a > 1e-15 * Math.max(1, Math.abs(a)); it++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = Math.abs(f(to(c)));
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = Math.abs(f(to(d)));
    }
  }
  return to((a + b) / 2);
}

function magAt(eq: Equation, env: Env, v: string, x: number, table: SymbolTable): number {
  env.vals.set(v, x);
  try {
    return residualMag(eq, env, table)[1];
  } catch {
    return NaN;
  }
}

function push(out: number[], x: number): void {
  if (!out.some((y) => Math.abs(y - x) <= 1e-9 * Math.max(Math.abs(x), Math.abs(y), 1e-300))) out.push(x);
}

/** Roots of one equation at one sampled point. The point is fixed by (table, seed, attempt), so a candidate compared
 *  with the target, each step and each reject form, and a reference compared with every candidate, reuse their
 *  root scans: the scan is most of a check's time. Keyed by statement identity, so it lives as long as the
 *  statement does. */
const ROOTS = new WeakMap<SymbolTable, WeakMap<Equation, Map<string, Roots>>>();

function cachedRoots(eq: Equation, key: string, env: Env, v: string, d: Domain, table: SymbolTable): Roots {
  let byEq = ROOTS.get(table);
  if (!byEq) ROOTS.set(table, (byEq = new WeakMap()));
  let byKey = byEq.get(eq);
  if (!byKey) byEq.set(eq, (byKey = new Map()));
  let out = byKey.get(key);
  if (!out) byKey.set(key, (out = roots(eq, env, v, d, table)));
  return out;
}

function relation(c: Equation, r: Equation, v: string, table: SymbolTable, seed: number, trials: number): Equivalence {
  const rand = rng(seed);
  const domain = table.get(v)!.domain;
  let conclusive = 0;
  for (let attempt = 0; attempt < trials * 3 && conclusive < trials; attempt++) {
    const env = sampleEnv(table, rand);
    const key = `${seed}|${attempt}|${v}`;
    const rr = cachedRoots(r, key, env, v, domain, table);
    const rc = cachedRoots(c, key, env, v, domain, table);
    if (rr.identity || rc.identity) {
      if (rr.identity !== rc.identity) return { equivalent: false, regime: "relation" };
      conclusive++;
      continue;
    }
    if (!rr.roots.length && !rc.roots.length) continue;
    const refHolds = rr.roots.every((x) => holdsAt(c, env, v, x, table));
    const candHolds = rc.roots.every((x) => holdsAt(r, env, v, x, table));
    if (!refHolds || !candHolds) {
      // One-sided: the candidate keeps every solution but adds some (multiplied by something that can be zero), or
      // loses some (divided by it).
      const direction = refHolds && rr.roots.length ? "wider" : candHolds && rc.roots.length ? "narrower" : undefined;
      if (!direction) return { equivalent: false, regime: "relation" };
      const value = fixedOddRoot(c, r, v, direction, oddRoots(c, r, v, direction, rr, rc, env, table), table, rand);
      return { equivalent: false, regime: "relation", direction, ...(value !== undefined ? { at: { symbol: v, value } } : {}) };
    }
    conclusive++;
  }
  if (conclusive < Math.min(3, trials)) return { equivalent: false, regime: "relation", problem: "couldn't find points where these equations hold" };
  return { equivalent: true, regime: "relation" };
}

/** The roots one equation has and the other lacks: the candidate's extra roots ("wider") or the reference's lost
 *  ones ("narrower"). */
function oddRoots(c: Equation, r: Equation, v: string, direction: "wider" | "narrower", rr: Roots, rc: Roots, env: Env, table: SymbolTable): number[] {
  return direction === "wider" ? rc.roots.filter((x) => !holdsAt(r, env, v, x, table)) : rr.roots.filter((x) => !holdsAt(c, env, v, x, table));
}

/** An odd root that stays put when the other symbols are redrawn (k̄ = 2 from a factor (k̄ − 2)), if there is one:
 *  that is worth naming in the message. Roots that move with the parameters (from squaring) are not. */
function fixedOddRoot(c: Equation, r: Equation, v: string, direction: "wider" | "narrower", first: number[], table: SymbolTable, rand: Rng): number | undefined {
  const [has, lacks] = direction === "wider" ? [c, r] : [r, c];
  let keep = first;
  for (let t = 0; t < 3 && keep.length; t++) {
    const env = sampleEnv(table, rand);
    keep = keep.filter((x) => holdsAt(has, env, v, x, table) && !holdsAt(lacks, env, v, x, table));
  }
  const x = keep[0];
  if (x === undefined) return undefined;
  const nice = Math.round(x * 1e6) / 1e6;
  return Math.abs(nice - x) <= 1e-6 * Math.max(1, Math.abs(x)) ? nice : x;
}

// ---- residual proportionality -----------------------------------------------------------------------------------

/** Residual of `a` is a constant multiple of the residual of `b` (or of its transpose) at every sampled point.
 *  "trivial" when both residuals are zero everywhere (both statements still hold at this relaxation). */
function proportional(a: Statement, b: Statement, table: SymbolTable, seed: number, trials: number, relax?: "leaf" | "all"): "yes" | "no" | "trivial" {
  const r = rng(seed);
  let lambda: number | undefined;
  let transposed: boolean | undefined;
  let conclusive = 0;
  for (let attempt = 0; attempt < trials * 3 && conclusive < trials; attempt++) {
    const env = sampleEnv(table, r, relax ? { relax } : {});
    let ra: Val, ma: number, rb: Val, mb: number;
    try {
      [ra, ma] = valueMag(a, env, table);
      [rb, mb] = valueMag(b, env, table);
    } catch (e) {
      if (e instanceof EvalError) return "no";
      throw e;
    }
    const ea = entries(ra);
    const eb = entries(rb);
    const za = maxAbs(ea.d) <= TOL * ma;
    const zb = maxAbs(eb.d) <= TOL * mb;
    if (!Number.isFinite(maxAbs(ea.d)) || !Number.isFinite(maxAbs(eb.d))) continue;
    conclusive++;
    if (za && zb) continue;
    if (za !== zb) return "no";
    const fit = fitScale(ea, eb, ma, transposed);
    if (!fit) return "no";
    if (lambda === undefined) {
      lambda = fit.lambda;
      transposed = fit.transposed;
    } else if (Math.abs(fit.lambda - lambda) > 1e-6 * Math.abs(lambda)) return "no";
  }
  if (conclusive < Math.min(3, trials)) return "no";
  return lambda === undefined ? "trivial" : "yes";
}

type Flat = { r: number; c: number; d: ArrayLike<number> };

function fitScale(a: Flat, b: Flat, magA: number, transposed?: boolean): { lambda: number; transposed: boolean } | undefined {
  for (const t of transposed === undefined ? [false, true] : [transposed]) {
    const bb = t ? transposeFlat(b) : b;
    if (a.r !== bb.r || a.c !== bb.c) continue;
    let ab = 0;
    let b2 = 0;
    for (let i = 0; i < a.d.length; i++) {
      ab += a.d[i]! * bb.d[i]!;
      b2 += bb.d[i]! * bb.d[i]!;
    }
    if (b2 === 0) continue;
    const lambda = ab / b2;
    let worst = 0;
    for (let i = 0; i < a.d.length; i++) worst = Math.max(worst, Math.abs(a.d[i]! - lambda * bb.d[i]!));
    if (worst <= TOL * magA && lambda !== 0) return { lambda, transposed: t };
  }
  return undefined;
}

function transposeFlat(m: Flat): Flat {
  const d = new Float64Array(m.d.length);
  for (let i = 0; i < m.r; i++) for (let j = 0; j < m.c; j++) d[j * m.r + i] = m.d[i * m.c + j]!;
  return { r: m.c, c: m.r, d };
}

// ---- same step: equivalent and proportional in the unknown ------------------------------------------------------

/** Two equations are the same step when, with the parameters fixed, one residual is a constant multiple of the
 *  other as the unknown varies: δk̄ = sAk̄^α and sAk̄^α − δk̄ = 0 are the same step; k̄^{1−α} = sA/δ is a later one. */
export function sameStep(a: Statement, b: Statement, table: SymbolTable, v: string | undefined, seed = 1): boolean {
  if (sameStatement(a, b, table)) return true;
  if (!isEquation(a) || !isEquation(b) || !v) return false;
  const r: Rng = rng(seed);
  const domain = table.get(v)?.domain;
  if (!domain) return false;
  let checked = 0;
  for (let t = 0; t < 6; t++) {
    const env = sampleEnv(table, r);
    let lambda: number | undefined;
    for (let k = 0; k < 5; k++) {
      env.vals.set(v, sampleScalar(domain, r));
      let ra: number, rb: number;
      try {
        const x = residual(a, env, table);
        const y = residual(b, env, table);
        if (typeof x !== "number" || typeof y !== "number") return false;
        ra = x;
        rb = y;
      } catch (e) {
        if (e instanceof EvalError) return false;
        throw e;
      }
      if (!Number.isFinite(ra) || !Number.isFinite(rb) || rb === 0) continue;
      const l = ra / rb;
      if (lambda === undefined) lambda = l;
      else if (Math.abs(l - lambda) > 1e-6 * Math.abs(lambda)) return false;
      checked++;
    }
  }
  return checked >= 6;
}

/** A restatement of the same line: swapped sides, terms moved across, or both sides scaled by a factor free of the
 *  unknowns. With the parameters fixed, one residual is a constant multiple of the other as every unknown in them
 *  varies together. Taking logs, a reciprocal, a power or multiplying by an unknown changes the line, so it is new
 *  even when the solution set is the same. Statements with no scalar unknown fall back to equivalence. */
export function sameLine(a: Statement, b: Statement, table: SymbolTable, unknowns: string[], seed = 1): boolean {
  if (sameStatement(a, b, table)) return true;
  if (!isEquation(a) || !isEquation(b)) return false;
  const sa = symbolsOf(a);
  const sb = symbolsOf(b);
  const vars = unknowns.filter((u) => (sa.has(u) || sb.has(u)) && table.get(u)?.kind === "scalar");
  const fallback = () => equivalent(a, b, table, { seed, solveFor: unknowns }).equivalent;
  if (!vars.length) return fallback();
  if (vars.some((u) => !sa.has(u) || !sb.has(u))) return false;
  const r: Rng = rng(seed ^ 0x1b873593);
  let checked = 0;
  for (let t = 0; t < 6; t++) {
    const env = sampleEnv(table, r);
    let lambda: number | undefined;
    for (let k = 0; k < 5; k++) {
      for (const u of vars) env.vals.set(u, sampleScalar(table.get(u)!.domain, r));
      let ra: Val, rb: Val, ma: number, mb: number;
      try {
        [ra, ma] = residualMag(a, env, table);
        [rb, mb] = residualMag(b, env, table);
      } catch (e) {
        if (e instanceof EvalError) return false;
        throw e;
      }
      if (typeof ra !== "number" || typeof rb !== "number") return fallback();
      if (!Number.isFinite(ra) || !Number.isFinite(rb)) continue;
      const za = Math.abs(ra) <= TOL * ma;
      const zb = Math.abs(rb) <= TOL * mb;
      if (za || zb) {
        if (za !== zb) return false;
        continue;
      }
      const l = ra / rb;
      if (lambda === undefined) lambda = l;
      else if (Math.abs(l - lambda) > 1e-6 * Math.abs(lambda)) return false;
      checked++;
    }
  }
  return checked >= 6;
}

// ---- consequence of a system ------------------------------------------------------------------------------------

/** Does the candidate hold wherever all the earlier lines hold together? For the OLS conditions that is the joint
 *  solution (b₁, b₂), so FOC₁ + FOC₂ or b₁ in closed form count as true even though neither is an authored step.
 *  Solved by Gauss–Newton from random starts; needs the lines to pin the unknowns down. */
export function impliedBy(cand: Statement, lines: Statement[], table: SymbolTable, unknowns: string[], seed = 1): boolean {
  if (!isEquation(cand)) return false;
  const eqs = lines.filter(isEquation);
  const us = unknowns.filter((u) => eqs.some((l) => symbolsOf(l).has(u)));
  if (!us.length || eqs.length < us.length) return false;
  const r = rng(seed ^ 0x2545f491);
  let conclusive = 0;
  for (let t = 0; t < 12 && conclusive < 5; t++) {
    const env = sampleEnv(table, r);
    const x = solveSystem(eqs, us, env, table, r);
    if (!x) continue;
    us.forEach((u, i) => env.vals.set(u, x[i]!));
    let res: Val, mag: number;
    try {
      [res, mag] = residualMag(cand, env, table);
    } catch (e) {
      if (e instanceof EvalError) return false;
      throw e;
    }
    if (typeof res !== "number" || !Number.isFinite(res)) continue;
    if (Math.abs(res) > TOL * mag) return false;
    conclusive++;
  }
  return conclusive >= 3;
}

function solveSystem(eqs: Equation[], us: string[], env: Env, table: SymbolTable, r: Rng): number[] | undefined {
  const F = (x: number[]): number[] => {
    us.forEach((u, i) => env.vals.set(u, x[i]!));
    return eqs.map((e) => {
      try {
        const v = residual(e, env, table);
        return typeof v === "number" ? v : NaN;
      } catch (err) {
        if (err instanceof EvalError) return NaN;
        throw err;
      }
    });
  };
  const holds = (x: number[]) => {
    us.forEach((u, i) => env.vals.set(u, x[i]!));
    return eqs.every((e) => {
      try {
        const [v, m] = residualMag(e, env, table);
        return typeof v === "number" && Math.abs(v) <= 1e-9 * m;
      } catch {
        return false;
      }
    });
  };
  for (let start = 0; start < 3; start++) {
    let x = us.map((u) => sampleScalar(table.get(u)!.domain, r));
    for (let it = 0; it < 40; it++) {
      const f = F(x);
      if (f.some((v) => !Number.isFinite(v))) break;
      if (holds(x)) return x;
      // Gauss–Newton step with a finite-difference Jacobian: (JᵀJ) dx = −Jᵀf.
      const J = us.map((_, j) => {
        const h = 1e-6 * Math.max(1, Math.abs(x[j]!));
        const xp = x.slice();
        xp[j]! += h;
        return F(xp).map((v, i) => (v - f[i]!) / h);
      });
      const n = us.length;
      const A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J[a]!.reduce((s, col, i) => s + col * J[b]![i]!, 0)));
      const g = Array.from({ length: n }, (_, a) => -J[a]!.reduce((s, col, i) => s + col * f[i]!, 0));
      const dx = solveSmall(A, g);
      if (!dx) break;
      x = x.map((v, i) => v + dx[i]!);
    }
  }
  return undefined;
}

/** Gaussian elimination for the tiny normal equations above. */
function solveSmall(A: number[][], b: number[]): number[] | undefined {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(M[i]![c]!) > Math.abs(M[p]![c]!)) p = i;
    if (Math.abs(M[p]![c]!) < 1e-300) return undefined;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let i = 0; i < n; i++) {
      if (i === c) continue;
      const f = M[i]![c]! / M[c]![c]!;
      for (let j = c; j <= n; j++) M[i]![j]! -= f * M[c]![j]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}
