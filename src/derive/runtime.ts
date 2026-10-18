// The E1 interface the player uses: `fromIR(block)` turns an exported `t: "derive"` block into a runtime derivation,
// and `check(runtime, state, input)` classifies one line the student typed and returns the new state.
//
// State is plain JSON (the accepted lines as typed, the furthest milestone, done), so the player can keep it in the
// progress store; `check` re-reads the lines each time, which costs well under a millisecond.
//
// Justify steps (phase2-contracts.md §1) are shown, not typed: they are never milestones, and once the student has
// reached the step before one, its maths (when it parses) counts as a previous line.
import type { Statement } from "./ast";
import { type Derivation, type PathState, classify, type Verdict } from "./classify";
import { declare } from "./declare";
import type { DeriveBlockIR, DeriveInheritedIR, DeriveJustifyIR } from "./ir-shape";
import { inheritedSymbols } from "./notation";
import { ParseError, parseStatement } from "./parse";
import type { SymbolTable } from "./symbols";

export interface DeriveStep {
  /** Position in `block.steps`. */
  index: number;
  md: string;
  tex: string;
  hint?: string;
  justify?: DeriveJustifyIR;
  /** The parsed maths: always for a typed step, for a justify step only when it parses. */
  statement?: Statement;
  /** 1-based milestone number of a typed step (the last typed step is the target); absent for justify steps. */
  milestone?: number;
}

export interface DeriveRuntime {
  title: string;
  objectives: number[];
  table: SymbolTable;
  /** What `classify` works on: the givens and the typed steps only (`derivation.steps[k - 1]` is milestone k). */
  derivation: Derivation;
  /** Every step of the block, in order, justify steps included. */
  steps: DeriveStep[];
  /** `milestones[k - 1]` is the block step index of milestone k; the last entry is the target. */
  milestones: number[];
  /** Symbols that came from Notation tables (not declared in the callout), with the note that supplied each. */
  inherited: { key: string; from: string }[];
}

export interface FromIROptions {
  /** Extra Notation rows from the caller (the lecture's linked tables), merged after `block.inherited`. The
   *  callout's own declarations always win; among rows, the first claim on a name wins. */
  inherited?: readonly DeriveInheritedIR[];
}

export class DeriveIRError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("\n"));
    this.name = "DeriveIRError";
  }
}

const MATH = /\$([^$]+)\$/g;

/** The maths of a field: its `$…$` spans if it has any, else the whole text. */
export function mathSpans(s: string): string[] {
  const spans = [...s.matchAll(MATH)].map((m) => m[1]!.trim());
  return spans.length ? spans : s.trim() ? [s.trim()] : [];
}

/** A short quote of an author's line for messages. */
export function quote(tex: string): string {
  const t = tex.replace(/\s+/g, " ").trim();
  return `"${t.length > 70 ? `${t.slice(0, 67)}…` : t}"`;
}

const UNKNOWN_SYMBOL = /^I don't know the symbol/;

/** Build the runtime, collecting every problem instead of stopping at the first (selfTest reports them all). */
export function buildRuntime(block: DeriveBlockIR, opts: FromIROptions = {}): { runtime?: DeriveRuntime; problems: string[] } {
  const problems: string[] = [];
  const rows = [...(block.inherited ?? []), ...(opts.inherited ?? [])];
  const inherited = inheritedSymbols(rows);
  const decl = {
    symbols: (block.symbols ?? []).join(", "),
    unknowns: (block.unknowns ?? []).join(", "),
    dims: (block.dims ?? []).join(", "),
    data: (block.data ?? []).join(", "),
    matrices: (block.matrices ?? []).join(", "),
    define: (block.define ?? []).map((d) => d.replace(/\$/g, " ").trim()),
    inherited,
  };
  let table: SymbolTable;
  try {
    table = declare(decl);
  } catch (e) {
    // Find the definition that failed, if it was one, so the message names the line.
    let where = "declarations";
    if (declarationsOk(decl))
      for (let i = 0; i < decl.define.length; i++) {
        try {
          declare({ ...decl, define: decl.define.slice(0, i + 1) });
        } catch {
          where = `define ${i + 1} ${quote(decl.define[i]!)}`;
          break;
        }
      }
    return { problems: [`${where}: ${(e as Error).message}`] };
  }
  const notationNote = rows.length ? " — add it to symbols: or to the Notation table of a linked note" : " — add it to symbols:";
  const read = (src: string, what: string): Statement | undefined => {
    try {
      return parseStatement(src, table);
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      problems.push(`${what} ${quote(src)}: ${UNKNOWN_SYMBOL.test(e.message) ? e.message.replace(/\.$/, "") + notationNote : e.message}`);
      return undefined;
    }
  };

  const given = (block.given ?? []).flatMap(mathSpans).map((g, i) => read(g, `given ${i + 1}`));
  if (!block.steps?.length) problems.push("needs numbered steps '1. … $maths$'; the last step is the target");
  const steps: DeriveStep[] = [];
  const milestones: number[] = [];
  (block.steps ?? []).forEach((s, index) => {
    const tex = mathSpans(s.tex).at(-1) ?? "";
    const step: DeriveStep = { index, md: s.md, tex, ...(s.hint !== undefined ? { hint: s.hint } : {}), ...(s.justify ? { justify: s.justify } : {}) };
    if (s.justify) {
      // Shown, not typed: maths the checker can't read (E[·], Var, plim) is fine here.
      try {
        if (tex) step.statement = parseStatement(tex, table);
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
      }
      if (!s.justify.options.some((o) => o.correct)) problems.push(`step ${index + 1}: justify needs '- [x]' on the right option`);
      if (s.justify.options.length < 2) problems.push(`step ${index + 1}: justify needs at least two options`);
    } else if (!tex) problems.push(`step ${index + 1}: the step's maths must be the last $…$ on its line`);
    else {
      const st = read(tex, `step ${index + 1}`);
      if (st) step.statement = st;
      milestones.push(index);
      step.milestone = milestones.length;
    }
    steps.push(step);
  });
  const accept = (block.accept ?? []).flatMap(mathSpans).map((a, i) => read(a, `accept ${i + 1}`));
  const reject = (block.reject ?? []).map((r, i) => {
    const tex = mathSpans(r.tex)[0] ?? "";
    return { form: read(tex, `reject ${i + 1}`), message: rejectMessage(r.tex, r.md) };
  });
  if (problems.length) return { problems };

  const inheritedUsed = table.all().flatMap((s) => (s.from !== undefined ? [{ key: s.key, from: s.from }] : []));
  return {
    problems,
    runtime: {
      title: block.title,
      objectives: block.objectives ?? [],
      table,
      derivation: {
        table,
        given: given as Statement[],
        steps: milestones.map((i) => steps[i]!.statement!),
        accept: accept as Statement[],
        reject: reject.map((r) => ({ form: r.form!, message: r.message })),
      },
      steps,
      milestones,
      inherited: inheritedUsed,
    },
  };
}

function declarationsOk(decl: Parameters<typeof declare>[0]): boolean {
  try {
    declare({ ...decl, define: [] });
    return true;
  } catch {
    return false;
  }
}

/** The author's message. `md` is the text after the dash; tolerate an exporter that passes the whole line. */
function rejectMessage(tex: string, md: string): string {
  let m = md.trim();
  const lead = /^\$[^$]+\$\s*/.exec(m);
  if (lead && mathSpans(tex)[0] === mathSpans(lead[0])[0]) m = m.slice(lead[0].length);
  m = m.replace(/^(?:—|--|-)\s*/, "").trim();
  return m || "That's a common mistake.";
}

/** The runtime derivation for a block. Throws DeriveIRError (with every problem) if the block doesn't build; run
 *  `selfTest` at validate time so that never happens in the player. */
export function fromIR(block: DeriveBlockIR, opts: FromIROptions = {}): DeriveRuntime {
  const { runtime, problems } = buildRuntime(block, opts);
  if (!runtime) throw new DeriveIRError(problems);
  return runtime;
}

// ---- checking a line -------------------------------------------------------------------------------------------

export interface DeriveState {
  /** Lines the student entered that were accepted (anything but an error), as typed. */
  lines: string[];
  /** The furthest milestone reached (1-based); 0 before any. */
  reached: number;
  /** The target has been reached. */
  done: boolean;
}

export function initialState(): DeriveState {
  return { lines: [], reached: 0, done: false };
}

export type CheckVerdict = Verdict & {
  /** Block step index of the milestone or target reached. */
  index?: number;
  /** The author's `hint:` for the step the student is now working toward, if any (shown on request). */
  stepHint?: string;
};

export interface CheckResult {
  verdict: CheckVerdict;
  state: DeriveState;
}

export interface CheckOptions {
  seed?: number;
}

/** Previous lines: the givens, the justify steps already reached, and the student's accepted lines. */
export function pathState(rt: DeriveRuntime, state: DeriveState): PathState {
  const next = rt.milestones[state.reached] ?? rt.steps.length;
  const shown = rt.steps.filter((s) => s.justify && s.statement && s.index < next).map((s) => s.statement!);
  const typed: Statement[] = [];
  for (const line of state.lines) {
    try {
      typed.push(parseStatement(line, rt.table));
    } catch {
      // A stored line from an older version of the block: skip it.
    }
  }
  return { lines: [...rt.derivation.given, ...shown, ...typed], reached: state.reached };
}

function nextHint(rt: DeriveRuntime, reached: number): string | undefined {
  const i = rt.milestones[reached];
  return i === undefined ? undefined : rt.steps[i]!.hint;
}

/** Classify one typed line: target, milestone k, valid (a correct new line), valid-no-progress (a repeat, with a
 *  hint) or error (with a message). Only the target sets `done`; any true line joins `lines`. Errors
 *  leave the state unchanged. */
export function check(rt: DeriveRuntime, state: DeriveState, input: string, opts: CheckOptions = {}): CheckResult {
  if (!rt.milestones.length) {
    return { verdict: { kind: "error", message: "This derivation has nothing to type: answer the questions on each step." }, state };
  }
  const v = classify(rt.derivation, input, pathState(rt, state), opts.seed !== undefined ? { seed: opts.seed } : {});
  if (v.kind === "error") {
    const hint = nextHint(rt, state.reached);
    return { verdict: { ...v, ...(hint ? { stepHint: hint } : {}) }, state };
  }
  const lines = [...state.lines, input];
  if (v.kind === "target") {
    const reached = rt.milestones.length;
    return { verdict: { ...v, index: rt.milestones[reached - 1]! }, state: { lines, reached, done: true } };
  }
  const reached = v.kind === "milestone" ? Math.max(state.reached, v.step) : state.reached;
  const hint = nextHint(rt, reached);
  const verdict: CheckVerdict = { ...v, ...(v.kind === "milestone" ? { index: rt.milestones[v.step - 1]! } : {}), ...(hint ? { stepHint: hint } : {}) };
  return { verdict, state: { lines, reached, done: state.done } };
}
