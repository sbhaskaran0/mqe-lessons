// Valid alternate forms of a derivation's lines, and an audit of how the checker treats them: the student's own route
// must never be rejected or told "you already have that" when it isn't a repeat. The forms are built from the AST
// with the domain conditions checked numerically (a side must be positive before taking its log, nonzero before
// taking its reciprocal), so every form is equivalent to the line it came from; none uses the checker's engine.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type Equation, isEquation, type Node, type Statement, symbolsOf } from "../../src/derive/ast";
import { unknownsOf } from "../../src/derive/classify";
import { evaluate } from "../../src/derive/evaluate";
import type { DeriveBlockIR } from "../../src/derive/ir-shape";
import { toLatex } from "../../src/derive/latex";
import { EvalError } from "../../src/derive/linalg";
import { parseStatement } from "../../src/derive/parse";
import { sameLine } from "../../src/derive/equivalence";
import { check, type DeriveRuntime, type DeriveState, fromIR, initialState, pathState } from "../../src/derive/runtime";
import { rng, sampleEnv, sampleScalar } from "../../src/derive/sample";
import type { Domain, SymbolTable } from "../../src/derive/symbols";

export interface Alternate {
  form: Statement;
  /** How it was made: "swap", "×A", "ln", … */
  how: string;
  /** A restatement of the same line (swapped, terms moved, both sides scaled by a factor free of the unknowns):
   *  "you already have that" is fair once the line it restates is on the page. */
  restate: boolean;
}

const num = (v: number): Node => ({ t: "num", v });
const sym = (key: string): Node => ({ t: "sym", key });
const bin = (t: "add" | "sub" | "mul" | "div" | "pow", a: Node, b: Node): Node => ({ t, a, b });

/** Values a side takes over the domain: other symbols at random points, each unknown swept across its whole domain
 *  (the root scan searches all of it, so a condition that fails far out still breaks the equivalence). */
function sideValues(n: Node, table: SymbolTable, unknowns: string[], points = 24): number[] | undefined {
  const r = rng(99);
  const out: number[] = [];
  const sweep = (d: Domain): number[] =>
    d.kind === "positive" ? [1e-6, 1e-3, 0.1, 1, 10, 1e3, 1e6] : d.kind === "real" ? [-1e6, -10, -1, -1e-3, 0, 1e-3, 1, 10, 1e6] : [0.01, 0.25, 0.5, 0.75, 0.99].map((q) => d.lo + q * (d.hi - d.lo));
  const us = unknowns.filter((u) => symbolsOf(n).has(u) && table.get(u)?.kind === "scalar");
  for (let p = 0; p < points; p++) {
    const env = sampleEnv(table, r);
    const grids = us.length ? us.map((u) => sweep(table.get(u)!.domain)) : [[0]];
    for (let i = 0; i < grids[0]!.length; i++) {
      us.forEach((u, j) => env.vals.set(u, us.length > 1 && j > 0 ? sampleScalar(table.get(u)!.domain, r) : grids[j]![i]!));
      try {
        const v = evaluate(n, env, table);
        if (typeof v !== "number") return undefined;
        out.push(v);
      } catch (e) {
        if (e instanceof EvalError) return undefined;
        throw e;
      }
    }
  }
  return out;
}

const positive = (n: Node, t: SymbolTable, u: string[]) => sideValues(n, t, u)?.every((v) => Number.isFinite(v) && v > 0) ?? false;
const nonzero = (n: Node, t: SymbolTable, u: string[]) => {
  const vs = sideValues(n, t, u);
  return !!vs && vs.every((v) => Number.isFinite(v) && v !== 0) && (vs.every((v) => v > 0) || vs.every((v) => v < 0));
};

/** The terms of a sum, with their signs. */
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

function sumOf(ts: [number, Node][]): Node {
  if (!ts.length) return num(0);
  let acc: Node = ts[0]![0] > 0 ? ts[0]![1] : { t: "neg", a: ts[0]![1] };
  for (const [s, n] of ts.slice(1)) acc = bin(s > 0 ? "add" : "sub", acc, n);
  return acc;
}

/** Every valid single-move rearrangement of an equation (and the swapped version of each). */
export function alternateForms(st: Statement, table: SymbolTable, unknowns: string[]): Alternate[] {
  if (!isEquation(st)) return [];
  const { l, r } = st;
  const out: Alternate[] = [];
  const free = (n: Node) => ![...symbolsOf(n)].some((k) => unknowns.includes(k));
  const add = (form: Equation, how: string, restate: boolean) => {
    out.push({ form, how, restate });
    if (how !== "swap") out.push({ form: { t: "eq", l: form.r, r: form.l }, how: `${how}, swapped`, restate });
  };
  const scalar = sideValues(l, table, unknowns, 2) !== undefined && sideValues(r, table, unknowns, 2) !== undefined;
  add({ t: "eq", l: r, r: l }, "swap", true);
  // Terms moved across.
  add({ t: "eq", l: bin("sub", l, r), r: num(0) }, "L − R = 0", true);
  for (const [side, other, name] of [
    [l, r, "L"],
    [r, l, "R"],
  ] as const) {
    const ts = terms(side);
    if (ts.length < 2) continue;
    ts.forEach(([s, t], i) => {
      const rest = ts.filter((_, j) => j !== i);
      add({ t: "eq", l: sumOf(rest), r: s > 0 ? bin("sub", other, t) : bin("add", other, t) }, `move a term of ${name}`, true);
    });
  }
  add({ t: "eq", l: bin("mul", num(2), l), r: bin("mul", num(2), r) }, "×2", true);
  if (!scalar) return out;

  // Both sides times or over a nonzero factor present in the line.
  const syms = [...symbolsOf(st)].filter((k) => table.get(k)?.kind === "scalar");
  for (const k of syms) {
    if (!nonzero(sym(k), table, unknowns)) continue;
    const restate = !unknowns.includes(k);
    add({ t: "eq", l: bin("mul", sym(k), l), r: bin("mul", sym(k), r) }, `×${table.typed(k)}`, restate);
    add({ t: "eq", l: bin("div", l, sym(k)), r: bin("div", r, sym(k)) }, `÷${table.typed(k)}`, restate);
  }
  // Clear a fraction: multiply both sides by a side's denominator; divide one side out.
  for (const [side, other] of [
    [l, r],
    [r, l],
  ] as const) {
    if (side.t === "div" && nonzero(side.b, table, unknowns)) add({ t: "eq", l: side.a, r: bin("mul", other, side.b) }, "clear the fraction", free(side.b));
    if (nonzero(other, table, unknowns)) add({ t: "eq", l: bin("div", side, other), r: num(1) }, "divide by a side", free(other));
  }
  const pos = positive(l, table, unknowns) && positive(r, table, unknowns);
  if (nonzero(l, table, unknowns) && nonzero(r, table, unknowns)) add({ t: "eq", l: bin("div", num(1), l), r: bin("div", num(1), r) }, "reciprocal", false);
  if (pos) {
    add({ t: "eq", l: { t: "fn", fn: "ln", a: l }, r: { t: "fn", fn: "ln", a: r } }, "ln", false);
    add({ t: "eq", l: bin("pow", l, num(2)), r: bin("pow", r, num(2)) }, "square", false);
    add({ t: "eq", l: { t: "fn", fn: "sqrt", a: l }, r: { t: "fn", fn: "sqrt", a: r } }, "root", false);
    // Undo an outer power: B^e = O ⟺ B = O^(1/e) when both are positive.
    for (const [side, other] of [
      [l, r],
      [r, l],
    ] as const) {
      if (side.t === "pow" && positive(side.a, table, unknowns)) add({ t: "eq", l: side.a, r: bin("pow", other, bin("div", num(1), side.b)) }, "undo the power", false);
      if (side.t === "pow") add({ t: "eq", l: bin("pow", side, bin("div", num(1), side.b)), r: bin("pow", other, bin("div", num(1), side.b)) }, "raise to 1/e", false);
    }
  }
  return out;
}

// ---- the audit --------------------------------------------------------------------------------------------------

export interface AuditCase {
  block: string;
  state: number;
  step: number;
  how: string;
  input: string;
  verdict: string;
  message?: string;
}

export interface AuditRow {
  block: string;
  tried: number;
  rejected: AuditCase[];
  discouraged: AuditCase[];
  /** Forms whose LaTeX did not read back as the same line (a generator problem, not a checker one). */
  unreadable: number;
}

const label = (v: { kind: string; step?: number }) => (v.kind === "milestone" ? `milestone ${v.step}` : v.kind);

/** The states a student passes through: typing the author's steps in order, and also reaching each step by an
 *  alternate form of it (logs, a reciprocal, a power undone) instead, so the lines on the page are their own. */
function states(rt: DeriveRuntime, unknowns: string[]): { label: string; state: DeriveState }[] {
  const out = [{ label: "start", state: initialState() }];
  let s = out[0]!.state;
  for (const [j, idx] of rt.milestones.slice(0, -1).entries()) {
    for (const a of alternateForms(rt.derivation.steps[j]!, rt.table, unknowns).filter((a) => !a.restate && !a.how.includes("swapped")).slice(0, 2)) {
      const alt = check(rt, s, toLatex(a.form, rt.table)).state;
      if (!alt.done && alt.reached > s.reached) out.push({ label: `step ${j + 1} by ${a.how}`, state: alt });
    }
    const next = check(rt, s, rt.steps[idx]!.tex).state;
    if (next.done || next.reached === s.reached) break;
    out.push({ label: `step ${j + 1}`, state: (s = next) });
  }
  return out;
}

/** Moves worth trying a second move after: the ones that change the line's shape. */
const SECOND = new Set(["ln", "reciprocal", "undo the power", "clear the fraction", "×", "÷"]);

/** Type every alternate form of every milestone (and the target's accept forms), and with `deep` second moves after
 *  the shape-changing ones (about 20× the forms), from every state. Each must be a milestone, the target or a correct new line; "you already
 *  have that" is fair only for a restatement of a line on the page (or, by construction, of a step reached). */
export function audit(name: string, rt: DeriveRuntime, { deep = false }: { deep?: boolean } = {}): AuditRow {
  const row: AuditRow = { block: name, tried: 0, rejected: [], discouraged: [], unreadable: 0 };
  const { table } = rt;
  const unknowns = unknownsOf(rt.derivation);
  const M = rt.milestones.length;
  const lines: { step: number; st: Statement; how: string; restate: boolean }[] = [];
  const forms = (step: number, st: Statement, how: string) => {
    lines.push({ step, st, how, restate: true });
    for (const a of alternateForms(st, table, unknowns)) {
      lines.push({ step, st: a.form, how: `${how}, ${a.how}`, restate: a.restate });
      if (!deep || (!SECOND.has(a.how) && !SECOND.has(a.how.replace(/[^×÷].*$/, "")))) continue;
      for (const b of alternateForms(a.form, table, unknowns).filter((b) => !b.how.includes("swapped")))
        lines.push({ step, st: b.form, how: `${how}, ${a.how}, ${b.how}`, restate: a.restate && b.restate });
    }
  };
  rt.derivation.steps.forEach((st, k) => forms(k + 1, st, "as authored"));
  rt.derivation.accept.forEach((st) => forms(M, st, "accept"));
  for (const [si, { state }] of states(rt, unknowns).entries()) {
    // Lines on the page: a restatement of one of these may fairly be "you already have that".
    const page = [...pathState(rt, state).lines, ...rt.derivation.steps.slice(0, state.reached)];
    const have = (step: number) => step <= state.reached || page.some((l) => sameLine(rt.derivation.steps[step - 1]!, l, table, unknowns));
    for (const line of lines) {
      const input = toLatex(line.st, table);
      try {
        parseStatement(input, table);
      } catch {
        row.unreadable++;
        continue;
      }
      const v = check(rt, state, input).verdict;
      row.tried++;
      const c: AuditCase = { block: name, state: si, step: line.step, how: line.how, input, verdict: label(v), ...(v.kind === "error" ? { message: v.message } : {}) };
      if (v.kind === "error") row.rejected.push(c);
      else if (v.kind === "valid-no-progress" && !(line.restate && have(line.step)) && !page.some((l) => sameLine(line.st, l, table, unknowns))) row.discouraged.push(c);
    }
  }
  return row;
}

// ---- the blocks -------------------------------------------------------------------------------------------------

const NOTES = path.resolve(__dirname, "../../content/notes");

/** Every exported derive block with something to type. */
export function realBlocks(): { name: string; block: DeriveBlockIR }[] {
  const out: { name: string; block: DeriveBlockIR }[] = [];
  for (const f of readdirSync(NOTES).filter((f) => f.endsWith(".json")).sort()) {
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") {
        const b = o as { t?: string; title?: string };
        if (b.t === "derive") out.push({ name: `${f.replace(/\.json$/, "")}: ${b.title}`, block: o as DeriveBlockIR });
        Object.values(o).forEach(walk);
      }
    };
    walk(JSON.parse(readFileSync(path.join(NOTES, f), "utf8")));
  }
  return out;
}

export function auditBlock(name: string, block: DeriveBlockIR, opts: { deep?: boolean } = {}): AuditRow {
  return audit(name, fromIR(block), opts);
}
