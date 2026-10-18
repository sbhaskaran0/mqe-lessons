// The three E0 derivations end to end: every accept form lands where it should on the path, every reject form is an
// error with the author's message, and the path state moves as a student works through.
import { describe, expect, it } from "vitest";
import { classify, parseStatement, startState, type Verdict } from "../../src/derive";
import { fixtures, ols, residualMaker, solow } from "./fixtures";

const label = (v: Verdict) => (v.kind === "milestone" ? `milestone ${v.step}` : v.kind);

describe.each(fixtures)("$name", (f) => {
  const d = f.callout.derivation;

  it("has enough forms to be a fair test", () => {
    expect(f.accept.filter(([, want]) => want === "target").length).toBeGreaterThanOrEqual(10);
    expect(f.reject.length).toBeGreaterThanOrEqual(5);
  });

  it.each(f.accept)("accepts %s as %s", (src, want) => {
    expect(label(classify(d, src))).toBe(want);
  });

  it.each(f.reject)("rejects %s", (src, index) => {
    const v = classify(d, src);
    expect(v.kind).toBe("error");
    if (index !== undefined && v.kind === "error") expect(v.message).toBe(d.reject[index]!.message);
  });
});

describe("the path", () => {
  const d = solow.callout.derivation;

  it("moves forward through milestones and allows skipping to the target", () => {
    const state = startState(d);
    const first = classify(d, "kbar = s A kbar^alpha + (1 - delta) kbar", state);
    expect(first).toMatchObject({ kind: "milestone", step: 2 });
    state.reached = 2;
    expect(classify(d, "sAkbar^alpha = delta kbar", state).kind).toBe("valid-no-progress");
    expect(classify(d, "kbar = (sA/delta)^(1/(1-alpha))", startState(d)).kind).toBe("target");
  });

  it("says when a line is equivalent to the answer but not yet solved: correct, and one move short", () => {
    const v = classify(d, "(1-alpha) ln(kbar) = ln(s A / delta)", { lines: [...d.given], reached: 2 });
    expect(v).toMatchObject({ kind: "valid", hint: String.raw`That's equivalent to the answer. Now solve for $\bar{k}$.` });
    // Typed again, it is a repeat, and still says what to do next.
    const lines = [...d.given, parseStatement("(1-alpha) ln(kbar) = ln(s A / delta)", d.table)];
    expect(classify(d, "ln(kbar) (1-alpha) = ln(s A / delta)", { lines, reached: 2 })).toMatchObject({
      kind: "valid-no-progress",
      hint: String.raw`True, but you already have that. Now solve for $\bar{k}$.`,
    });
  });

  it("calls a restatement of a line on the page a repeat, and a new move on it a correct line", () => {
    const at2 = { lines: [...d.given], reached: 2 };
    expect(classify(d, "delta kbar = s A kbar^alpha", at2)).toMatchObject({ kind: "valid-no-progress", hint: expect.stringMatching(/^True, but you already have that\./) });
    expect(classify(d, "2 s A kbar^alpha - 2 delta kbar = 0", at2).kind).toBe("valid-no-progress");
    expect(classify(d, "ln s + ln A + alpha ln kbar = ln delta + ln kbar", at2).kind).toBe("valid");
    expect(classify(d, "s A kbar^alpha kbar = delta kbar^2", at2).kind).toBe("valid");
  });

  it("treats tautologies as true but not progress", () => {
    expect(classify(d, "kbar = kbar")).toMatchObject({ kind: "valid-no-progress", hint: expect.stringMatching(/holds whatever the values/) });
  });

  it("returns parse errors with suggestions and the reading of good lines", () => {
    expect(classify(d, "kt = 1")).toMatchObject({ kind: "error", suggestions: ["k_t"] });
    expect(classify(d, "sAkbar^alpha = delta kbar")).toMatchObject({ latex: String.raw`s\,A\,\bar{k}^{\alpha} = \delta\,\bar{k}` });
  });

  it("counts a step that only restates a given as reached", () => {
    // b_1 = ȳ − b_2 x̄ is the first condition divided by n: the same equation, so restating the condition reaches it.
    const o = ols.callout.derivation;
    expect(classify(o, "sum(y_i - b_1 - b_2 x_i) = 0")).toMatchObject({ kind: "milestone", step: 1 });
    expect(classify(o, "b_1 = ybar - b_2 xbar", { lines: [...o.given], reached: 1 }).kind).toBe("valid-no-progress");
  });

  it("accepts true consequences of the whole system that are not authored steps", () => {
    const o = ols.callout.derivation;
    // Correct lines on the student's own route: encouraged, not "no progress".
    expect(classify(o, "sum((1 + x_i)(y_i - b_1 - b_2 x_i)) = 0").kind).toBe("valid");
    expect(classify(o, "b_1 = ybar - xbar sum((x-xbar)(y-ybar))/sum((x-xbar)^2)").kind).toBe("valid");
    expect(classify(o, "b_1 = ybar - xbar sum(x y)/sum(x^2)").kind).toBe("error");
  });

  it("explains one-sided steps and unbracketed fractional exponents", () => {
    expect(classify(d, "(kbar-2)^2 (s A kbar^alpha - delta kbar) = 0")).toMatchObject({ kind: "error", message: expect.stringMatching(/also allows other values/) });
    expect(classify(d, "kbar = (sA/δ)^1/(1−α)")).toMatchObject({ kind: "error", message: "An exponent that is a fraction needs brackets: did you mean kbar = (sA/δ)^(1/(1−α))?" });
  });

  it("separates true matrix statements that are not steps of this derivation", () => {
    const m = residualMaker.callout.derivation;
    expect(classify(m, "M = M'")).toMatchObject({ kind: "valid-no-progress", hint: expect.stringMatching(/holds whatever the values/) });
    expect(classify(m, "X^-1")).toMatchObject({ kind: "error", message: "This step needs an equation (with =)." });
  });

  it("explains a shape error in a matrix step", () => {
    expect(classify(residualMaker.callout.derivation, "XM = 0")).toMatchObject({ kind: "error", message: expect.stringMatching(/^Can't multiply a \d+×\d+ matrix by a \d+×\d+ matrix\.$/) });
  });
});
