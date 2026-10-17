// The numeric equivalence engine on its own: expressions, equations, matrices, sums over data, and the failure modes.
import { describe, expect, it } from "vitest";
import { declare, equivalent, parseStatement, type SymbolTable } from "../../src/derive";

const solow = declare({ symbols: "s in (0.05,0.95), A, alpha in (0.2,0.8), delta in (0.02,0.2)", unknowns: "kbar" });
const ols = declare({ dims: "n", data: "x_i, y_i", unknowns: "b_1 real, b_2 real" });
const mx = declare({ dims: "n > K", matrices: "X: n×K", define: ["P = X(X'X)^{-1}X'", "M = I_n - P"] });

function eq(table: SymbolTable, a: string, b: string) {
  return equivalent(parseStatement(a, table), parseStatement(b, table), table);
}

describe("expressions", () => {
  it("agree however they are written", () => {
    expect(eq(solow, "(sA/delta)^(1/(1-alpha))", "exp((ln s + ln A - ln delta)/(1-alpha))").equivalent).toBe(true);
    expect(eq(solow, "(s+A)^2", "s^2 + 2 s A + A^2").equivalent).toBe(true);
  });
  it("differ when a constant, exponent or symbol changes", () => {
    expect(eq(solow, "(sA/delta)^(1/(1-alpha))", "(sA/delta)^(1/alpha)").equivalent).toBe(false);
    expect(eq(solow, "(s+A)^2", "s^2 + s A + A^2").equivalent).toBe(false);
    expect(eq(solow, "s/delta", "delta/s").equivalent).toBe(false);
  });
  it("reports expressions that can't be evaluated anywhere", () => {
    expect(eq(solow, "ln(-s)", "ln(s)")).toMatchObject({ equivalent: false, problem: expect.stringMatching(/couldn't evaluate/) });
  });
});

describe("equations", () => {
  const target = "kbar = (sA/delta)^(1/(1-alpha))";
  it("accept rearranging, multiplying both sides and taking logs", () => {
    for (const form of [
      "kbar^(1-alpha) = sA/delta",
      "s A kbar^alpha = delta kbar",
      "s A kbar^alpha kbar = delta kbar^2",
      "ln s + ln A + alpha ln kbar = ln delta + ln kbar",
      "(sA/delta)^(1/(1-alpha)) = kbar",
      "kbar = sA kbar^alpha + (1-delta) kbar",
    ])
      expect(eq(solow, form, target).equivalent, form).toBe(true);
  });
  it("reject anything that moves or adds a root", () => {
    for (const form of [
      "kbar = (sA/delta)^(1/alpha)",
      "s A kbar^alpha = (1-delta) kbar",
      // multiplying by (kbar − 1), which can be zero, adds the root kbar = 1
      "(kbar - 1) s A kbar^alpha = (kbar - 1) delta kbar",
    ])
      expect(eq(solow, form, target).equivalent, form).toBe(false);
  });
  it("treat squaring as a change of solution set over the reals", () => {
    expect(eq(ols, "b_2^2 = (sum(x y)/sum(x^2))^2", "b_2 = sum(x y)/sum(x^2)").equivalent).toBe(false);
  });
  it("solve for the unknown that both sides share", () => {
    expect(eq(ols, "n b_1 = sum(y) - b_2 sum(x)", "b_1 = ybar - b_2 xbar").equivalent).toBe(true);
    expect(eq(ols, "b_2 = ybar/xbar", "b_1 = ybar - b_2 xbar").equivalent).toBe(false);
  });
});

describe("sums over data", () => {
  it("compare sums, means and indexed terms", () => {
    expect(eq(ols, "sum((x - xbar)^2)", "sum(x^2) - n xbar^2").equivalent).toBe(true);
    expect(eq(ols, "sum((x - xbar)(y - ybar))", "sum(x y) - sum(x) sum(y)/n").equivalent).toBe(true);
    expect(eq(ols, String.raw`\sum x_i \sum y_i`, "sum(x) sum(y)").equivalent).toBe(true);
    expect(eq(ols, "sum(x - xbar)", "0").equivalent).toBe(true);
    expect(eq(ols, "sum((x - xbar)^2)", "sum(x^2) - xbar^2").equivalent).toBe(false);
  });
  it("treat a denominator that is identically zero as a division by zero", () => {
    expect(eq(ols, "b_2 = sum(x y)/sum(x - xbar)", "b_2 = 1")).toMatchObject({ equivalent: false, problem: expect.stringMatching(/divides by something that is always 0/) });
  });
});

describe("matrices", () => {
  it("compare products, transposes, inverses and traces elementwise", () => {
    expect(eq(mx, "(X'X)^{-1} X'X", "I_K").equivalent).toBe(true);
    expect(eq(mx, "(P X)'", "X'P'").equivalent).toBe(true);
    expect(eq(mx, "P P", "P").equivalent).toBe(true);
    expect(eq(mx, "trace(P)", "K").equivalent).toBe(true);
    expect(eq(mx, "trace(M)", "n - K").equivalent).toBe(true);
    expect(eq(mx, "P X", "X'P").equivalent).toBe(false);
    expect(eq(mx, "trace(M)", "n").equivalent).toBe(false);
  });
  it("report mismatched shapes and singular inverses", () => {
    expect(eq(mx, "X M", "X")).toMatchObject({ equivalent: false, problem: expect.stringMatching(/can't multiply a \d+×\d+ matrix by a \d+×\d+ matrix/) });
    expect(eq(mx, "(X X')^{-1}", "I_n")).toMatchObject({ equivalent: false, problem: expect.stringMatching(/singular/) });
  });
  it("tell true identities apart by relaxing the innermost definition", () => {
    expect(eq(mx, "PX = X", "MX = 0")).toMatchObject({ equivalent: true, regime: "identity" });
    expect(eq(mx, "(I_n - X(X'X)^{-1}X')X = 0", "MX = 0")).toMatchObject({ equivalent: true, regime: "identity" });
    expect(eq(mx, "X'M = 0", "MX = 0")).toMatchObject({ equivalent: true, regime: "identity" });
    expect(eq(mx, "trace(M) = n - K", "MX = 0").equivalent).toBe(false);
    expect(eq(mx, "PP = P", "MX = 0").equivalent).toBe(false);
  });
  it("match false matrix statements by residual", () => {
    expect(eq(mx, "X - MX = 0", "MX = X")).toMatchObject({ equivalent: true, regime: "proportional" });
    expect(eq(mx, "PX = 0", "MX = X").equivalent).toBe(true);
    expect(eq(mx, "PX = 0", "M = 0").equivalent).toBe(false);
  });
});
