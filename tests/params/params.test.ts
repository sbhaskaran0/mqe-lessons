// Parameterized numeric checks: seeded variants and the build-time self-test (src/params).
import { describe, expect, it } from "vitest";
import type { NumericCheck } from "../../src/ir";
import { draw, inRange, instantiate, SELF_TEST_SEEDS, selfTestParams } from "../../src/params";
import { rng } from "../../src/derive/sample";

// The fixture lecture's varied check, as `vault_tool.py export` writes it.
const KBAR: NumericCheck = {
  t: "check",
  kind: "numeric",
  prompt: "With $s = 0.3$, $A = 1$, $\\alpha = 0.5$ and $\\delta = 0.1$, what is steady-state capital $\\bar{k}$?",
  answer: 9,
  tol: 0.09,
  vary: [{ sym: "s", lo: 0.2, hi: 0.4, step: 0.05 }, { sym: "\\delta", values: [0.05, 0.08, 0.1] }],
  compute: "\\left(\\frac{sA}{\\delta}\\right)^{\\frac{1}{1-\\alpha}}",
  bindings: [
    { sym: "s", value: 0.3, span: "$s = 0.3$" },
    { sym: "A", value: 1, span: "$A = 1$" },
    { sym: "\\alpha", value: 0.5, span: "$\\alpha = 0.5$" },
    { sym: "\\delta", value: 0.1, span: "$\\delta = 0.1$" },
  ],
  wrongCompute: [{ tex: "sA/\\delta", md: "that is $sA/\\delta$ before the power, here with $s = 0.3$" }],
  why: "Square $sA/\\delta$: with $s = 0.3$ and $\\delta = 0.1$ that is 9.",
};

const kbar = (s: number, delta: number) => (s / delta) ** 2;

describe("instantiate", () => {
  it("seed 0 or none is the base variant, text unchanged", () => {
    for (const seed of [undefined, 0]) {
      const v = instantiate(KBAR, seed);
      expect([v.prompt, v.why, v.answer, v.tol]).toEqual([KBAR.prompt, KBAR.why, 9, 0.09]);
      expect(v.values).toEqual({ s: 0.3, A: 1, "\\alpha": 0.5, "\\delta": 0.1 });
      expect(v.wrong).toEqual([{ answer: 3, tol: 0.09, md: KBAR.wrongCompute![0]!.md }]);
    }
  });

  it("is deterministic per seed, and seeds differ", () => {
    expect(instantiate(KBAR, 7)).toEqual(instantiate(KBAR, 7));
    const draws = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(instantiate(KBAR, i + 1).values)));
    expect(draws.size).toBeGreaterThan(5);
  });

  it("rewrites the binding spans in the prompt, the why and the feedback, and recomputes", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const v = instantiate(KBAR, seed);
      const s = v.values.s!;
      const delta = v.values["\\delta"]!;
      expect(v.prompt).toBe(`With $s = ${s}$, $A = 1$, $\\alpha = 0.5$ and $\\delta = ${delta}$, what is steady-state capital $\\bar{k}$?`);
      // Only the spans change: a worked number outside a span ("that is 9") still refers to the base case.
      expect(v.why).toBe(`Square $sA/\\delta$: with $s = ${s}$ and $\\delta = ${delta}$ that is 9.`);
      expect(v.wrong[0]!.md).toBe(`that is $sA/\\delta$ before the power, here with $s = ${s}$`);
      expect(v.answer).toBeCloseTo(kbar(s, delta), 9);
      expect(v.wrong[0]!.answer).toBeCloseTo(s / delta, 9);
    }
  });

  it("scales the tolerance with the answer, so 1% stays 1%", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const v = instantiate(KBAR, seed);
      expect(v.tol / v.answer).toBeCloseTo(0.01, 12);
      expect(v.wrong[0]!.tol).toBe(v.tol);
    }
    // An absolute tolerance scales the same way; at a zero base answer it stays as written.
    const zero = instantiate({ ...KBAR, answer: 0, tol: 0.5, compute: "s - 0.3" }, 3);
    expect(zero.tol).toBe(0.5);
  });

  it("rewrites a span that binds several symbols part by part", () => {
    const c: NumericCheck = {
      t: "check", kind: "numeric", prompt: "With $a = 2, b = 3$, what is $a + b$?", answer: 5, tol: 0.01, why: "Add.",
      vary: [{ sym: "a", values: [4, 6] }], compute: "a + b",
      bindings: [{ sym: "a", value: 2, span: "$a = 2, b = 3$" }, { sym: "b", value: 3, span: "$a = 2, b = 3$" }],
    };
    const v = instantiate(c, 1);
    expect(v.prompt).toBe(`With $a = ${v.values.a}, b = 3$, what is $a + b$?`);
    expect(v.answer).toBe(v.values.a! + 3);
  });

  it("gives a plain check its base variant at every seed", () => {
    const plain: NumericCheck = { t: "check", kind: "numeric", prompt: "Q", answer: 2, tol: 0, why: "w", wrong: [{ answer: 3, tol: 0, md: "m" }] };
    expect(instantiate(plain, 5)).toEqual({ prompt: "Q", why: "w", answer: 2, tol: 0, wrong: plain.wrong, values: {} });
  });
});

describe("draw", () => {
  it("lands on the step grid, in the set, or rounded to the bounds' decimals", () => {
    const next = rng(11);
    for (let i = 0; i < 200; i++) {
      const g = draw({ sym: "s", lo: 0.2, hi: 0.4, step: 0.05 }, next);
      expect([0.2, 0.25, 0.3, 0.35, 0.4]).toContain(g);
      expect([1, 2]).toContain(draw({ sym: "x", values: [1, 2] }, next));
      const u = draw({ sym: "x", lo: 1.5, hi: 2.25 }, next);
      expect(inRange({ sym: "x", lo: 1.5, hi: 2.25 }, u)).toBe(true);
      expect(String(u).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(2);
    }
  });
});

describe("selfTestParams", () => {
  it("passes the fixture check, and ignores a plain one", () => {
    expect(selfTestParams(KBAR)).toEqual([]);
    expect(selfTestParams({ t: "check", kind: "numeric", prompt: "Q", answer: 1, tol: 0, why: "w" })).toEqual([]);
    expect(SELF_TEST_SEEDS).toBe(20);
  });

  it("catches a base answer the formula does not give", () => {
    expect(selfTestParams({ ...KBAR, answer: 10 })).toEqual([
      "compute: gives 9 at the question's numbers, but 'answer:' is 10 ± 0.09 - fix one of them",
    ]);
  });

  it("catches a formula that does not read, or uses an unbound symbol", () => {
    expect(selfTestParams({ ...KBAR, compute: "sA/\\delta + q" })[0]).toMatch(/^compute: \$sA\/\\delta \+ q\$: I don't know the symbol "q".*every symbol needs its '\$x = <number>\$' in the question$/);
    expect(selfTestParams({ ...KBAR, wrongCompute: [{ tex: "(s", md: "m" }] })[0]).toMatch(/^wrong: \$\(s\$: /);
  });

  it("catches a draw with no finite answer, once, naming the numbers", () => {
    const errors = selfTestParams({ ...KBAR, vary: [{ sym: "\\delta", values: [0, 0.1] }], answer: 9 });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^compute: gives Infinity at \$\\delta = 0\$ - narrow the 'vary:' ranges$/);
  });

  it("catches a formula wrong answer that lands on the right one", () => {
    // s/δ equals (s/δ)² when s/δ = 1: s = 0.1 with δ = 0.1.
    const c = { ...KBAR, vary: [{ sym: "s", values: [0.1, 0.3] }], wrongCompute: [{ tex: "\\frac{s}{\\delta}", md: "m" }] };
    expect(selfTestParams(c)).toEqual([
      expect.stringMatching(/^wrong: \$\\frac\{s\}\{\\delta\}\$ gives 1 at \$s = 0\.1\$, within the right answer 1 ± 0\.01$/),
    ]);
  });

  it("catches a varied symbol with no binding", () => {
    expect(selfTestParams({ ...KBAR, vary: [...KBAR.vary!, { sym: "n", lo: 0, hi: 1 }] })).toContain(
      "vary: $n$ has no '$n = <number>$' in the question",
    );
  });
});
