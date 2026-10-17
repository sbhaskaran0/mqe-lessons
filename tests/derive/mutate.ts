// Small mutations of a correct form, and an independent ground truth for them, to estimate the checker's false-accept
// rate. Ground truth never uses the checker's equivalence engine: it plugs the true solution (computed directly from
// the target's formula) into the mutant, so a mutant is "valid" only if it holds at the actual answer.
import { children, type Node, type Statement, symbolsOf, withChildren } from "../../src/derive/ast";
import type { Derivation } from "../../src/derive/classify";
import { inTargetForm, unknownsOf } from "../../src/derive/classify";
import { evaluate, entries, valueMag } from "../../src/derive/evaluate";
import { toLatex } from "../../src/derive/latex";
import { EvalError } from "../../src/derive/linalg";
import { rng, type Rng, sampleEnv } from "../../src/derive/sample";
import type { SymbolTable } from "../../src/derive/symbols";

type Path = number[];

function nodes(n: Node, path: Path = [], out: [Path, Node][] = []): [Path, Node][] {
  out.push([path, n]);
  children(n).forEach((c, i) => nodes(c, [...path, i], out));
  return out;
}

function replaceAt(n: Node, path: Path, by: Node): Node {
  if (!path.length) return by;
  const [head, ...rest] = path;
  const cs = children(n);
  cs[head!] = replaceAt(cs[head!]!, rest, by);
  return withChildren(n, cs);
}

/** Every single-site edit of a node: perturb a number, swap a symbol for another of its kind, flip an operator or a
 *  sign, drop an operand, toggle a transpose or an inverse. */
function edits(n: Node, table: SymbolTable): Node[] {
  const out: Node[] = [];
  const kindOf = (k: string) => table.get(k)?.kind;
  switch (n.t) {
    case "num":
      for (const v of [n.v + 1, n.v - 1, 2 * n.v, n.v / 2, -n.v]) if (v !== n.v) out.push({ t: "num", v });
      break;
    case "sym": {
      const kind = kindOf(n.key);
      for (const s of table.all()) if (s.key !== n.key && s.kind === kind) out.push({ t: "sym", key: s.key });
      if (kind === "matrix" || kind === "defined") out.push({ t: "tr", a: n });
      break;
    }
    case "add":
      out.push({ ...n, t: "sub" }, n.a, n.b);
      break;
    case "sub":
      out.push({ ...n, t: "add" }, { ...n, a: n.b, b: n.a }, n.a, { t: "neg", a: n.b });
      break;
    case "mul":
      out.push({ ...n, t: "div" }, n.a, n.b, { ...n, a: n.b, b: n.a });
      break;
    case "div":
      out.push({ ...n, t: "mul" }, { ...n, a: n.b, b: n.a }, n.a);
      break;
    case "pow":
      out.push({ ...n, b: { t: "neg", a: n.b } }, { ...n, b: { t: "div", a: { t: "num", v: 1 }, b: n.b } }, { ...n, b: { t: "add", a: n.b, b: { t: "num", v: 1 } } }, n.a);
      break;
    case "neg":
      out.push(n.a);
      break;
    case "tr":
      out.push(n.a);
      break;
    case "fn":
      if (n.fn === "inv") out.push(n.a, { t: "tr", a: n.a });
      else if (n.fn === "ln") out.push({ ...n, fn: "exp" }, n.a);
      else if (n.fn === "exp") out.push({ ...n, fn: "ln" }, n.a);
      else out.push(n.a);
      break;
    case "sum":
      out.push({ t: "mul", a: { t: "sym", key: "n" }, b: n.a });
      break;
  }
  if (n.t !== "num" && n.t !== "neg") out.push({ t: "neg", a: n });
  return out;
}

function sides(s: Statement): Node[] {
  return s.t === "eq" ? [s.l, s.r] : [s];
}

function rebuild(s: Statement, side: number, node: Node): Statement {
  if (s.t !== "eq") return node;
  return side === 0 ? { ...s, l: node } : { ...s, r: node };
}

export function singleMutations(s: Statement, table: SymbolTable): Statement[] {
  const out: Statement[] = [];
  sides(s).forEach((root, side) => {
    for (const [path, n] of nodes(root)) for (const e of edits(n, table)) out.push(rebuild(s, side, replaceAt(root, path, e)));
  });
  return out;
}

/** About `count` distinct mutants: all single edits, topped up with random double edits. */
export function mutations(s: Statement, table: SymbolTable, count: number, r: Rng = rng(7)): Statement[] {
  const seen = new Set([toLatex(s, table)]);
  const out: Statement[] = [];
  const add = (m: Statement) => {
    const key = toLatex(m, table);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(m);
  };
  const singles = singleMutations(s, table);
  singles.forEach(add);
  for (let tries = 0; out.length < count && tries < count * 50; tries++) {
    const base = singles[Math.floor(r() * singles.length)]!;
    const again = singleMutations(base, table);
    add(again[Math.floor(r() * again.length)]!);
  }
  return out.slice(0, count);
}

export interface Truth {
  /** Holds at the true solution at every sampled point. */
  holds: boolean;
  /** Holds and has the target's form (solved for the unknown): the target, by construction. */
  target: boolean;
  /** Couldn't be evaluated (shapes, x_i outside a sum, NaN everywhere). */
  broken: boolean;
}

/** Ground truth by substitution: set the unknowns to their true values (from the derivation's own formulas, in
 *  order) and check the mutant's residual is zero to rounding. */
export function truth(d: Derivation, solution: [key: string, step: number, side: "l" | "r"][], s: Statement, points = 30): Truth {
  const r = rng(424242);
  let finite = 0;
  for (let p = 0; p < points; p++) {
    const env = sampleEnv(d.table, r);
    try {
      for (const [key, step, side] of solution) {
        const st = d.steps[step - 1]!;
        if (st.t !== "eq") throw new Error("solution steps must be equations");
        env.vals.set(key, evaluate(st[side], env, d.table));
      }
      const [res, mag] = valueMag(s, env, d.table);
      const e = entries(res);
      let worst = 0;
      for (let i = 0; i < e.d.length; i++) worst = Math.max(worst, Math.abs(e.d[i]!));
      if (!Number.isFinite(worst) || !Number.isFinite(mag)) continue;
      finite++;
      if (worst > 1e-9 * mag) return { holds: false, target: false, broken: false };
    } catch (e) {
      if (e instanceof EvalError) return { holds: false, target: false, broken: true };
      throw e;
    }
  }
  if (finite < 5) return { holds: false, target: false, broken: true };
  const target = d.steps.at(-1)!;
  const unknowns = unknownsOf(d);
  const form = solution.length > 0 && inTargetForm(s, target, unknowns) && [...symbolsOf(s)].some((k) => unknowns.includes(k));
  return { holds: true, target: form, broken: false };
}
