// Parameterized numeric checks (F2; PLAN.md "Interface note: params"). A check written as one ordinary question
// names the numbers that may change (`vary:`) and a LaTeX formula for the answer (`compute:`). This module draws a
// variant from a seed, rewrites the question's `$sym = n$` spans, and recomputes the answer and the formula wrong
// answers. The player and `npm run validate` run the same code. Pure: no React, no DOM.
//
//   instantiate(check, seed?) → Variant    seed 0 or undefined: the base variant, exactly as written
//   selfTestParams(check)     → string[]   build-time problems (empty when the check is sound)
//
// The LaTeX is read by the derivation parser (src/derive), so `compute:` takes whatever a derive step takes.
import { evaluate } from "../derive/evaluate";
import { keyOf, parseName } from "../derive/names";
import { ParseError, parseExpression } from "../derive/parse";
import { rng } from "../derive/sample";
import { SymbolTable } from "../derive/symbols";
import type { NumericCheck, Vary } from "../ir";

export type Variant = {
  prompt: string;
  why: string;
  answer: number;
  tol: number;
  /** `wrong` on a plain check; on a varied one, each `wrongCompute` at this variant's numbers, with its `tol`. */
  wrong: { answer: number; tol: number; md: string }[];
  /** Every bound symbol (TeX as written) → its value in this variant. */
  values: Record<string, number>;
};

type Varied = NumericCheck & Required<Pick<NumericCheck, "vary" | "compute" | "bindings">>;

export const isVaried = (c: NumericCheck): c is Varied => !!c.vary?.length && c.compute !== undefined && !!c.bindings;

/** The symbol key the derive parser uses (`\bar{k}` and `\bar k` agree); the TeX itself when it is not a name. */
function symKey(tex: string): string {
  try {
    return keyOf(parseName(tex));
  } catch {
    return tex.replace(/\s+/g, "");
  }
}

const decimals = (x: number) => (String(x).split(".")[1] ?? "").length;
const roundTo = (x: number, d: number) => Number(x.toFixed(Math.min(d, 12)));

/** One draw of a varied number: a set member, a point on the step grid, or a uniform draw rounded to the decimals
 *  of the bounds. */
export function draw(v: Vary, next: () => number): number {
  if ("values" in v) return v.values[Math.floor(next() * v.values.length)]!;
  if (v.step) {
    const n = Math.round((v.hi - v.lo) / v.step);
    return roundTo(v.lo + Math.floor(next() * (n + 1)) * v.step, Math.max(decimals(v.step), decimals(v.lo)));
  }
  return roundTo(v.lo + next() * (v.hi - v.lo), Math.max(decimals(v.lo), decimals(v.hi)));
}

export const inRange = (v: Vary, x: number) =>
  "values" in v ? v.values.includes(x) : x >= v.lo - 1e-9 && x <= v.hi + 1e-9;

/** Base values with the varied ones drawn from `seed`, in `vary` order. */
function valuesFor(c: Varied, seed: number | undefined): Map<string, { tex: string; value: number }> {
  const out = new Map(c.bindings.map((b) => [symKey(b.sym), { tex: b.sym, value: b.value }]));
  if (!seed) return out;
  const next = rng(seed);
  for (const v of c.vary) {
    const key = symKey(v.sym);
    out.set(key, { tex: out.get(key)?.tex ?? v.sym, value: draw(v, next) });
  }
  return out;
}

/** A compiled formula over the bound symbols. Throws ParseError (unknown symbol, bad TeX); a value it cannot
 *  compute (no scalar result, a singular step) is NaN, which the self-test reports. */
function formula(c: Varied, tex: string): (values: Map<string, { value: number }>) => number {
  const table = new SymbolTable();
  for (const b of c.bindings) {
    try {
      table.add({ ...parseName(b.sym), kind: "scalar", domain: { kind: "real" } });
    } catch {
      // not a symbol name the parser reads ($x_{1,2} = 3$); a formula cannot use it
    }
  }
  const node = parseExpression(tex, table);
  return (values) => {
    const vals = new Map([...values].map(([k, v]) => [k, v.value]));
    try {
      const v = evaluate(node, { vals, data: new Map(), n: 0, idx: -1 }, table);
      return typeof v === "number" ? v : NaN;
    } catch {
      return NaN;
    }
  };
}

const NUMBER = /^([-+−]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)$/;

/** A binding span with the drawn values written in: `$s = 0.3$` → `$s = 0.25$`, `$a = 1, b = 2$` part by part. */
function rewriteSpan(span: string, values: Map<string, { value: number }>, varied: Set<string>): string {
  const parts = splitTop(span.slice(1, -1), ",").map((part) => {
    const eq = part.indexOf("=");
    const key = symKey(part.slice(0, eq));
    const rhs = part.slice(eq + 1);
    if (eq < 0 || !varied.has(key) || !NUMBER.test(rhs.trim())) return part;
    return part.slice(0, eq + 1) + rhs.replace(rhs.trim(), String(values.get(key)!.value));
  });
  return `$${parts.join(",")}$`;
}

function splitTop(src: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of src) {
    if ("{[(".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  return [...out, cur];
}

const record = (values: Map<string, { tex: string; value: number }>) =>
  Object.fromEntries([...values.values()].map((v) => [v.tex, v.value]));

function base(c: NumericCheck): Variant {
  return { prompt: c.prompt, why: c.why, answer: c.answer, tol: c.tol, wrong: c.wrong ?? [], values: {} };
}

/** The variant of `check` for `seed`. Seed 0 or undefined is the base variant: the text unchanged, the written
 *  answer and tolerance. Any other seed draws the varied numbers, rewrites every binding span in the prompt, the
 *  why and the wrong-answer feedback, and recomputes the answer. The tolerance scales with |answer| / |base answer|,
 *  so a percent tolerance stays that percent (an absolute one at a zero base answer stays as written). A check
 *  without `vary` always gives its base variant, as does one whose formula fails (validate rejects those). */
export function instantiate(check: NumericCheck, seed?: number): Variant {
  if (!isVaried(check)) return base(check);
  try {
    return variant(check, seed);
  } catch {
    return { ...base(check), values: record(valuesFor(check, undefined)) };
  }
}

/** The tolerance at a variant's answer: scaled by |answer| / |base answer|, which keeps a percent tolerance that
 *  percent; an absolute tolerance at a zero base answer stays as written. */
const scaledTol = (c: NumericCheck, answer: number) => (c.answer === 0 ? c.tol : (c.tol * Math.abs(answer)) / Math.abs(c.answer));

function variant(c: Varied, seed: number | undefined): Variant {
  const values = valuesFor(c, seed);
  const wrongTex = (c.wrongCompute ?? []).map((w) => ({ f: formula(c, w.tex), md: w.md }));
  if (!seed) {
    const wrong = wrongTex.map((w) => ({ answer: w.f(values), tol: c.tol, md: w.md }));
    return { ...base(c), wrong: [...(c.wrong ?? []), ...wrong], values: record(values) };
  }
  const answer = formula(c, c.compute)(values);
  const tol = scaledTol(c, answer);
  const varied = new Set(c.vary.map((v) => symKey(v.sym)));
  const spans = [...new Set(c.bindings.filter((b) => varied.has(symKey(b.sym))).map((b) => b.span))];
  const text = (s: string) => spans.reduce((acc, span) => acc.split(span).join(rewriteSpan(span, values, varied)), s);
  return {
    prompt: text(c.prompt),
    why: text(c.why),
    answer,
    tol,
    wrong: wrongTex.map((w) => ({ answer: w.f(values), tol, md: text(w.md) })),
    values: record(values),
  };
}

/** Seeds validate draws: enough to catch a range that leaves the formula's domain, few enough to stay fast. */
export const SELF_TEST_SEEDS = 20;

const fmt = (x: number) => (Number.isFinite(x) ? String(Number(x.toPrecision(6))) : String(x));

/** Build-time problems of a varied check, each one line: a formula that does not read, a base answer the formula
 *  does not give (the numbers must be right by construction), a draw that leaves its range or gives no finite
 *  answer, a formula wrong answer that lands within the tolerance of the right one. [] for a plain check. */
export function selfTestParams(check: NumericCheck): string[] {
  if (!check.vary && !check.compute && !check.bindings) return [];
  if (!isVaried(check)) return ["'vary', 'compute' and 'bindings' come together"];
  const c = check;
  const errors: string[] = [];
  const bound = new Set(c.bindings.map((b) => symKey(b.sym)));
  for (const v of c.vary) if (!bound.has(symKey(v.sym))) errors.push(`vary: $${v.sym}$ has no '$${v.sym} = <number>$' in the question`);
  const read = (what: string, tex: string) => {
    try {
      return formula(c, tex);
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      const unknown = /don't know the symbol/.test(e.message) ? " - every symbol needs its '$x = <number>$' in the question" : "";
      errors.push(`${what} $${tex}$: ${e.message}${unknown}`);
      return undefined;
    }
  };
  const answerOf = read("compute:", c.compute);
  const wrongs = (c.wrongCompute ?? []).map((w) => ({ tex: w.tex, f: read("wrong:", w.tex) }));
  if (errors.length || !answerOf) return errors;

  // One message per problem (the first seed that shows it), not one per seed.
  const found = new Map<string, string>();
  const report = (problem: string, msg: string) => found.has(problem) || found.set(problem, msg);
  const atBase = answerOf(valuesFor(c, undefined));
  if (!(Math.abs(atBase - c.answer) <= c.tol + 1e-9 * Math.max(1, Math.abs(c.answer)))) {
    report("base", `compute: gives ${fmt(atBase)} at the question's numbers, but 'answer:' is ${fmt(c.answer)} ± ${fmt(c.tol)} - fix one of them`);
  }
  for (let seed = 0; seed <= SELF_TEST_SEEDS; seed++) {
    const values = valuesFor(c, seed);
    const label = seed ? `at ${c.vary.map((v) => `$${v.sym} = ${values.get(symKey(v.sym))?.value}$`).join(", ")}` : "at the question's numbers";
    for (const v of c.vary) {
      const x = values.get(symKey(v.sym))!.value;
      if (!inRange(v, x)) report(`range ${v.sym}`, `vary: $${v.sym}$ drew ${x}, outside its range`);
    }
    const answer = seed ? answerOf(values) : c.answer;
    if (!Number.isFinite(answer)) {
      report("answer", `compute: gives ${fmt(answer)} ${label} - narrow the 'vary:' ranges`);
      continue;
    }
    const tol = scaledTol(c, answer);
    for (const w of wrongs) {
      const x = w.f!(values);
      if (!Number.isFinite(x)) report(`wrong ${w.tex}`, `wrong: $${w.tex}$ gives ${fmt(x)} ${label}`);
      else if (Math.abs(x - answer) <= tol) report(`wrong ${w.tex}`, `wrong: $${w.tex}$ gives ${fmt(x)} ${label}, within the right answer ${fmt(answer)} ± ${fmt(tol)}`);
    }
  }
  return [...errors, ...found.values()];
}
