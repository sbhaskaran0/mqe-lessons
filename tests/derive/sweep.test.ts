// E0/E1 measurements: false-accept rate on ~200 mutants per derivation (against substitution ground truth), false-reject
// rate on every accept form over 20 seeds, and time per check. The numbers go into docs/proposals/e0-checker.md;
// set E0_REPORT=1 to print the table and E0_MUTANTS=<n> for a bigger sweep.
import { describe, expect, it } from "vitest";
import { check, classify, fromIR, initialState, parseStatement, selfTest, startState, type Verdict } from "../../src/derive";
import { toLatex } from "../../src/derive/latex";
import { type Fixture, fixtures } from "./fixtures";
import { mutations, truth } from "./mutate";

const label = (v: Verdict) => (v.kind === "milestone" ? `milestone ${v.step}` : v.kind);

function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
}

interface Row {
  derivation: string;
  mutants: number;
  validMutants: number;
  acceptedMutants: number;
  unsound: number;
  falseTarget: number;
  missedTarget: number;
  acceptRuns: number;
  falseRejects: number;
  medianMs: number;
  p95Ms: number;
  examples: string[];
}

const rows: Row[] = [];

function sweep(f: Fixture): Row {
  const d = f.callout.derivation;
  const times: number[] = [];
  const timed = (input: Parameters<typeof classify>[1], seed?: number) => {
    const t0 = performance.now();
    const v = classify(d, input, startState(d), seed === undefined ? {} : { seed });
    times.push(performance.now() - t0);
    return v;
  };

  const perForm = Math.ceil(Number(process.env.E0_MUTANTS ?? 200) / f.mutate.length);
  const mutants = f.mutate.flatMap((src) => mutations(parseStatement(src, d.table), d.table, perForm));
  let unsound = 0;
  let falseTarget = 0;
  let missedTarget = 0;
  let validMutants = 0;
  let acceptedMutants = 0;
  const examples: string[] = [];
  for (const m of mutants) {
    const v = timed(m);
    const gt = truth(d, f.solution, m);
    if (gt.holds) validMutants++;
    if (v.kind !== "error") acceptedMutants++;
    if (v.kind !== "error" && !gt.holds) {
      unsound++;
      examples.push(`accepted (${label(v)}) but false: ${toLatex(m, d.table)}`);
    }
    if (f.solution.length && v.kind === "target" && !gt.target) {
      falseTarget++;
      examples.push(`target but not the answer: ${toLatex(m, d.table)}`);
    }
    if (gt.target && v.kind !== "target") missedTarget++;
  }

  let falseRejects = 0;
  let acceptRuns = 0;
  for (const [src, want] of f.accept)
    for (let seed = 1; seed <= 20; seed++) {
      acceptRuns++;
      const v = timed(src, seed * 7919);
      if (label(v) !== want) {
        falseRejects++;
        if (examples.length < 12) examples.push(`seed ${seed * 7919}: "${src}" gave ${label(v)}, want ${want}`);
      }
    }

  return {
    derivation: f.name,
    mutants: mutants.length,
    validMutants,
    acceptedMutants,
    unsound,
    falseTarget,
    missedTarget,
    acceptRuns,
    falseRejects,
    medianMs: percentile(times, 0.5),
    p95Ms: percentile(times, 0.95),
    examples,
  };
}

describe("E0 sweep", () => {
  for (const f of fixtures) {
    it(`${f.name}: no false accepts on mutants, no false rejects over 20 seeds`, () => {
      const row = sweep(f);
      rows.push(row);
      expect(row.mutants).toBeGreaterThanOrEqual(f.mutate.length > 1 ? 150 : 100);
      expect(row.unsound, row.examples.join("\n")).toBe(0);
      expect(row.falseTarget, row.examples.join("\n")).toBe(0);
      expect(row.falseRejects, row.examples.join("\n")).toBe(0);
    }, 120_000);
  }

  // The player's path: a fresh runtime (cold caches), then every accept and reject form through check().
  const perf: string[] = [];
  // The 50 ms budget is measured on a quiet machine (MQE_PERF=1 or E0_REPORT=1). In ordinary runs this laptop's
  // throttling swings timings 3–4×, so only a pathological slowdown fails.
  const budgetMs = process.env.MQE_PERF || process.env.E0_REPORT ? 50 : 250;
  it(`check() keeps p95 within ${budgetMs} ms on the fixture forms, cold start included`, () => {
    for (const f of fixtures) {
      const t0 = performance.now();
      const rt = fromIR(f.ir);
      const built = performance.now() - t0;
      const times: number[] = [];
      for (const src of [...f.accept.map(([s]) => s), ...f.reject.map(([s]) => s)]) {
        const t = performance.now();
        check(rt, initialState(), src);
        times.push(performance.now() - t);
      }
      const t1 = performance.now();
      selfTest(f.ir);
      const self = performance.now() - t1;
      perf.push(`| ${f.name} | ${built.toFixed(1)} | ${times[0]!.toFixed(1)} | ${percentile(times, 0.5).toFixed(1)} | ${percentile(times, 0.95).toFixed(1)} | ${Math.max(...times).toFixed(1)} | ${self.toFixed(0)} |`);
      expect(percentile(times, 0.95), f.name).toBeLessThanOrEqual(budgetMs);
    }
  }, 60_000);

  it("reports", () => {
    if (!process.env.E0_REPORT) return;
    const fmt = (r: Row) =>
      `| ${r.derivation} | ${r.mutants} | ${r.validMutants} | ${r.acceptedMutants} | ${r.unsound} | ${r.falseTarget} | ${r.missedTarget} | ${r.falseRejects}/${r.acceptRuns} | ${r.medianMs.toFixed(1)} | ${r.p95Ms.toFixed(1)} |`;
    console.log(["| derivation | mutants | true mutants | accepted mutants | unsound accepts | false target | missed target | false rejects | median ms | p95 ms |", ...rows.map(fmt)].join("\n"));
    for (const r of rows) if (r.examples.length) console.log(r.derivation, r.examples);
    console.log(["| derivation | fromIR ms | first check ms | median ms | p95 ms | max ms | selfTest ms |", ...perf].join("\n"));
  });
});
