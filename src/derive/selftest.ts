// The build-time check of one derive block (e0-checker.md, "The build checks these"; phase2-contracts.md §1
// `validate.ts`). `npm run validate` calls `selfTest(block, {seed})` through src/validate/derive-adapter.ts and
// prefixes each message with the note, step and title.
//
//   - every step, given, accept and reject parses against the declared and inherited symbols;
//   - the declared domains can be sampled, and every given, typed step and accept form can be evaluated;
//   - the last typed step classifies as the target;
//   - each typed step follows from the givens, the justify steps and the typed steps before it;
//   - every accept form classifies as the target;
//   - every reject form is an error showing its own message (so none is true, and none is equivalent to the target).
import { type Node, type Statement, children, isEquation, symbolsOf, withChildren } from "./ast";
import { classify, startState, unknownsOf, type Verdict } from "./classify";
import { equivalent, impliedBy, probe, sameStep, solveVariable } from "./equivalence";
import type { DeriveBlockIR } from "./ir-shape";
import { buildRuntime, type DeriveRuntime, type FromIROptions, quote } from "./runtime";
import { rng, sampleEnv } from "./sample";

export interface SelfTestOptions extends FromIROptions {
  seed?: number;
}

const label = (v: Verdict) => (v.kind === "milestone" ? `milestone ${v.step}` : v.kind);

export function selfTest(block: DeriveBlockIR, opts: SelfTestOptions = {}): string[] {
  const { runtime, problems } = buildRuntime(block, opts);
  if (!runtime) return problems;
  try {
    return run(runtime, block, opts.seed ?? 1);
  } catch (e) {
    return [`the checker failed on this block: ${(e as Error).message}`];
  }
}

function run(rt: DeriveRuntime, block: DeriveBlockIR, seed: number): string[] {
  const errors: string[] = [];
  const { table, derivation: d } = rt;

  for (const s of table.all()) {
    if (s.domain.kind === "range" && !(Number.isFinite(s.domain.lo) && Number.isFinite(s.domain.hi) && s.domain.lo < s.domain.hi))
      errors.push(`symbols: ${table.typed(s.key)} has an empty range (${s.domain.lo}, ${s.domain.hi})`);
  }
  if (errors.length) return errors;
  try {
    const r = rng(seed);
    for (let i = 0; i < 3; i++) sampleEnv(table, r);
  } catch (e) {
    return [`declarations: can't draw values for the symbols: ${(e as Error).message}`];
  }

  const evaluable = (st: Statement, what: string) => {
    if (!isEquation(st)) return;
    const p = probe(st, table, seed);
    if (p.problem) errors.push(`${what}: can't be evaluated: ${p.problem}`);
  };
  d.given.forEach((g, i) => evaluable(g, `given ${i + 1} ${quote(block.given[i] ?? "")}`));
  rt.milestones.forEach((idx) => evaluable(rt.steps[idx]!.statement!, `step ${idx + 1} ${quote(rt.steps[idx]!.tex)}`));
  d.accept.forEach((a, i) => evaluable(a, `accept ${i + 1} ${quote(block.accept[i] ?? "")}`));
  if (errors.length || !rt.milestones.length) return errors;

  const opts = { seed };
  const unknowns = unknownsOf(d);
  const lastIdx = rt.milestones.at(-1)!;
  const target = classify(d, d.steps.at(-1)!, startState(d), opts);
  if (target.kind !== "target")
    errors.push(`step ${lastIdx + 1} ${quote(rt.steps[lastIdx]!.tex)}: the last typed step is the target, but it classifies as ${label(target)}`);

  // Each typed step follows from what comes before it.
  rt.milestones.forEach((idx, k) => {
    const step = rt.steps[idx]!;
    const before: Statement[] = [
      ...d.given,
      ...rt.steps.filter((s) => s.index < idx && s.statement && (s.justify || s.milestone !== undefined)).map((s) => s.statement!),
    ];
    if (!before.length && k === 0) return; // nothing to follow from: the first step is where the student starts
    if (!follows(step.statement!, before, rt, unknowns, seed))
      errors.push(
        `step ${idx + 1} ${quote(step.tex)}: doesn't follow from the givens and the steps before it — check the algebra, or add the missing fact as a given:`,
      );
  });

  d.accept.forEach((a, i) => {
    const what = `accept ${i + 1} ${quote(block.accept[i] ?? "")}`;
    const v = classify(d, a, startState(d), opts);
    if (v.kind !== "target") {
      errors.push(`${what}: should reach the target but classifies as ${label(v)}${v.kind === "error" ? ` ("${v.message}")` : ""}`);
      return;
    }
    // An accept form that is an earlier step in disguise would let that step finish the derivation.
    const k = d.steps.slice(0, -1).findIndex((s) => sameStep(a, s, table, solveVariable(a, s, table, unknowns), seed));
    if (k >= 0) {
      const idx = rt.milestones[k]!;
      errors.push(`${what}: is the same step as step ${idx + 1}, so typing step ${idx + 1} would already count as reaching the target`);
    }
  });

  d.reject.forEach((r, i) => {
    const v = classify(d, r.form, startState(d), opts);
    const what = `reject ${i + 1} ${quote(block.reject[i]?.tex ?? "")}`;
    if (v.kind === "target") errors.push(`${what}: is equivalent to the target, so it can never be shown — fix or remove it`);
    else if (v.kind !== "error") errors.push(`${what}: is true (it classifies as ${label(v)}), so it can never be shown — fix or remove it`);
    else if (v.message !== r.message)
      errors.push(
        v.reject !== undefined
          ? `${what}: shows the message of reject ${v.reject + 1} instead, which matches it first — merge them or reorder`
          : `${what}: isn't matched to its own message (the student would see "${v.message}")`,
      );
  });
  return errors;
}

/** Equivalent to an earlier line, true everywhere, a consequence of all the earlier lines together, or an earlier
 *  line with some symbols set equal to a new one (the steady-state step k_{t+1} = k_t = k̄). */
function follows(st: Statement, before: Statement[], rt: DeriveRuntime, unknowns: string[], seed: number): boolean {
  const { table } = rt;
  const opts = { seed, solveFor: unknowns };
  if (before.some((l) => equivalent(st, l, table, opts).equivalent)) return true;
  if (isEquation(st) && probe(st, table, seed).identity) return true;
  if (impliedBy(st, before, table, unknowns, seed)) return true;
  const mine = symbolsOf(st);
  for (const l of before) {
    const theirs = symbolsOf(l);
    const gone = [...theirs].filter((k) => !mine.has(k) && table.get(k)?.kind === "scalar");
    const fresh = [...mine].filter((k) => !theirs.has(k) && table.get(k)?.kind === "scalar");
    if (!gone.length) continue;
    for (const u of fresh) {
      const sub = substitute(l, new Map(gone.map((g) => [g, u])));
      if (equivalent(st, sub, table, opts).equivalent) return true;
    }
  }
  return false;
}

function substitute<S extends Statement>(s: S, map: Map<string, string>): S {
  if (s.t === "eq") return { ...s, l: substitute(s.l, map), r: substitute(s.r, map) };
  const n = s as Node;
  if (n.t === "sym") return (map.has(n.key) ? { t: "sym", key: map.get(n.key)! } : n) as S;
  return withChildren(n, children(n).map((c) => substitute(c, map))) as S;
}
