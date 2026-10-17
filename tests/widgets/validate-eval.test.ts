// What `npm run validate` finds only by evaluating a spec: argument counts mathjs would reject on screen, values that
// fail where a widget or a view starts, goals that already hold where their view starts, and time-series test keys.
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateContent } from "../../src/validate";
import { checkExpr, checkView, checkWidget, compile, derivedOrder, generate, withDerived } from "../../src/widgets/expr";
import { WidgetSpec } from "../../src/widgets/spec";
import { exportFixture, scratchDir } from "../helpers";

const spec = (s: unknown) => WidgetSpec.parse(s);
const names = ["s", "A"];

const curvePanel = (curves: unknown[]) => [{ kind: "curve", id: "diagram", x: { var: "k", min: 0, max: 10 }, y: { min: 0, max: 5 }, curves }];
const PLOT = {
  type: "panels",
  vars: { k: {} },
  params: { s: { tex: "s", min: 0.1, max: 0.9, default: 0.5 }, A: { tex: "A", min: 0.5, max: 2, default: 1 } },
  panels: curvePanel([{ id: "y", expr: "A*sqrt(k)" }]),
};

describe("argument counts", () => {
  it("are checked statically, so the error names the expression instead of breaking the widget on screen", () => {
    expect(checkExpr("sqrt(s, A)", names).errors).toEqual(["sqrt() takes 1 argument, not 2"]);
    expect(checkExpr("exp(s, A)", names).errors).toEqual(["exp() takes 1 argument, not 2"]);
    expect(checkExpr("max()", names).errors).toEqual(["max() takes at least 1 argument, not 0"]);
    expect(checkExpr("log(s, A, 2)", names).errors).toEqual(["log() takes 1 to 2 arguments, not 3"]);
    // normcdf() would quietly be NaN rather than throw.
    expect(checkExpr("normcdf()", names).errors).toEqual(["normcdf() takes 1 to 3 arguments, not 0"]);
    expect(checkExpr("normal(0, 1, 2)", names, ["normal"]).errors).toEqual(["normal() takes 0 to 2 arguments, not 3"]);
    for (const ok of ["min(s)", "max(s, A, 1)", "log(s)", "log(8, 2)", "normcdf(s, 0, 1)"]) expect(checkExpr(ok, names).errors, ok).toEqual([]);
  });

  it("in any part of a spec, as an error rather than a test 'not run'", () => {
    const r = checkWidget(spec({ ...PLOT, derived: { kb: "sqrt(s, 2)" }, tests: [{ expect: { kb: 1 } }] }));
    expect(r).toEqual({ errors: ["derived.kb: sqrt() takes 1 argument, not 2"], notes: [] });
  });
});

describe("every expression is evaluated where the widget starts", () => {
  it("reports a value mathjs rejects at the defaults, naming the expression", () => {
    // sqrt(s - 0.7) is complex at s = 0.5, and max() has no order for complex numbers.
    const r = checkWidget(spec({ ...PLOT, derived: { g: "max(1, sqrt(s - 0.7))" } }));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^derived\.g: Cannot calculate max/);
    const curve = checkWidget(spec({ ...PLOT, panels: curvePanel([{ id: "c", expr: "max(k, sqrt(s - 0.7))" }]) }));
    expect(curve.errors[0]).toMatch(/^panels\[0\]\.curves\.c: Cannot calculate max/);
    const readout = checkWidget(spec({ ...PLOT, readouts: [{ id: "r", expr: "max(1, sqrt(s - 0.7))" }] }));
    expect(readout.errors[0]).toMatch(/^readouts\.r: Cannot calculate max/);
  });

  it("at runtime such a derived value is NaN (a gap), not an exception that takes the widget down", () => {
    const s = spec({ ...PLOT, derived: { g: "max(1, sqrt(s - 0.7))" } });
    expect(withDerived(s, { s: 0.5, A: 1 }).g).toBeNaN();
    expect(withDerived(s, { s: 0.8, A: 1 }).g).toBe(1);
  });

  it("covers time series (through growth()) and scatter-fit generate", () => {
    const dyn = spec({
      type: "panels",
      params: { s: { tex: "s", min: 0.1, max: 0.9, default: 0.5 } },
      recurrence: { var: "k", init: 1, periods: 5, next: "s*k" },
      panels: [{ kind: "path", id: "levels", series: [{ id: "g", expr: "growth(max(k, sqrt(s - 0.7)))" }] }],
    });
    expect(checkWidget(dyn).errors[0]).toMatch(/^panels\[0\]\.series\.g: Cannot calculate max/);
    const fit = spec({
      type: "scatter-fit",
      params: { a: { tex: "a", min: -1, max: 1, default: 0 }, b: { tex: "b", min: -1, max: 1, default: 0 }, s: { tex: "s", min: 0.1, max: 0.9, default: 0.5 } },
      generate: { n: 5, seed: 1, x: "uniform(0, 1)", y: "max(x, sqrt(s - 0.7))" },
      x: {},
      y: {},
      line: { intercept: "a", slope: "b" },
    });
    expect(checkWidget(fit).errors[0]).toMatch(/^generate\.y: Cannot calculate max/);
  });

  it("the player skips `tests` (validate has run them), but still checks the expressions", () => {
    const bad = spec({ ...PLOT, derived: { kb: "s*2" }, tests: [{ expect: { kb: 5 } }] });
    expect(checkWidget(bad).errors).toEqual(["tests[0]: kb = 1, expected 5 ± 0.000001"]);
    expect(checkWidget(bad, undefined, { tests: false }).errors).toEqual([]);
  });
});

describe("checkView: a view's starting values", () => {
  const golden = spec({ ...PLOT, derived: { gap: "abs(s - 0.5)" } });

  it("a goal that already holds where the view starts is an error: the first nudge would meet it", () => {
    expect(checkView(golden, { goal: { when: "gap < 0.01" } })).toEqual([
      "goal.when already holds at the view's starting values, so the learner's first nudge would meet it; start the view (state) where it does not",
    ]);
    expect(checkView(golden, { state: { s: 0.3 }, goal: { when: "gap < 0.01" } })).toEqual([]);
    expect(checkView(golden, { state: { s: 0.5 }, goal: { when: "gap < 0.01" } })).toHaveLength(1);
  });

  it("a goal that fails to evaluate there is an error", () => {
    expect(checkView(golden, { goal: { when: "max(1, sqrt(gap - 1)) > 2" } })[0]).toMatch(/^goal\.when: Cannot calculate max/);
  });

  it("an expression that fails only at the view's presets is reported once, as such", () => {
    const s = spec({ ...PLOT, derived: { g: "max(1, sqrt(0.7 - s))" } });
    expect(checkWidget(s).errors).toEqual([]);
    const errs = checkView(s, { state: { s: 0.8 } });
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/^at the view's starting values, derived\.g: Cannot calculate max/);
  });

  it("goals can read the built-in scalars there (scatter-fit's fit)", () => {
    const fit = spec({
      type: "scatter-fit",
      params: { a: { tex: "a", min: -5, max: 5, default: 0 }, b: { tex: "b", min: -5, max: 5, default: 0 } },
      generate: { n: 20, seed: 3, x: "uniform(0, 10)", y: "1 + 2*x + normal(0, 1)" },
      x: {},
      y: {},
      line: { intercept: "a", slope: "b" },
    });
    expect(checkView(fit, { goal: { when: "ssr <= 1.01*ssr_min" } })).toEqual([]);
    expect(checkView(fit, { state: { a: 1, b: 2 }, goal: { when: "ssr <= 1.5*ssr_min" } })).toHaveLength(1);
  });

  it("a dataset this run has not loaded leaves the goal unchecked rather than wrong", () => {
    const dist = spec({ type: "distribution", dataset: "pay", column: "wage", measures: ["gini"] });
    expect(checkView(dist, { goal: { when: "gini > 0.9" } })).toEqual([]);
  });
});

describe("time-series test keys id@t", () => {
  const dyn = (t0: number, expect: Record<string, number>) =>
    spec({
      type: "panels",
      params: { g: { tex: "g", min: 1, max: 3, default: 2 } },
      recurrence: { var: "k", init: 1, t0, periods: 4, next: "g*k" },
      panels: [{ kind: "path", id: "levels", series: [{ id: "k", expr: "k" }] }],
      tests: [{ expect }],
    });

  it("count from recurrence.t0, which may be negative, and accept a whole period written as a decimal (as Python does)", () => {
    expect(checkWidget(dyn(-2, { "k@-2": 1, "k@-1": 2, "k@2": 16 })).errors).toEqual([]);
    expect(checkWidget(dyn(0, { "k@3.0": 8 })).errors).toEqual([]);
  });

  it("say what is wrong with a key that can't be read", () => {
    expect(checkWidget(dyn(0, { "k@1.5": 2 })).errors).toEqual(["tests[0]: 'k@1.5' must name a series and a whole period, as id@t, or a curve and an x value, as id@x"]);
    expect(checkWidget(dyn(0, { "q@1": 2 })).errors).toEqual(["tests[0]: 'q@1': there is no series 'q'"]);
    expect(checkWidget(dyn(1, { "k@0": 1 })).errors).toEqual(["tests[0]: 'k@0': period 0 is outside 1..5"]);
  });
});

describe("the evaluator", () => {
  it("works the derived order out once per spec", () => {
    const derived = { b: "a + 1", a: "s" };
    expect(derivedOrder(derived)).toBe(derivedOrder(derived));
    expect(derivedOrder(derived).order).toEqual(["a", "b"]);
  });

  it("draws random numbers only inside generate", () => {
    expect(() => compile("normal(0, 1)")({})).toThrow(/only work in generate/);
    const fit = spec({
      type: "scatter-fit",
      generate: { n: 3, seed: 7, x: "uniform(0, 10)", y: "normal(x, 1)" },
      x: {},
      y: {},
      line: { intercept: "a", slope: "b" },
      params: { a: { tex: "a", min: -1, max: 1, default: 0 }, b: { tex: "b", min: -1, max: 1, default: 0 } },
    }) as Extract<WidgetSpec, { type: "scatter-fit" }>;
    const first = generate(fit, {});
    expect(generate(fit, {})).toEqual(first);
    expect(() => compile("uniform()")({})).toThrow(/only work in generate/);
  });
});

describe("npm run validate checks each view where it starts", () => {
  it("rejects a lecture goal that holds at its view's presets", () => {
    const dir = scratchDir("mqe-validate-view");
    cpSync(exportFixture(), dir, { recursive: true });
    expect(validateContent(dir).errors).toEqual([]);
    const file = path.join(dir, "notes", "toy-101-l1-growth.json");
    const note = JSON.parse(readFileSync(file, "utf8"));
    const blocks = note.sections.flatMap((s: { steps: { blocks: { t: string; goal?: unknown; state?: Record<string, number> }[] }[] }) => s.steps.flatMap((st) => st.blocks));
    const goal = blocks.find((b: { t: string; goal?: unknown }) => b.t === "interactive" && b.goal);
    goal.state = { ...goal.state, s: 0.5 };
    writeFileSync(file, JSON.stringify(note));
    expect(validateContent(dir).errors).toEqual([
      "notes/toy-101-l1-growth.json#2-the-steady-state-3: goal.when already holds at the view's starting values, so the learner's first nudge would meet it; start the view (state) where it does not",
    ]);
  });
});
