// The derivation checker (E1). Pure TypeScript with no dependencies and no React, so the player can load it lazily
// (`await import("./derive")`) on lessons that have derive blocks, and `npm run validate` can run the same code.
//
// The interface (phase2-contracts.md §1):
//   fromIR(block, {inherited?})        → DeriveRuntime   the runtime derivation for an exported `t: "derive"` block
//   selfTest(block, {seed, inherited?}) → string[]        build-time errors (empty when the block is sound)
//   check(runtime, state, input, {seed?}) → {verdict, state}   classify one typed line
//   preview(input, runtime | table)    → Preview         parse-only "I read this as …" LaTeX, or the error
//
// Verdicts: target | milestone k | valid (a correct new line on the student's own route) | valid-no-progress (a
// restatement of a line already on the page, or a tautology) | error (the author's reject message, else the likely
// slip from diagnose.ts, else a generic message). Only target finishes; `valid` never moves `reached`.
//
// Known limits (see docs/proposals/e0-checker.md, "Known failure modes"; these remain after E1):
//   - Rearrangement steps share a solution set, so typing step 1 can read as reaching a later step. Write
//     milestones that are genuinely different equations.
//   - "You already have that" means a restatement: the residual is a constant multiple of a page line's as the
//     unknowns vary. Logs or a power of a reached step are a new `valid` line. Statements with no scalar unknown
//     (matrix and identity proofs) fall back to equivalence, so there any equivalent line counts as a repeat.
//   - Only the solved form and the accept forms, scaled by a factor free of the unknown, finish: αA/δ = sA/δ
//     finishes (sA = αA is an accept), (αA/δ)^p = (sA/δ)^p is `valid` with "Now solve for s".
//   - The slip diagnosis needs one side of the line to match a side of the next step, a later step or an accept
//     form. A line wrong on both sides, or on a route the author didn't write, gets the generic message.
//   - Identity proofs: a simplification that touches no definition ((X'X)⁻¹X'X = I_K, cycling a trace) is invisible.
//     Transposed, negated and scaled spellings of a definition fold (X((X'X)⁻¹)'X', 2X(X'X)⁻¹X', −X(X'X)⁻¹X', and a
//     number inside an inverse, 2X(2X'X)⁻¹X'); a scalar symbol inside an inverse ((sX'X)⁻¹) still does not.
//   - One-way steps are rejected with a reason; a fixed extra or lost solution (k̄ = 2) is named, a moving one
//     (from squaring) is not.
//   - Non-algebraic maths (E[·], Var, plim, "|") does not parse: such a step must be a justify step. A typed step
//     after it must follow numerically from the lines before it, so expectation proofs are mostly justify steps.
//   - Not supported: vector/matrix unknowns, double sums, nth roots, \frac12 without braces, nested |x| pairs.
//   - Inherited Notation rows contribute plain scalars only; shapes, data vectors and narrow ranges stay in the
//     callout. A row's typical value sets only the sign of the domain.
export type { Node, Statement } from "./ast";
export { calloutToIR, parseDeriveCallout, type DeriveCallout } from "./callout";
export { classify, type ClassifyOptions, type Derivation, type PathState, startState, type Verdict } from "./classify";
export { declare, type Declarations } from "./declare";
export { equivalent, type Equivalence, type EquivalenceOptions } from "./equivalence";
export type { DeriveBlockIR, DeriveInheritedIR, DeriveJustifyIR, DeriveStepIR } from "./ir-shape";
export { toLatex } from "./latex";
export { domainFromTypical, inheritedSymbols, rowNames } from "./notation";
export { ParseError, parseExpression, parseStatement } from "./parse";
export {
  check,
  type CheckOptions,
  type CheckResult,
  type CheckVerdict,
  DeriveIRError,
  type DeriveRuntime,
  type DeriveState,
  type DeriveStep,
  fromIR,
  type FromIROptions,
  initialState,
} from "./runtime";
export { selfTest, type SelfTestOptions } from "./selftest";
export { SymbolTable } from "./symbols";

import { bracketedExponent } from "./classify";
import { toLatex } from "./latex";
import { ParseError, parseStatement } from "./parse";
import type { DeriveRuntime } from "./runtime";
import { SymbolTable } from "./symbols";

export type Preview =
  | { ok: true; latex: string; note?: string }
  | { ok: false; error: string; suggestions: string[] };

/** The live "I read this as …" preview: LaTeX of the parse (with a note when a numeric exponent is followed by "/",
 *  as in ^1/(1−α)), or the parse error with "did you mean" suggestions. Parse-only: no numerics. */
export function preview(input: string, symbols: SymbolTable | DeriveRuntime): Preview {
  const table = symbols instanceof SymbolTable ? symbols : symbols.table;
  try {
    const latex = toLatex(parseStatement(input, table), table);
    const alt = bracketedExponent(input);
    const note = alt && /^\^-?[0-9.]+\//.test(alt.typed) ? `${alt.typed} reads as a power divided by what follows the "/"; write ${alt.meant} for a fractional power.` : undefined;
    return { ok: true, latex, ...(note ? { note } : {}) };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: e.message, suggestions: e.suggestions };
    throw e;
  }
}
