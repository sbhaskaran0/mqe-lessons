// Path classification: where does the student's new line sit on the author's derivation?
//
//   target             equivalent to the last step and in its form (solved for the unknown when the target is
//                      `k̄ = …`), or the same step as an author `accept:` form;
//   milestone(k)       equivalent to step k, beyond the furthest step reached so far (skipping ahead is fine);
//   valid              true and new: on the student's own route, not a restatement of a line they already have
//                      (a line equivalent to the answer but not yet solved gets "Now solve for …");
//   valid-no-progress  true, but a restatement of a given, an accepted line or a step already reached, or an
//                      identity that holds whatever the values;
//   error              none of the above; carries the message of the first matching `reject:` form, else where the
//                      line seems to go wrong (diagnose.ts), else a generic message.
//
// Equivalence is by solution set, so in a rearrangement derivation every step after the substitution is equivalent
// to every other (sAk̄^α = δk̄ and k̄ = (sA/δ)^{1/(1−α)} hold for the same k̄). What separates "done" from "on the
// way" is the target's form, which is why `target` checks it and the other steps are matched highest first. Only
// the solved form and the author's accept forms (up to scaling both sides by a factor free of the unknown) finish:
// any other form of the answer is a correct `valid` line one move short. "Repeat" is finer than equivalence: a line
// is a repeat only when it restates one already on the page (`sameLine`), so taking logs of a reached step is new.
import { type Equation, isEquation, type Node, type Statement, symbolsOf } from "./ast";
import { diagnose } from "./diagnose";
import { type Equivalence, equivalent, impliedBy, probe, sameLine, sameStep, solveVariable } from "./equivalence";
import { sameStatement } from "./fold";
import { toLatex } from "./latex";
import { ParseError, parseStatement } from "./parse";
import type { SymbolTable } from "./symbols";

export interface Derivation {
  table: SymbolTable;
  /** Where the derivation starts (the student's first "previous lines"). */
  given: Statement[];
  /** The numbered steps; the last is the target. */
  steps: Statement[];
  /** Extra forms that count as reaching the target (e.g. k̄^{1−α} = sA/δ). */
  accept: Statement[];
  reject: { form: Statement; message: string }[];
}

export interface PathState {
  /** Lines accepted so far, including the givens. */
  lines: Statement[];
  /** Highest step number reached (1-based); 0 before any. */
  reached: number;
}

export type Verdict =
  | { kind: "target"; latex: string }
  | { kind: "milestone"; step: number; latex: string; hint?: string }
  | { kind: "valid"; latex: string; hint?: string }
  | { kind: "valid-no-progress"; latex: string; hint: string }
  | { kind: "error"; latex?: string; message: string; reject?: number; suggestions?: string[] };

export interface ClassifyOptions {
  seed?: number;
}

/** The unknowns of a derivation: declared ones, else the symbol the target isolates. */
export function unknownsOf(d: Derivation): string[] {
  if (d.table.unknowns.length) return d.table.unknowns;
  const target = d.steps.at(-1);
  if (target && isEquation(target)) {
    if (target.l.t === "sym") return [target.l.key];
    if (target.r.t === "sym") return [target.r.key];
  }
  return [];
}

/** Is one side exactly an unknown and the other free of unknowns? */
function isolated(eq: Equation, unknowns: string[]): string | undefined {
  const free = (n: Node) => ![...symbolsOf(n)].some((k) => unknowns.includes(k));
  if (eq.l.t === "sym" && unknowns.includes(eq.l.key) && free(eq.r)) return eq.l.key;
  if (eq.r.t === "sym" && unknowns.includes(eq.r.key) && free(eq.l)) return eq.r.key;
  return undefined;
}

/** When the target is solved for an unknown, the candidate must be solved for the same one. */
export function inTargetForm(cand: Statement, target: Statement, unknowns: string[]): boolean {
  if (!isEquation(target)) return true;
  const want = isolated(target, unknowns);
  if (!want) return true;
  return isEquation(cand) && isolated(cand, unknowns) === want;
}

export function startState(d: Derivation): PathState {
  return { lines: [...d.given], reached: 0 };
}

function classifyOnce(d: Derivation, input: string | Statement, state: PathState, opts: ClassifyOptions): Verdict {
  const { table } = d;
  let cand: Statement;
  try {
    cand = typeof input === "string" ? parseStatement(input, table) : input;
  } catch (e) {
    if (e instanceof ParseError) return { kind: "error", message: e.message, ...(e.suggestions.length ? { suggestions: e.suggestions } : {}) };
    throw e;
  }
  const target = d.steps.at(-1)!;
  // A bare expression answers "k̄ = ?": read it as the right-hand side.
  if (!isEquation(cand) && isEquation(target) && target.l.t === "sym") cand = { t: "eq", l: target.l, r: cand };
  const latex = toLatex(cand, table);
  const unknowns = unknownsOf(d);
  const eq = (ref: Statement) => equivalent(cand, ref, table, { ...(opts.seed !== undefined ? { seed: opts.seed } : {}), solveFor: unknowns });

  const toTarget = eq(target);
  if (toTarget.problem && toTarget.regime === "structural" && (isEquation(cand) !== isEquation(target) || probeFails(cand, table, opts.seed))) {
    return rejectOrError(d, cand, latex, sentence(toTarget.problem), opts);
  }
  if (toTarget.equivalent) {
    const formless = toTarget.regime === "identity" || toTarget.regime === "proportional";
    if (formless || inTargetForm(cand, target, unknowns)) return { kind: "target", latex };
    const v = solveVariable(cand, target, table, unknowns);
    if (d.accept.some((a) => sameStep(cand, a, table, v, opts.seed))) return { kind: "target", latex };
  }

  let step = 0;
  let oneSided: Equivalence | undefined = toTarget.direction ? toTarget : undefined;
  for (let k = d.steps.length - 1; k >= 1; k--) {
    const e = eq(d.steps[k - 1]!);
    if (e.equivalent) {
      step = k;
      break;
    }
    if (!oneSided && e.direction) oneSided = e;
  }
  const solve = toTarget.equivalent ? solveFor(target, unknowns, table) : undefined;
  const solveHint = solve ? `That's equivalent to the answer. Now solve for ${solve}.` : undefined;
  if (step > state.reached) return { kind: "milestone", step, latex, ...(solveHint ? { hint: solveHint } : {}) };
  // True from here on. A restatement of a line already on the page is no progress; anything else is a new line on
  // the student's own route, even when it matches no authored step.
  const repeat = () => [...state.lines, ...d.steps.slice(0, state.reached)].some((l) => sameLine(cand, l, table, unknowns, opts.seed));
  if (toTarget.equivalent || step > 0 || state.lines.some((l) => eq(l).equivalent)) {
    if (repeat()) return { kind: "valid-no-progress", latex, hint: solve ? `${REPEAT} Now solve for ${solve}.` : REPEAT };
    return { kind: "valid", latex, ...(solveHint ? { hint: solveHint } : {}) };
  }
  if (isEquation(cand) && probe(cand, table, opts.seed ?? 1).identity) {
    // In a proof of an identity (MX = 0, D = 4NΣ(xᵢ − x̄)²) every true line holds whatever the values: one that
    // holds only because of the definitions (MM = M, ln D = ln(…)) is a line of the proof. A tautology (k̄ = k̄,
    // M = M′) says nothing either way.
    const seed = opts.seed ?? 1;
    if (isEquation(target) && table.ofKind("defined").length && probe(target, table, seed).identity && !probe(cand, table, seed, "all").identity)
      return repeat() ? { kind: "valid-no-progress", latex, hint: REPEAT } : { kind: "valid", latex };
    return { kind: "valid-no-progress", latex, hint: "That's true, but it holds whatever the values, so it doesn't move the derivation on." };
  }
  if (impliedBy(cand, state.lines, table, unknowns, opts.seed)) return { kind: "valid", latex };
  return rejectOrError(d, cand, latex, oneSided ? oneSidedMessage(oneSided, table) : undefined, opts, state);
}

const REPEAT = "True, but you already have that.";

/** A step that only goes one way. When the extra (or lost) solution is a fixed value, name it. */
function oneSidedMessage(e: Equivalence, table: SymbolTable): string {
  const at = e.at ? `$${table.latex(e.at.symbol)} = ${formatNumber(e.at.value)}$` : undefined;
  if (e.direction === "wider")
    return at
      ? `That holds at the answer, but it also allows other values: it is also true at ${at}, which the derivation doesn't allow. Did you multiply both sides by something that is zero there?`
      : "That holds at the answer, but it also allows other values, so the step only goes one way. Squaring both sides, or multiplying them by something that can be zero, does this.";
  return at
    ? `That loses some of the solutions: ${at} solves the derivation's equation but not this one. Did you divide both sides by something that is zero there?`
    : "That loses some of the solutions, so the step only goes one way. Dividing both sides by something that can be zero, or taking a square root or log of something that can be negative, does this.";
}

function formatNumber(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
}

function sentence(s: string): string {
  return `${s[0]!.toUpperCase()}${s.slice(1)}.`;
}

const UNBRACKETED_EXPONENT = /\^\s*(-?[A-Za-z0-9.\\]+|\([^()]*\))\s*\/\s*(\((?:[^()]|\([^()]*\))*\)|[A-Za-z0-9.\\]+)/g;

/** `(sA/δ)^1/(1−α)` reads as ((sA/δ)^1)/(1−α): the line with every such exponent bracketed, and the first one as
 *  typed and as it was probably meant. */
export function bracketedExponent(input: string): { line: string; typed: string; meant: string } | undefined {
  let first: { typed: string; meant: string } | undefined;
  const line = input.replace(UNBRACKETED_EXPONENT, (m, a: string, b: string) => {
    const meant = `^(${a}/${b})`;
    first ??= { typed: m.replace(/\s+/g, ""), meant };
    return meant;
  });
  return first ? { line, ...first } : undefined;
}

export function classify(d: Derivation, input: string | Statement, state: PathState = startState(d), opts: ClassifyOptions = {}): Verdict {
  const v = classifyOnce(d, input, state, opts);
  if (v.kind !== "error" || v.reject !== undefined || typeof input !== "string" || v.latex === undefined) return v;
  const alt = bracketedExponent(input);
  if (!alt) return v;
  if (classifyOnce(d, alt.line, state, opts).kind !== "error") return { ...v, message: `An exponent that is a fraction needs brackets: did you mean ${alt.line.trim()}?` };
  // Wrong either way, but maybe not in the way the student thinks: say how a numeric exponent (^1/(1−α)) was read.
  if (!/^\^-?[0-9.]+\//.test(alt.typed)) return v;
  return { ...v, message: `${v.message} (Note: ${alt.typed} reads as a power divided by what follows the "/"; write ${alt.meant} for a fractional power.)` };
}

function probeFails(cand: Statement, table: SymbolTable, seed = 1): boolean {
  return isEquation(cand) && probe(cand, table, seed).problem !== undefined;
}

/** The unknown the target is solved for, as inline maths, if it is solved for one. */
function solveFor(target: Statement, unknowns: string[], table: SymbolTable): string | undefined {
  if (!isEquation(target)) return undefined;
  const u = isolated(target, unknowns);
  return u ? `$${table.latex(u)}$` : undefined;
}

/** An author `reject:` message first, then the checker's own reason, then where the line seems to go wrong compared
 *  with the next step and the target (never quoting them), then the generic message. */
function rejectOrError(d: Derivation, cand: Statement, latex: string, problem: string | undefined, opts: ClassifyOptions, state?: PathState): Verdict {
  const unknowns = unknownsOf(d);
  const i = d.reject.findIndex(
    (r) => sameStatement(cand, r.form, d.table) || equivalent(cand, r.form, d.table, { ...(opts.seed !== undefined ? { seed: opts.seed } : {}), solveFor: unknowns }).equivalent,
  );
  if (i >= 0) return { kind: "error", latex, message: d.reject[i]!.message, reject: i };
  const slip = problem || !state ? undefined : diagnose(cand, [...d.steps.slice(state.reached), ...d.accept], d.table, opts.seed);
  return { kind: "error", latex, message: problem ?? slip ?? "That doesn't follow from the previous lines." };
}
