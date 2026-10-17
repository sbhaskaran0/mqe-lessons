// The widget expression engine: allow-list, scopes, derived order, simulation and seeded data.
import { describe, expect, it } from "vitest";
import { checkExpr, checkWidget, derivedOrder, fitStats, generate, simulate, withDerived } from "../src/widgets/expr";
import { WidgetSpec } from "../src/widgets/spec";

describe("checkExpr", () => {
  const names = ["s", "A", "alpha", "k"];
  it("accepts arithmetic, allowed functions, comparisons and constants", () => {
    for (const e of ["s*A*k^alpha", "log(k) + exp(-alpha) * sqrt(abs(s))", "max(s, 0.1) - min(A, 2)", "abs(s - alpha) < 0.01 and s > 0", "pi * e", "s > 0.5 ? k : 0", 3]) {
      expect(checkExpr(e, names).errors, String(e)).toEqual([]);
    }
  });
  it("reports unknown names and functions", () => {
    expect(checkExpr("s * n", names).errors).toEqual(["unknown name 'n'"]);
    expect(checkExpr("tan(k)", names).errors).toEqual(["function tan() is not allowed here"]);
    expect(checkExpr("growth(k)", names).errors).toEqual(["function growth() is not allowed here"]);
  });
  it("rejects assignment, definitions, property access, strings and bad syntax", () => {
    expect(checkExpr("s = 2", names).errors.join()).toMatch(/assignment syntax is not allowed/);
    expect(checkExpr("f(x) = x", names).errors.join()).toMatch(/not allowed/);
    expect(checkExpr("s.length", names).errors.join()).toMatch(/not allowed/);
    expect(checkExpr('"text"', names).errors.join()).toMatch(/only numbers/);
    expect(checkExpr("s *", names).errors.join()).toMatch(/does not parse/);
  });
  it("collects the names an expression reads", () => {
    expect([...checkExpr("(s*A/delta)^(1/(1-alpha))", [...names, "delta"]).symbols].sort()).toEqual(["A", "alpha", "delta", "s"]);
  });
});

describe("derived values", () => {
  it("evaluates in dependency order and finds cycles", () => {
    expect(derivedOrder({ c: "b + 1", b: "a * 2", a: "1" }).order).toEqual(["a", "b", "c"]);
    expect(derivedOrder({ a: "b", b: "a", c: "1" }).cycle.sort()).toEqual(["a", "b"]);
    expect(derivedOrder({ a: "a + 1" }).cycle).toEqual(["a"]);
  });

  // the handoff's own example: alpha = 1/3, s = 0.2, n + delta = 0.05, A = 1 gives k* = 8, y* = 2
  const solow = WidgetSpec.parse({
    type: "panels",
    vars: { k: {} },
    params: {
      s: { tex: "s", min: 0.05, max: 0.6, default: 0.2 },
      A: { tex: "A", min: 0.5, max: 2, default: 1 },
      alpha: { tex: "\\alpha", min: 0.2, max: 0.6, default: 0.333333 },
      n: { tex: "n", min: 0, max: 0.05, default: 0.01 },
      delta: { tex: "\\delta", min: 0.01, max: 0.15, default: 0.04 },
    },
    derived: { kstar: "(s*A/(n+delta))^(1/(1-alpha))", ystar: "A*kstar^alpha", cstar: "(1-s)*ystar" },
    panels: [{ kind: "curve", id: "diagram", x: { var: "k", min: 0, max: 20 }, y: { min: 0, max: 3 }, curves: [{ id: "saving", expr: "s*A*k^alpha" }] }],
    tests: [{ params: { s: 0.2, A: 1, alpha: 0.333333, n: 0.01, delta: 0.04 }, expect: { kstar: 8.0, ystar: 2.0 }, tol: 0.01 }],
  });
  it("matches the handoff's worked numbers", () => {
    const v = withDerived(solow, { s: 0.2, A: 1, alpha: 1 / 3, n: 0.01, delta: 0.04 });
    expect(v.kstar).toBeCloseTo(8, 10);
    expect(v.ystar).toBeCloseTo(2, 10);
    expect(v.cstar).toBeCloseTo(1.6, 10);
    expect(checkWidget(solow)).toEqual({ errors: [], notes: [] });
  });
  it("reports a test whose numbers do not hold", () => {
    const bad = { ...solow, tests: [{ expect: { kstar: 9 }, tol: 0.01 }] };
    // alpha's default is 0.333333, not exactly 1/3, so k* comes out a hair under 8
    expect(checkWidget(bad).errors[0]).toMatch(/^tests\[0\]: kstar = 7\.9999\d*, expected 9 ± 0\.01$/);
  });
});

describe("recurrence", () => {
  const spec = WidgetSpec.parse({
    type: "panels",
    params: {
      s: { tex: "s", min: 0.05, max: 0.9, default: 0.5 },
      alpha: { tex: "\\alpha", min: 0.2, max: 0.8, default: 0.5 },
      delta: { tex: "\\delta", min: 0.02, max: 0.2, default: 0.1 },
    },
    derived: { kbar: "(s/delta)^(1/(1-alpha))" },
    recurrence: { var: "k", init: "4*kbar", periods: 50, next: "s*k^alpha + (1-delta)*k", shocks: [{ t: 20, set: { s: 0.6 } }] },
    panels: [
      {
        kind: "path",
        id: "levels",
        series: [
          { id: "k", expr: "k" },
          { id: "gy", expr: "growth(k^alpha)" },
        ],
      },
    ],
  }) as Extract<WidgetSpec, { type: "panels" }>;
  const rec = spec.recurrence!;
  const noShocks = { ...spec, recurrence: { ...rec, shocks: [] } };

  it("iterates the law of motion from the notes' example (100 -> 95 -> 90.37 -> 86.09)", () => {
    const sim = simulate(noShocks, { s: 0.5, alpha: 0.5, delta: 0.1 });
    expect(sim.series.k!.slice(0, 4).map((x) => Number(x.toFixed(2)))).toEqual([100, 95, 90.37, 86.09]);
    expect(sim.series.k![50]).toBeCloseTo(28.93, 2);   // "still at about 29 after 50 periods"
    expect(sim.t).toHaveLength(51);
    expect(Number.isNaN(sim.series.gy![0])).toBe(true);
    expect(sim.series.gy![1]).toBeCloseTo(Math.sqrt(95) / 10 - 1, 12);
  });

  it("numbers periods from recurrence.t0, as the notes do (k_1 = 100, k_51 ≈ 28.93)", () => {
    const from1 = { ...spec, recurrence: { ...rec, shocks: [], t0: 1 } };
    const sim = simulate(from1, { s: 0.5, alpha: 0.5, delta: 0.1 });
    expect(sim.t[0]).toBe(1);
    expect(sim.t.at(-1)).toBe(51);
    expect(sim.series.k![50]).toBeCloseTo(28.93, 2);
    const test = { ...from1, tests: [{ expect: { "k@1": 100, "k@2": 95, "k@51": 28.9286 }, tol: 0.001 }] };
    expect(checkWidget(test).errors).toEqual([]);
    expect(checkWidget({ ...from1, recurrence: { ...from1.recurrence, shocks: [{ t: 0, set: { s: 0.6 } }] } }).errors[0]).toMatch(/outside periods 1\.\.51/);
  });

  it("applies shocks from their period on", () => {
    const base = simulate(noShocks, { s: 0.5, alpha: 0.5, delta: 0.1 });
    const shocked = simulate(spec, { s: 0.5, alpha: 0.5, delta: 0.1 });
    expect(shocked.series.k!.slice(0, 21)).toEqual(base.series.k!.slice(0, 21));
    expect(shocked.series.k![21]).toBeGreaterThan(base.series.k![21]!);
  });
});

describe("scatter-fit data", () => {
  const spec = WidgetSpec.parse({
    type: "scatter-fit",
    generate: { n: 40, seed: 7, x: "uniform(0, 10)", y: "2 + 0.5*x + normal(0, 1)" },
    x: {},
    y: {},
    params: { b1: { tex: "b_1", min: -5, max: 5, default: 0 }, b2: { tex: "b_2", min: -2, max: 2, default: 0 } },
    line: { intercept: "b1", slope: "b2" },
  }) as Extract<WidgetSpec, { type: "scatter-fit" }>;

  it("is reproducible from the seed", () => {
    expect(generate(spec, { b1: 0, b2: 0 })).toEqual(generate(spec, { b1: 0, b2: 0 }));
    expect(generate({ ...spec, generate: { ...spec.generate!, seed: 8 } }, {})).not.toEqual(generate(spec, {}));
  });

  it("computes OLS, SSR and R² for any line", () => {
    const pts = [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }];
    const exact = fitStats(pts, 1, 2);
    expect(exact).toMatchObject({ slope_ols: 2, intercept_ols: 1, ssr: 0, ssr_min: 0, r2: 1 });
    expect(fitStats(pts, 0, 0).ssr).toBe(1 + 9 + 25);
    const data = generate(spec, {});
    const fit = fitStats(data, 0, 0);
    expect(fit.slope_ols).toBeGreaterThan(0.3);
    expect(fit.slope_ols).toBeLessThan(0.7);
    expect(fitStats(data, fit.intercept_ols, fit.slope_ols).ssr).toBeCloseTo(fit.ssr_min, 10);
  });
});
