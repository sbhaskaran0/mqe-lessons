// The student's own route: correct lines are never rejected or discouraged, whatever their algebraic shape, and a
// wrong line is told where it seems to go wrong. The reproductions are from testing the Econ 402A L1 golden-rule
// block; the audit types every valid alternate form (alternates.ts) of every milestone of every real block and
// fixture, from every state on the way. AUDIT_DEEP=1 adds second moves (about 70,000 forms, a few minutes).
import { describe, expect, it } from "vitest";
import { check, classify, fromIR, initialState, startState } from "../../src/derive";
import { auditBlock, realBlocks } from "./alternates";
import { fixtures, ols, residualMaker, solow } from "./fixtures";

const golden = () => fromIR(realBlocks().find((b) => b.name.includes("golden rule"))!.block);
const STEP2 = "kbar=(alpha*A/delta)^(1/(1-alpha))";

describe("the golden rule block (Econ 402A L1)", () => {
  const rt = golden();
  const at2 = check(rt, initialState(), STEP2).state;

  it("reaches step 2", () => {
    expect(at2).toMatchObject({ reached: 1, done: false });
  });

  it("calls the powered form of the answer a correct line, says to solve for s, and keeps it on the page", () => {
    const line = "((alpha*A)/delta)^(1/(1-alpha))=((s*A)/delta)^(1/(1-alpha))";
    const r = check(rt, at2, line);
    expect(r.verdict).toMatchObject({ kind: "valid", hint: "That's equivalent to the answer. Now solve for $s$." });
    expect(r.state).toEqual({ lines: [STEP2, line], reached: 1, done: false });
    // Typed again it is a repeat, and still says what to do.
    expect(check(rt, r.state, line).verdict).toMatchObject({ kind: "valid-no-progress", hint: "True, but you already have that. Now solve for $s$." });
    // Building on it finishes.
    expect(check(rt, r.state, "s = alpha").verdict.kind).toBe("target");
  });

  it("finishes only on the solved form or the author's accept form (up to a factor free of s)", () => {
    for (const line of ["(alpha*A)/delta=(s*A)/delta", "alpha*A=s*A", "s=alpha", "alpha = s", "s/alpha = 1"]) expect(check(rt, at2, line).verdict.kind, line).toBe("target");
    for (const line of ["ln(s) = ln(alpha)", "1/s = 1/alpha", "s^2 = alpha^2", "((alpha*A)/delta)^2 = ((s*A)/delta)^2"]) {
      const r = check(rt, at2, line);
      expect(r.verdict, line).toMatchObject({ kind: "valid", hint: "That's equivalent to the answer. Now solve for $s$." });
      expect(r.state.done).toBe(false);
    }
  });

  it("says a restatement of step 2 is a repeat", () => {
    expect(check(rt, at2, "(alpha A/delta)^(1/(1-alpha)) = kbar").verdict).toMatchObject({ kind: "valid-no-progress", hint: "True, but you already have that." });
  });

  it("names a wrong exponent without giving the step away", () => {
    const v = check(rt, initialState(), "(delta/(alpha*A))^(1/(-alpha-1))=kbar").verdict;
    expect(v).toMatchObject({ kind: "error", message: String.raw`Check the exponent: yours simplifies to $-\frac{1}{1 + \alpha}$.` });
    if (v.kind === "error") expect(v.message).not.toMatch(/alpha - 1|1 - \\alpha/);
  });

  it("still accepts the alternate forms of step 2 from the start, and s = α as the target", () => {
    for (const line of ["(delta/(alpha*A))^(1/(alpha-1))=kbar", "kbar^(alpha-1)=delta/(alpha*A)", "alpha*A/kbar^(1-alpha)=delta"])
      expect(check(rt, initialState(), line).verdict, line).toMatchObject({ kind: "milestone", step: 1 });
    expect(check(rt, initialState(), "s=alpha").verdict.kind).toBe("target");
  });
});

describe("identity proofs", () => {
  const m = residualMaker.callout.derivation;

  it("folds a number inside an inverse, so a scaled spelling of the target is the target", () => {
    expect(classify(m, "(I - 2X(2X'X)^{-1}X')X = 0").kind).toBe("target");
  });

  it("calls a line true only because of the definitions correct, and a tautology no progress", () => {
    expect(classify(m, "MM = M").kind).toBe("valid");
    expect(classify(m, "X = X")).toMatchObject({ kind: "valid-no-progress", hint: expect.stringMatching(/holds whatever the values/) });
  });
});

describe("where a wrong line goes wrong", () => {
  const d = solow.callout.derivation;
  const message = (line: string, dd = d) => {
    const v = classify(dd, line);
    return v.kind === "error" ? v.message : v.kind;
  };

  it("names the slip: exponent, missing factor, stray term, sign, flipped fraction", () => {
    expect(message("kbar = (sA/delta)^(1/(1+alpha))")).toBe(String.raw`Check the exponent: yours is $\frac{1}{1 + \alpha}$.`);
    expect(message("kbar = (sA/delta)^(1/(-alpha))")).toBe(String.raw`Check the exponent: yours simplifies to $-\frac{1}{\alpha}$.`);
    expect(message("s A kbar^alpha = delta")).toBe(String.raw`Check the factors: one side of your line is missing a factor of $\bar{k}$.`);
    expect(message("kbar = (sA/delta)^(1/(1-alpha)) + 1")).toBe("Check the term $1$: your line has it where it doesn't belong.");
    expect(message("-kbar = (sA/delta)^(1/(1-alpha))")).toBe("Check the sign: one side of your line has the opposite sign.");
    expect(message("b_2 = sum((x-xbar)^2)/sum((x-xbar)(y-ybar))", ols.callout.derivation)).toBe(
      "Check the fraction: one side of your line is upside down (the reciprocal of what it should be).",
    );
  });

  it("lets the author's reject message and the bracket diagnosis come first", () => {
    expect(message("kbar = (sA/delta)^(1/alpha)")).toBe(d.reject[0]!.message);
    expect(message("kbar = (sA/δ)^1/(1−α)")).toBe("An exponent that is a fraction needs brackets: did you mean kbar = (sA/δ)^(1/(1−α))?");
  });

  it("keeps the generic message when no slip is recognisable", () => {
    expect(message("kbar = s A kbar^alpha / delta + kbar")).toBe("That doesn't follow from the previous lines.");
  });

  it("compares with the next step, not one already reached", () => {
    // From step 2, a missing k̄ on the right is still named against the target's accept form.
    const v = classify(d, "kbar^(1-alpha) = s A", { ...startState(d), reached: 2 });
    expect(v).toMatchObject({ kind: "error", message: String.raw`Check the factors: one side of your line has an extra factor of $\delta$.` });
  });
});

describe("alternate-route audit", () => {
  const blocks = [
    ...realBlocks().filter((b) => b.block.steps.some((s) => !s.justify)),
    ...fixtures.map((f) => ({ name: `fixture: ${f.name}`, block: f.ir })),
  ];
  const deep = !!process.env.AUDIT_DEEP;
  const totals = { tried: 0, rejected: 0, discouraged: 0 };

  it.each(blocks.map((b) => [b.name, b] as const))("%s: every valid alternate form is accepted and none is discouraged", (_, { name, block }) => {
    const row = auditBlock(name, block, { deep });
    totals.tried += row.tried;
    totals.rejected += row.rejected.length;
    totals.discouraged += row.discouraged.length;
    const show = (cs: typeof row.rejected) => cs.slice(0, 8).map((c) => `state ${c.state}, step ${c.step} [${c.how}] ${c.verdict}: ${c.input}${c.message ? ` (${c.message})` : ""}`).join("\n");
    expect(row.tried).toBeGreaterThan(0);
    expect(row.unreadable).toBe(0);
    expect(row.rejected, show(row.rejected)).toHaveLength(0);
    expect(row.discouraged, show(row.discouraged)).toHaveLength(0);
  }, 600_000);

  it("reports", () => {
    if (process.env.E0_REPORT) console.log(`alternate forms: ${totals.tried} tried, ${totals.rejected} rejected, ${totals.discouraged} discouraged${deep ? " (deep)" : ""}`);
  });
});
