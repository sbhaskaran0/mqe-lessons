// @vitest-environment happy-dom
// The sampler panel (seeded Monte Carlo into a histogram), the scatter-fit SSR contour and data sums, labelled
// readouts and the trigonometric functions: determinism, the OLS statistics per replication, summaries, the checks
// that keep a redraw affordable, and rendering.
import "./setup";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WidgetEntry } from "../../src/ir";
import { checkExpr, checkView, checkWidget, compile, fitStats, FUNCTIONS, generate, type PanelsSpec, samplerRuns, withDerived } from "../../src/widgets/expr";
import { contourLevels } from "../../src/widgets/panels/PlanePanel";
import { mix, replicationRows, runSampler, SAMPLER_LIMITS, type SamplerSpec } from "../../src/widgets/sampler";
import { widgetParts, WidgetSpec } from "../../src/widgets/spec";
import { readoutText } from "../../src/widgets/ui/Readouts";
import { WidgetHost } from "../../src/widgets/WidgetHost";

const panels = (s: unknown) => WidgetSpec.parse({ type: "panels", ...(s as object) }) as PanelsSpec;
const entryOf = (spec: WidgetSpec, type: WidgetEntry["type"] = "panels"): WidgetEntry => ({ slug: "test-widget", name: "Test Widget", type, spec, illustrates: [], notation: [] });

/** The C1 population at a test-sized R: y = 80 + 10x + gamma z + e, z = x - 19 + N(0, 1) omitted. */
const C1 = {
  params: {
    N: { tex: "N", min: 10, max: 200, step: 10, default: 40 },
    sd: { tex: "\\sigma", min: 20, max: 150, step: 0.5, default: 89.5 },
    het: { tex: "h", min: 0, max: 1, step: 1, default: 0 },
    gamma: { tex: "g", min: 0, max: 4, step: 0.5, default: 0 },
    R: { tex: "R", min: 100, max: 2000, step: 100, default: 400 },
  },
  fixed: { beta1: 80, beta2: 10 },
  panels: [
    {
      kind: "sampler",
      id: "hist",
      seed: 430001,
      reps: "R",
      rows: "N",
      columns: { x: "uniform(4, 34)", z: "x - 19 + normal()", y: "beta1 + beta2*x + gamma*z + normal(0, sd*(het ? x/19 : 1))" },
      fit: { y: "y", x: "x" },
      stat: "b2",
      x: { min: 2, max: 22 },
      summaries: { b2_mean: "mean(b2)", b2_sd: "sd(b2)", se_mean: "mean(se_b2)", hc_mean: "mean(se_b2_hc1)" },
      lines: [{ id: "truth", x: "beta2" }, { id: "centre", x: "b2_mean" }],
      densities: [{ id: "textbook", mean: "beta2", sd: "se_mean", label: "textbook SE" }],
    },
  ],
  readouts: [{ id: "sd_out", label: "Spread", expr: "b2_sd", format: ".3f" }],
};
const c1 = () => panels(C1);
const samplerOf = (spec: PanelsSpec) => spec.panels[0] as SamplerSpec;
const scopeOf = (spec: PanelsSpec, p: Record<string, number> = {}) => withDerived(spec, { N: 40, sd: 89.5, het: 0, gamma: 0, R: 400, ...p });

describe("sampler: determinism", () => {
  it("the same params and seed give the same draws, statistics and summaries", () => {
    const spec = c1();
    const a = runSampler(samplerOf(spec), scopeOf(spec));
    const b = runSampler(samplerOf(spec), scopeOf(spec));
    expect(a.summaries).toEqual(b.summaries);
    expect(Array.from(a.stats.b2)).toEqual(Array.from(b.stats.b2));
    expect(a.bars).toEqual(b.bars);
  });

  it("'Draw again' (redraw > 0) gives fresh draws; a different seed does too", () => {
    const spec = c1();
    const p = samplerOf(spec);
    const first = runSampler(p, scopeOf(spec)).summaries.b2_mean;
    expect(runSampler(p, scopeOf(spec), 1).summaries.b2_mean).not.toBe(first);
    expect(runSampler({ ...p, seed: 7 }, scopeOf(spec)).summaries.b2_mean).not.toBe(first);
  });

  it("raising the number of rows extends each replication's sample: its first rows do not change", () => {
    const spec = c1();
    const short = replicationRows(samplerOf(spec), scopeOf(spec), 3, 10);
    const long = replicationRows(samplerOf(spec), scopeOf(spec), 3, 25);
    for (const k of ["x", "z", "y"]) expect(long[k]!.slice(0, 10)).toEqual(short[k]);
    // Replications draw from unrelated streams.
    expect(replicationRows(samplerOf(spec), scopeOf(spec), 4, 10).x).not.toEqual(short.x);
    expect(new Set(Array.from({ length: 1000 }, (_, r) => mix(430001, r))).size).toBe(1000);
  });
});

describe("sampler: statistics", () => {
  it("a noiseless line gives its slope and intercept exactly, zero standard errors and R² = 1", () => {
    const spec = panels({
      params: { n: { tex: "n", min: 5, max: 50, default: 12 } },
      panels: [{ kind: "sampler", id: "h", seed: 1, reps: 30, rows: "n", columns: { x: "uniform(0, 10)", y: "3 + 2*x" }, fit: { y: "y", x: "x" }, stat: "b2", x: { min: 0, max: 4 }, summaries: { b: "mean(b2)", a: "mean(b1)", se: "max(mean(se_b2), mean(se_b2_hc1))", fit: "mean(r2)" } }],
    });
    const s = runSampler(samplerOf(spec), withDerived(spec, { n: 12 })).summaries;
    expect(s.b).toBeCloseTo(2, 10);
    expect(s.a).toBeCloseTo(3, 9);
    expect(s.se).toBeLessThan(1e-6);
    expect(s.fit).toBeCloseTo(1, 10);
  });

  it("matches a direct computation of b2, its textbook and HC1 standard errors and t on one replication", () => {
    const spec = c1();
    const p = { ...samplerOf(spec), reps: 1 };
    const sc = scopeOf(spec, { het: 1 });
    const { x, y } = replicationRows(p, sc, 0, 40);
    const n = 40;
    const xb = x!.reduce((a, b) => a + b) / n;
    const yb = y!.reduce((a, b) => a + b) / n;
    const sxx = x!.reduce((a, v) => a + (v - xb) ** 2, 0);
    const b2 = x!.reduce((a, v, i) => a + (v - xb) * (y![i]! - yb), 0) / sxx;
    const e = y!.map((v, i) => v - (yb - b2 * xb) - b2 * x![i]!);
    const se = Math.sqrt(e.reduce((a, v) => a + v * v, 0) / (n - 2) / sxx);
    const hc1 = Math.sqrt((n / (n - 2)) * x!.reduce((a, v, i) => a + (v - xb) ** 2 * e[i]! ** 2, 0)) / sxx;
    const r = runSampler(p, sc);
    expect(r.reps).toBe(2); // at least two replications, so sd() is defined
    expect(r.stats.b2[0]).toBeCloseTo(b2, 10);
    expect(r.stats.se_b2[0]).toBeCloseTo(se, 10);
    expect(r.stats.se_b2_hc1[0]).toBeCloseTo(hc1, 10);
    expect(r.stats.t_b2[0]).toBeCloseTo(b2 / se, 8);
  });

  it("summaries reduce with mean, sd, quantile and share; the histogram is a density", () => {
    const spec = panels({
      params: { k: { tex: "k", min: 0, max: 1, default: 0 } },
      panels: [{ kind: "sampler", id: "h", seed: 5, reps: 2000, rows: 30, columns: { x: "uniform(0, 1)", y: "x + normal(0, 0.5)" }, fit: { y: "y", x: "x" }, stat: "t_b2", bins: 50, x: { min: -4, max: 10 },
        summaries: { med: "quantile(b2, 0.5)", q: "quantile(b2, 0.975)", rej: "share(abs(t_b2) > 2)", m: "mean(b2)", ratio: "sd(b2)/mean(se_b2)" } }],
    });
    const r = runSampler(samplerOf(spec), withDerived(spec, { k: 0 }));
    expect(r.summaries.med).toBeCloseTo(r.summaries.m!, 1);
    expect(r.summaries.q).toBeGreaterThan(r.summaries.med!);
    expect(r.summaries.rej).toBeGreaterThan(0.7); // power against b2 = 0: slope 1, sd(b2) about 0.32, so t is about 3
    expect(r.summaries.rej).toBeLessThan(0.97);
    expect(r.summaries.ratio).toBeCloseTo(1, 1);
    const area = r.bars.reduce((a, b) => a + b.height * (b.x1 - b.x0), 0);
    expect(area + r.outside / r.reps).toBeCloseTo(1, 10);
  });

  it("reproduces the C1 brief's Monte Carlo numbers within four Monte Carlo standard errors", () => {
    const spec = panels({ ...C1, params: { ...C1.params, R: { ...C1.params.R, default: 2000 } } });
    const at = (p: Record<string, number>) => samplerRuns(spec, withDerived(spec, { N: 40, sd: 89.5, het: 0, gamma: 0, R: 2000, ...p })).summaries;
    const homo = at({});
    expect(Math.abs(homo.b2_mean! - 10)).toBeLessThan(0.15);
    expect(Math.abs(homo.b2_sd! - 1.68)).toBeLessThan(0.11);
    expect(Math.abs(homo.se_mean! - 1.66)).toBeLessThan(0.03);
    const het = at({ het: 1 });
    expect(Math.abs(het.b2_sd! - 1.95)).toBeLessThan(0.12);
    expect(het.se_mean).toBeLessThan(het.b2_sd!); // the textbook SE understates the spread
    expect(Math.abs(het.hc_mean! - 1.87)).toBeLessThan(0.04);
    expect(Math.abs(at({ gamma: 2 }).b2_mean! - 12)).toBeLessThan(0.15);
    expect(at({ N: 160 }).b2_sd).toBeLessThanOrEqual(0.84); // the goal, by raising N alone
  });

  it("a redraw at the largest size the limits allow stays fast enough to follow a slider", () => {
    const spec = panels({ ...C1, params: { ...C1.params, R: { ...C1.params.R, default: 2000 } } });
    const p = samplerOf(spec);
    const sc = withDerived(spec, { N: 200, sd: 89.5, het: 1, gamma: 2, R: 2000 });
    runSampler(p, sc); // compile and warm up
    const t = performance.now();
    const r = runSampler(p, sc, 1);
    const ms = performance.now() - t;
    expect(r.reps * r.rows).toBe(SAMPLER_LIMITS.cells);
    // ~120 ms on the development laptop; the strict budget applies only under MQE_PERF=1 (CI and loaded machines vary).
    expect(ms).toBeLessThan(process.env.MQE_PERF ? 150 : 1500);
  });
});

describe("sampler: checks", () => {
  it("the C1 view is sound, and its summaries are scalars (goals, tests) while lines and densities are elements", () => {
    const spec = c1();
    expect(checkWidget(spec)).toEqual({ errors: [], notes: [] });
    const parts = widgetParts(spec);
    expect(parts.scalars).toEqual(expect.arrayContaining(["b2_mean", "b2_sd", "se_mean", "hc_mean", "sd_out"]));
    expect(parts.elements).toEqual(expect.arrayContaining(["hist", "truth", "centre", "textbook"]));
    expect(checkView(spec, { state: { het: 1 }, goal: { when: "het == 0 and b2_sd <= 0.84" } })).toEqual([]);
    expect(checkView(spec, { goal: { when: "b2_sd < 5" } })).toEqual([
      "goal.when already holds at the view's starting values, so the learner's first nudge would meet it; start the view (state) where it does not",
    ]);
  });

  it("reports names out of scope, a fit that names no column, a statistic outside a reduction and nesting", () => {
    const bad = (patch: object) => checkWidget(panels({ ...C1, panels: [{ ...C1.panels[0], ...patch }] })).errors;
    const sums = (extra: object) => ({ summaries: { ...C1.panels[0]!.summaries, ...extra } });
    expect(bad({ columns: { x: "uniform(4, 34) + y", y: "x" } })).toEqual(["panels[0].columns.x: unknown name 'y'"]);
    expect(bad({ fit: { y: "y", x: "w" } })).toEqual(["panels[0].fit.x 'w' is not one of the columns (x, z, y)"]);
    expect(bad(sums({ m: "normal()" }))).toEqual(["panels[0].summaries.m: function normal() is not allowed here"]);
    expect(bad({ columns: { x: "mean(1)", y: "x" } })).toEqual(["panels[0].columns.x: function mean() is not allowed here"]);
    expect(bad(sums({ m: "b2 + 1" }))[0]).toMatch(/^panels\[0\]: 'b2' differs across replications/);
    expect(bad(sums({ m: "mean(sd(b2))" }))[0]).toMatch(/sd\(\) cannot sit inside another/);
    expect(bad({ columns: { b2: "uniform()", y: "b2" }, fit: { y: "y", x: "b2" } })).toContain("panels[0].columns.b2: the name is already a parameter, derived value or statistic");
    expect(bad({ lines: [{ id: "l", x: "nope" }] })).toEqual(["panels[0].lines.l.x: unknown name 'nope'"]);
  });

  it("refuses sizes a redraw cannot afford at the sliders' maxima", () => {
    const spec = panels({ ...C1, params: { ...C1.params, N: { ...C1.params.N, max: 1000 } } });
    expect(checkWidget(spec).errors).toEqual([
      "panels[0]: at every slider's maximum it asks for 2000 replications of 1000 rows, more than a redraw can afford (at most 5000 replications, 2000 rows, 400,000 rows in all); lower the sliders' ranges",
    ]);
  });

  it("a summary that shares a name with a parameter or readout is an error", () => {
    const spec = panels({ ...C1, readouts: [{ id: "b2_sd", expr: "1" }] });
    expect(checkWidget(spec).errors).toContain("summary 'b2_sd' is defined twice, or shares its name with a parameter, derived value or readout");
  });
});

describe("sampler: rendering", () => {
  it("draws the histogram, the lines and densities, the readouts and a note, and redraws on 'Draw again'", async () => {
    const r = render(<WidgetHost entry={entryOf(c1())} view={null} datasets={{}} contentBase="" />);
    await waitFor(() => expect(r.container.querySelector('[data-panel="hist"] [data-el="hist"] rect')).not.toBeNull());
    expect(r.container.querySelector('[data-el="truth"]')).not.toBeNull();
    expect(r.container.querySelector('[data-el="centre"]')).not.toBeNull();
    expect(r.container.querySelector('[data-el="textbook"] path')).not.toBeNull();
    expect(r.container.querySelector("[data-sampler-note]")!.textContent).toMatch(/^400 samples of N = 40/);
    const before = r.container.querySelector('[data-readout="sd_out"] output')!.textContent;
    expect(Number(before)).toBeCloseTo(1.68, 0);
    fireEvent.click(r.getByRole("button", { name: "Draw again" }));
    await waitFor(() => expect(r.container.querySelector('[data-readout="sd_out"] output')!.textContent).not.toBe(before));
  });

  it("a prediction that hides the only panel keeps its frame but none of its marks until the learner commits", async () => {
    const view = { t: "interactive" as const, widget: "test-widget", predict: { hide: ["hist"], ask: "Where?", options: ["10", "12"], answer: 0 } };
    const r = render(<WidgetHost entry={entryOf(c1())} view={view} datasets={{}} contentBase="" />);
    await waitFor(() => expect(r.container.querySelector("[data-sampler-note]")!.textContent).toMatch(/^400 samples/));
    expect(r.container.querySelector('[data-panel="hist"] svg')).not.toBeNull();
    for (const id of ["hist", "truth", "centre", "textbook"]) expect(r.container.querySelector(`[data-el="${id}"]`)).toBeNull();
    fireEvent.click(r.getByRole("radio", { name: "10" }));
    fireEvent.click(r.getByRole("button", { name: "Commit prediction" }));
    await waitFor(() => expect(r.container.querySelector('[data-panel="hist"] [data-el="hist"] rect')).not.toBeNull());
    expect(r.container.querySelector('[data-el="textbook"] path')).not.toBeNull();
  });

  it("a typed prediction asks for a number, not a marker, and is graded against the sampler's summary", async () => {
    const spec = c1();
    const sd = samplerRuns(spec, scopeOf(spec), 0).summaries.b2_sd!;
    const view = { t: "interactive" as const, widget: "test-widget", predict: { hide: ["sd_out"], ask: "How wide?", readout: "sd_out", tol: 0.01 } };
    const r = render(<WidgetHost entry={entryOf(spec)} view={view} datasets={{}} contentBase="" />);
    await waitFor(() => expect(r.container.querySelector("[data-sampler-note]")!.textContent).toMatch(/^400 samples/));
    expect(r.container.textContent).toContain("Work it out, then type your answer.");
    expect(r.container.textContent).not.toMatch(/Drag the marker/);
    fireEvent.change(r.getByRole("spinbutton"), { target: { value: String(sd) } });
    fireEvent.click(r.getByRole("button", { name: "Commit prediction" }));
    await waitFor(() => expect(r.container.querySelector(".w-predict-result")!.textContent).toMatch(/^Right\. .*model: /));
  });
});

describe("scatter-fit: data sums and the SSR contour", () => {
  const FIT = {
    type: "scatter-fit",
    generate: { n: 40, seed: 495686, x: "uniform(4, 34)", y: "80 + 10*x + normal(0, 89.5)" },
    x: { min: 0, max: 36 },
    y: { min: 0, max: 600 },
    params: { b1: { tex: "b_1", min: -200, max: 400, step: 1, default: 250 }, b2: { tex: "b_2", min: -5, max: 25, step: 0.05, default: 2 } },
    line: { intercept: "b1", slope: "b2" },
    panels: [
      {
        kind: "contour", id: "bowl", x: { sweep: "b1", min: -100, max: 300 }, y: { sweep: "b2", min: 0, max: 20 },
        f: "sum_yy - 2*b1*sum_y - 2*b2*sum_xy + n*b1^2 + 2*b1*b2*sum_x + b2^2*sum_xx", levels: ["1.1*ssr_min", "2*ssr_min"], grid: 40,
        points: [{ id: "here", x: "b1", y: "b2", drag: { x: "b1", y: "b2" } }],
      },
    ],
    readouts: [
      { id: "resid_sum", expr: "sum_y - n*b1 - b2*sum_x" },
      { id: "xresid_sum", expr: "sum_xy - b1*sum_x - b2*sum_xx" },
    ],
  };
  const fit = () => WidgetSpec.parse(FIT) as Extract<WidgetSpec, { type: "scatter-fit" }>;

  it("the contour's f, written in the data sums, is SSR at every line; both FOC sums vanish at OLS only", () => {
    const spec = fit();
    expect(checkWidget(spec)).toEqual({ errors: [], notes: [] });
    const pts = generate(spec, { b1: 250, b2: 2 });
    const f = compile(spec.panels![0]!.f);
    for (const [a, b] of [[250, 2], [80, 10], [-50, 17]] as const) {
      const s = fitStats(pts, a, b);
      expect(f({ ...s, b1: a, b2: b })).toBeCloseTo(s.ssr, 4);
    }
    const s = fitStats(pts, 0, 0);
    const ols = fitStats(pts, s.intercept_ols, s.slope_ols);
    const sums = (a: number, b: number) => [ols.sum_y - ols.n * a - b * ols.sum_x, ols.sum_xy - a * ols.sum_x - b * ols.sum_xx];
    sums(s.intercept_ols, s.slope_ols).forEach((v) => expect(v).toBeCloseTo(0, 6));
    expect(Math.abs(sums(48, 12)[0]!)).toBeLessThan(5); // the first condition alone holds on a whole line of (b1, b2)
    expect(Math.abs(sums(48, 12)[1]!)).toBeGreaterThan(5000);
  });

  it("level sets close around the OLS point, and f may not read what moves with the line", () => {
    const spec = fit();
    const pts = generate(spec, { b1: 250, b2: 2 });
    const scope = { ...withDerived(spec, { b1: 250, b2: 2 }), ...fitStats(pts, 250, 2) };
    const levels = contourLevels(spec, spec.panels![0]!, scope, { b1: 250, b2: 2 }, [-100, 300], [0, 20]);
    expect(levels.map((l) => l.segments.length > 0)).toEqual([true, true]);
    const bad = WidgetSpec.parse({ ...FIT, panels: [{ ...FIT.panels[0], f: "ssr + r2" }] });
    expect(checkWidget(bad).errors).toEqual(["panels[0].f: unknown name 'ssr'", "panels[0].f: unknown name 'r2'"]);
    const varAxis = WidgetSpec.parse({ ...FIT, panels: [{ ...FIT.panels[0], x: { var: "k", min: 0, max: 1 } }] });
    expect(checkWidget(varAxis).errors[0]).toMatch(/a scatter-fit has no model variables/);
  });

  it("panel and mark ids are elements; the bowl renders below the scatter only when shown", async () => {
    const spec = fit();
    expect(widgetParts(spec).elements).toEqual(expect.arrayContaining(["bowl", "here", "points", "line"]));
    const shown = render(<WidgetHost entry={entryOf(spec, "scatter-fit")} view={{ t: "interactive", widget: "test-widget", show: ["points", "line", "bowl", "here"] }} datasets={{}} contentBase="" />);
    await waitFor(() => expect(shown.container.querySelector('[data-panel="bowl"] [data-level]')).not.toBeNull());
    expect(shown.container.querySelector('[data-panel="bowl"] [data-handle="here"]')).not.toBeNull();
    const hidden = render(<WidgetHost entry={entryOf(spec, "scatter-fit")} view={{ t: "interactive", widget: "test-widget", show: ["points", "line"] }} datasets={{}} contentBase="" />);
    await waitFor(() => expect(hidden.container.querySelector('[data-el="points"]')).not.toBeNull());
    expect(hidden.container.querySelector('[data-panel="bowl"]')).toBeNull();
  });
});

describe("labelled readouts and trigonometric functions", () => {
  it("a readout shows the text its labels give the value, else the number", () => {
    const labels = { "2": "positive definite", "0": "indefinite", "-1": "negative semidefinite" };
    expect(readoutText({ value: 2, format: ".0f", labels })).toBe("positive definite");
    expect(readoutText({ value: -1, labels })).toBe("negative semidefinite");
    expect(readoutText({ value: 1, format: ".0f", labels })).toBe("1");
    expect(readoutText({ value: NaN, format: ".0f", labels })).toBe(readoutText({ value: NaN, format: ".0f" }));
    expect(WidgetSpec.safeParse({ ...C1, type: "panels", readouts: [{ id: "c", expr: "1", labels }] }).success).toBe(true);
  });

  it("sin, cos and atan2 are allowed, in radians, with atan2(y, x) the angle of (x, y)", () => {
    expect(FUNCTIONS.base).toEqual(expect.arrayContaining(["sin", "cos", "atan2"]));
    expect(checkExpr("atan2(1)", []).errors).toEqual(["atan2() takes 2 arguments, not 1"]);
    expect(compile("atan2(1, 0)")({})).toBeCloseTo(Math.PI / 2, 12);
    expect(compile("sin(pi/6) + cos(0)")({})).toBeCloseTo(1.5, 12);
    const spec = panels({ params: { a: { tex: "a", min: 0, max: 1, default: 0.5 } }, panels: [{ kind: "sampler", id: "h", seed: 1, reps: 10, rows: 5, columns: { x: "uniform()", y: "sin(x) + atan2(x, 1)" }, fit: { y: "y", x: "x" }, stat: "b2", x: { min: 0, max: 3 } }] });
    expect(checkWidget(spec)).toEqual({ errors: [], notes: [] });
  });
});
