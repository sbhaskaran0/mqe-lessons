// Where a wrong line goes wrong. A false line is compared with the next milestone and the target: when one side of
// it matches a side of the reference, the other two sides are compared numerically to name the likely slip (the
// exponent, a flipped fraction, a missing or extra factor, a sign, a stray constant). The message quotes only the
// student's own line, never the reference, so it says where to look without giving the step away.
import { type Equation, isEquation, type Node, type Statement, symbolsOf } from "./ast";
import { evaluate, type Env } from "./evaluate";
import { equivalent } from "./equivalence";
import { toLatex } from "./latex";
import { EvalError } from "./linalg";
import { rng, sampleEnv } from "./sample";
import type { SymbolTable } from "./symbols";

const POINTS = 8;
const CLOSE = 1e-7;

/** The slip that turns `cand` into one of `refs` (tried in order), as a sentence, if one is recognisable. */
export function diagnose(cand: Statement, refs: Statement[], table: SymbolTable, seed = 1): string | undefined {
  if (!isEquation(cand)) return undefined;
  for (const ref of refs) {
    if (!isEquation(ref)) continue;
    for (const [mine, theirs, x, y] of pairings(cand, ref)) {
      if (!sameValue(mine, theirs, table, seed)) continue;
      const msg = compareSides(x, y, table, seed);
      if (msg) return msg;
    }
  }
  return undefined;
}

/** Each way to line one side of the candidate up with a side of the reference: [matched, matched, other, other]. */
function pairings(c: Equation, r: Equation): [Node, Node, Node, Node][] {
  return [
    [c.l, r.l, c.r, r.r],
    [c.r, r.r, c.l, r.l],
    [c.l, r.r, c.r, r.l],
    [c.r, r.l, c.l, r.r],
  ];
}

function sameValue(a: Node, b: Node, table: SymbolTable, seed: number): boolean {
  return equivalent(a, b, table, { seed }).equivalent;
}

/** Values of each expression at the same random points (only where all are finite numbers). */
function values(nodes: Node[], table: SymbolTable, seed: number): number[][] | undefined {
  const r = rng(seed ^ 0x68e31da4);
  const out: number[][] = nodes.map(() => []);
  for (let attempt = 0; attempt < POINTS * 3 && out[0]!.length < POINTS; attempt++) {
    const env: Env = sampleEnv(table, r);
    let vs: number[];
    try {
      vs = nodes.map((n) => evaluate(n, env, table)).map((v) => (typeof v === "number" ? v : NaN));
    } catch (e) {
      if (e instanceof EvalError) continue;
      throw e;
    }
    if (vs.some((v) => !Number.isFinite(v))) continue;
    vs.forEach((v, i) => out[i]!.push(v));
  }
  return out[0]!.length >= 4 ? out : undefined;
}

const near = (a: number, b: number) => Math.abs(a - b) <= CLOSE * Math.max(1, Math.abs(a), Math.abs(b));
const constant = (xs: number[]) => xs.every((x) => Math.abs(x - xs[0]!) <= 1e-6 * Math.max(1e-12, Math.abs(xs[0]!)));

function compareSides(x: Node, y: Node, table: SymbolTable, seed: number): string | undefined {
  const exp = exponentSlip(x, y, table, seed);
  if (exp) return exp;
  const v = values([x, y], table, seed);
  if (!v) return undefined;
  const [X, Y] = v as [number[], number[]];
  if (X.every((a, i) => near(a, -Y[i]!)) && Y.some((b) => Math.abs(b) > CLOSE)) return "Check the sign: one side of your line has the opposite sign.";
  if (X.every((a, i) => near(a * Y[i]!, 1))) return "Check the fraction: one side of your line is upside down (the reciprocal of what it should be).";
  const sign = signSlip(x, y, table, seed);
  if (sign) return sign;
  // A factor: the ratio of the sides is a constant, or one symbol to a small power.
  if (Y.every((b) => Math.abs(b) > CLOSE) && X.every((a) => Math.abs(a) > CLOSE)) {
    const ratio = X.map((a, i) => a / Y[i]!);
    if (constant(ratio)) return `Check the numbers: one side of your line is off by a factor of ${formatNumber(ratio[0]!)}.`;
    const factor = symbolFactor(x, y, table, seed);
    if (factor) return factor;
  }
  const d = X.map((a, i) => a - Y[i]!);
  if (constant(d)) return `Check for a stray constant: one side of your line is off by ${formatNumber(d[0]!)}.`;
  return undefined;
}

/** Both sides are powers of the same base (or of reciprocal bases) and only the exponents disagree. */
function exponentSlip(x: Node, y: Node, table: SymbolTable, seed: number): string | undefined {
  const px = asPower(x);
  const py = asPower(y);
  if (px.e.t === "num" && px.e.v === 1 && py.e.t === "num" && py.e.v === 1) return undefined;
  let flipped: boolean;
  if (sameValue(px.b, py.b, table, seed)) flipped = false;
  else if (sameValue(px.b, { t: "div", a: { t: "num", v: 1 }, b: py.b }, table, seed)) flipped = true;
  else return undefined;
  const want: Node = flipped ? { t: "neg", a: py.e } : py.e;
  if (sameValue(px.e, want, table, seed)) return undefined;
  if (px.e.t === "num" && px.e.v === 1) return "Check the exponent: your line has no power where one is needed.";
  const tidy = simplify(px.e);
  const shown = toLatex(tidy, table);
  return toLatex(px.e, table) === shown ? `Check the exponent: yours is $${shown}$.` : `Check the exponent: yours simplifies to $${shown}$.`;
}

function asPower(n: Node): { b: Node; e: Node } {
  if (n.t === "pow") return { b: n.a, e: n.b };
  if (n.t === "fn" && n.fn === "sqrt") return { b: n.a, e: { t: "div", a: { t: "num", v: 1 }, b: { t: "num", v: 2 } } };
  return { b: n, e: { t: "num", v: 1 } };
}

/** Flipping the sign of one term of the student's side would make it right. */
function signSlip(x: Node, y: Node, table: SymbolTable, seed: number): string | undefined {
  const ts = terms(x);
  if (ts.length < 2) return undefined;
  const v = values([x, y, ...ts.map(([, t]) => t)], table, seed);
  if (!v) return undefined;
  const [X, Y, ...T] = v as [number[], number[], ...number[][]];
  for (let k = 0; k < ts.length; k++) {
    const [s, t] = ts[k]!;
    if (X.every((a, i) => near(a - 2 * s * T[k]![i]!, Y[i]!))) return `Check the sign of the term $${toLatex(t, table)}$.`;
  }
  for (let k = 0; k < ts.length; k++) {
    const [s, t] = ts[k]!;
    if (X.every((a, i) => near(a - s * T[k]![i]!, Y[i]!))) return `Check the term $${toLatex(t, table)}$: your line has it where it doesn't belong.`;
  }
  return undefined;
}

/** The ratio of the sides is one symbol to a small power, times a constant. */
function symbolFactor(x: Node, y: Node, table: SymbolTable, seed: number): string | undefined {
  const syms = [...new Set([...symbolsOf(x), ...symbolsOf(y)])].filter((k) => table.get(k)?.kind === "scalar");
  for (const k of syms) {
    const s: Node = { t: "sym", key: k };
    const v = values([x, y, s], table, seed);
    if (!v) continue;
    const [X, Y, S] = v as [number[], number[], number[]];
    for (const m of [1, -1, 2, -2]) {
      const c = X.map((a, i) => a / Y[i]! / Math.pow(S[i]!, m));
      if (!c.every(Number.isFinite) || !constant(c)) continue;
      const f = Math.abs(m) === 1 ? `$${table.latex(k)}$` : `$${table.latex(k)}^{2}$`;
      return m > 0 ? `Check the factors: one side of your line has an extra factor of ${f}.` : `Check the factors: one side of your line is missing a factor of ${f}.`;
    }
  }
  return undefined;
}

function terms(n: Node, sign = 1, out: [number, Node][] = []): [number, Node][] {
  if (n.t === "add") {
    terms(n.a, sign, out);
    terms(n.b, sign, out);
  } else if (n.t === "sub") {
    terms(n.a, sign, out);
    terms(n.b, -sign, out);
  } else out.push([sign, n]);
  return out;
}

/** A light tidy for showing an exponent: signs pulled out of denominators (1/(−α−1) → −1/(1+α)). Every rewrite is
 *  an identity. */
export function simplify(n: Node): Node {
  switch (n.t) {
    case "neg": {
      const a = simplify(n.a);
      return a.t === "neg" ? a.a : a.t === "num" ? { t: "num", v: -a.v } : { t: "neg", a };
    }
    case "div": {
      const a = simplify(n.a);
      const b = simplify(n.b);
      const nb = negated(b);
      if (nb) return simplify({ t: "neg", a: { t: "div", a, b: nb } });
      const na = negated(a);
      if (na && a.t !== "num") return { t: "neg", a: { t: "div", a: na, b } };
      return { t: "div", a, b };
    }
    case "add": {
      const a = simplify(n.a);
      const b = simplify(n.b);
      if (b.t === "neg") return { t: "sub", a, b: b.a };
      return { t: "add", a, b };
    }
    case "sub": {
      const a = simplify(n.a);
      const b = simplify(n.b);
      // −α − 1 → −(1 + α): the number first, as it would be written.
      if (a.t === "neg") return simplify({ t: "neg", a: b.t === "num" ? { t: "add", a: b, b: a.a } : { t: "add", a: a.a, b } });
      return { t: "sub", a, b };
    }
    case "mul":
    case "pow":
      return { ...n, a: simplify(n.a), b: simplify(n.b) };
    default:
      return n;
  }
}

/** e for an already-simplified −e (simplify turns −α − 1 into −(1 + α)), else undefined. */
function negated(n: Node): Node | undefined {
  if (n.t === "neg") return n.a;
  if (n.t === "num" && n.v < 0) return { t: "num", v: -n.v };
  return undefined;
}

function formatNumber(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4)));
}
