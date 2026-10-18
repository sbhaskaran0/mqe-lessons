// Precomputed data-charts (docs/PLAN.md, "Interface note: data-chart lookups"): rows matched to the sliders' positions
// (a blank cell matches any), at() in expressions, grid completeness and the other checks `npm run validate` makes,
// slider positions and labels, and the lookup's speed on a 100k-row table.
import { describe, expect, it } from "vitest";
import { cellPosition, nearestPosition, positionLabels, positions, snap } from "../../src/widgets/core/grid";
import type { DataChartSpec } from "../../src/widgets/core/types";
import { chartData, chartSet, chartValue, gridProblems, seriesAt } from "../../src/widgets/data-chart/series";
import { parseTable, type Table } from "../../src/widgets/data/table";
import { checkExpr, checkView, checkWidget, functionsOf, withDerived } from "../../src/widgets/expr";
import { WidgetSpec } from "../../src/widgets/spec";

const chart = (s: unknown) => WidgetSpec.parse(s) as DataChartSpec;
const csv = (text: string) => parseTable(text.trim().replace(/^ +/gm, ""), "csv");

const TABLE = csv(`
  series,h,k,x,y
  hist,,,1,5
  hist,,,2,7
  fit,0.5,1,1,10
  fit,0.5,1,2,20
  fit,0.5,1,3,30
  fit,1,1,1,11
  fit,1,1,2,21
  fit,1,1,3,31
  fit,0.5,2,1,12
  fit,1,2,1,13
  fit,1,2,2,23
  fit,,3,1,40
  fit,,3,2,41
  err,,1,0.5,0.4
  err,,1,1,0.2
  err,,2,0.5,0.3
  err,,2,1,0.1
  err,,3,0.5,0.9
  err,,3,1,0.9
  best,,,0,0.75
`);

const SPEC = {
  type: "data-chart",
  dataset: "t",
  params: {
    h: { tex: "h", min: 0.5, max: 1, step: 0.5, default: 0.5 },
    k: { tex: "k", min: 1, max: 3, step: 1, default: 1, labels: { "1": "one", "2": "two", "3": "three" } },
    px: { tex: "p", min: 0, max: 4, step: 0.5, default: 1 },
    py: { tex: "q", min: 0, max: 40, step: 5, default: 10 },
  },
  derived: { e: 'at("err", h)' },
  readouts: [{ id: "e_out", expr: 'at("err", h) * 10' }],
  panels: [
    {
      id: "main",
      x: { column: "x" },
      y: { column: "y" },
      series: [
        { id: "hist", mark: "bar", where: { series: "hist" } },
        { id: "fit", where: { series: "fit", h: { param: "h" }, k: { param: "k" } } },
        { id: "probe", drag: { x: "px", y: "py" } },
      ],
    },
    { id: "side", mark: "point", x: { column: "x" }, y: { column: "y" }, series: [{ id: "err", mark: "line", where: { series: "err", k: { param: "k" } } }, { id: "best", where: { series: "best" } }] },
  ],
};

const ys = (spec: DataChartSpec, table: Table, params: Record<string, number>, id: string) =>
  chartSet(spec, table, params).flatMap((p) => p.series).find((s) => s.id === id)!.points.map((p) => p.y);

describe("rows matched to the sliders", () => {
  const spec = chart(SPEC);

  it("take the rows of the current slider position, sorted by x", () => {
    expect(ys(spec, TABLE, { h: 0.5, k: 1 }, "fit")).toEqual([10, 20, 30]);
    expect(ys(spec, TABLE, { h: 1, k: 1 }, "fit")).toEqual([11, 21, 31]);
    expect(ys(spec, TABLE, { h: 1, k: 2 }, "fit")).toEqual([13, 23]);
    // the defaults stand in for a param not given
    expect(ys(spec, TABLE, {}, "fit")).toEqual([10, 20, 30]);
  });

  it("a blank cell matches any position of its param", () => {
    // fit at k = 3 does not depend on h: the same rows at either bandwidth
    expect(ys(spec, TABLE, { h: 0.5, k: 3 }, "fit")).toEqual([40, 41]);
    expect(ys(spec, TABLE, { h: 1, k: 3 }, "fit")).toEqual([40, 41]);
    // err is keyed by k only; hist and best by nothing
    expect(ys(spec, TABLE, { h: 1, k: 2 }, "err")).toEqual([0.3, 0.1]);
    expect(ys(spec, TABLE, { h: 1, k: 2 }, "hist")).toEqual([5, 7]);
  });

  it("a value between positions (an animation's frame) reads the nearest position", () => {
    expect(ys(spec, TABLE, { h: 0.8, k: 1.2 }, "fit")).toEqual([11, 21, 31]);
  });

  it("cells written with 6 significant digits still match a position; others match nothing", () => {
    const p = { min: 0, max: 1, step: 1 / 3 };
    expect(cellPosition(p, 0.333333)).toBe(1);
    expect(cellPosition(p, 0.5)).toBeUndefined();
    expect(cellPosition(p, 2)).toBeUndefined();
  });

  it("each series carries its mark: its own, then the panel's, then the spec's; a dragged point is one point at its params", () => {
    const [main, side] = chartSet(spec, TABLE, { px: 2.5, py: 15 });
    expect(main!.series.map((s) => s.mark)).toEqual(["bar", "line", "point"]);
    expect(side!.series.map((s) => s.mark)).toEqual(["line", "point"]);
    expect(main!.series[2]!.points).toEqual([{ x: 2.5, y: 15, label: "2.5", approx: false }]);
  });

  it("literal filters and the single-chart form read as before", () => {
    const single = chart({ type: "data-chart", dataset: "t", x: { column: "x" }, y: { column: "y" }, series: [{ id: "b", where: { series: "best" } }] });
    expect(chartData(single, TABLE).series[0]!.points.map((p) => p.y)).toEqual([0.75]);
  });

  it("test keys read series in any panel at the test's params", () => {
    const at = chartSet(spec, TABLE, { h: 1, k: 1 });
    expect(chartValue(at, "fit@2")).toBe(21);
    expect(chartValue(at, "err.min")).toBe(0.2);
    expect(chartValue(at, "nope@2")).toBeUndefined();
  });
});

describe("at()", () => {
  const spec = chart(SPEC);

  it("reads a series at x after its filters, linear between points", () => {
    expect(seriesAt(spec, TABLE, { k: 1 }, "err", 1)).toBe(0.2);
    expect(seriesAt(spec, TABLE, { k: 2 }, "err", 0.75)).toBeCloseTo(0.2, 12);
    expect(seriesAt(spec, TABLE, {}, "best", 0)).toBe(0.75);
  });

  it("errors outside the series' x range, on an empty series and on an unknown one", () => {
    expect(() => seriesAt(spec, TABLE, { k: 1 }, "err", 2)).toThrow(/x is outside the series' range \[0.5, 1\]/);
    const gap = chart({ ...SPEC, params: { ...SPEC.params, h: { tex: "h", min: 0.5, max: 1.5, step: 0.5, default: 1.5 } } });
    expect(() => seriesAt(gap, TABLE, { h: 1.5, k: 1 }, "fit", 1)).toThrow(/has no rows at h = 1.5, k = 1/);
    expect(() => seriesAt(spec, TABLE, {}, "nope", 1)).toThrow("at(): there is no series 'nope'");
  });

  it("is a function only data-chart expressions may call, naming its series in quotes", () => {
    expect(functionsOf(spec)).toContain("at");
    expect(checkExpr('at("err", h)', ["h"], functionsOf(spec))).toMatchObject({ errors: [], lookups: new Set(["err"]) });
    expect(checkExpr("at(err, h)", ["h", "err"], functionsOf(spec)).errors).toEqual(['at() takes a series id in quotes first: at("series", x)']);
    expect(checkExpr('at("err", h)', ["h"]).errors).toEqual(["function at() is not allowed here"]);
    expect(checkExpr('"err" + h', ["h"], functionsOf(spec)).errors).toEqual(["only numbers may appear as constants"]);
  });

  it("works in derived values and readouts once the widget (or validate) has the table", () => {
    const r = checkWidget(spec, () => TABLE);
    expect(r.errors).toEqual([]);
    const scope = withDerived(spec, { h: 1, k: 2 });
    expect(scope.e).toBe(0.1);
  });
});

describe("validate", () => {
  it("passes a sound spec and recomputes its tests through the lookup", () => {
    const ok = chart({ ...SPEC, tests: [{ params: { h: 1, k: 2 }, expect: { e: 0.1, e_out: 1, "fit@2": 23, "err.n": 2 } }] });
    expect(checkWidget(ok, () => TABLE)).toEqual({ errors: [], notes: [] });
    const bad = chart({ ...SPEC, tests: [{ params: { h: 1, k: 2 }, expect: { e: 0.2 } }] });
    expect(checkWidget(bad, () => TABLE).errors).toEqual(["tests[0]: e = 0.1, expected 0.2 ± 0.000001"]);
    // without the dataset the test is not run, as for any dataset-backed widget
    expect(checkWidget(ok).notes.length).toBeGreaterThan(0);
  });

  it("reports every slider position a bound series has no rows for", () => {
    const gap = chart({ ...SPEC, params: { ...SPEC.params, h: { tex: "h", min: 0.5, max: 1.5, step: 0.5, default: 0.5 } } });
    expect(gridProblems(gap, TABLE)).toEqual(["series 'fit' has no rows at 2 slider position(s): h = 1.5, k = 1; h = 1.5, k = 2"]);
    // h = 0.5, k = 2 has a row at x = 1 only, which is enough: the gap is a position with no rows at all
    const holes = csv("series,h,k,x,y\nfit,0.5,1,1,1\nfit,0.5,2,1,1\nfit,1,1,1,1\nhist,,,1,1\nerr,,1,0.5,1\nerr,,2,0.5,1\nerr,,3,0.5,1\nbest,,,0,1");
    expect(checkWidget(chart(SPEC), () => holes).errors).toEqual(["series 'fit' has no rows at 3 slider position(s): h = 0.5, k = 3; h = 1, k = 2; h = 1, k = 3"]);
  });

  it("reports grid cells on no slider position", () => {
    const off = csv("series,h,k,x,y\nfit,0.75,1,1,1\nfit,,1,1,1\nfit,,2,1,1\nfit,,3,1,1\nhist,,,1,1\nerr,,1,0.5,1\nerr,,2,0.5,1\nerr,,3,0.5,1\nbest,,,0,1");
    expect(gridProblems(chart(SPEC), off)).toEqual(["series 'fit': 1 row(s) have a h value on no slider position of 'h' (first: 0.75)"]);
  });

  it("checks params, filters, dragged points, labels and at() names without the data", () => {
    const bad = chart({
      ...SPEC,
      params: { ...SPEC.params, h: { tex: "h", min: 0.5, max: 1, default: 0.5 }, k: { ...SPEC.params.k, labels: { "1": "one", "1.5": "half", "2": " " } } },
      derived: { e: 'at("errr", h)' },
      panels: [
        { ...SPEC.panels[0], series: [{ id: "fit", where: { h: { param: "h" }, k: { param: "kk" } } }, { id: "probe", column: "y", drag: { x: "px", y: "pz" } }] },
        { ...SPEC.panels[1], series: [{ id: "fit", where: { series: "err" } }] },
      ],
    });
    expect(checkWidget(bad).errors).toEqual([
      // (JavaScript lists integer keys first)
      "params.k.labels.2 is empty",
      "params.k.labels: '1.5' is not a slider position (min + k·step)",
      "id 'fit' is used twice",
      "panels.main.series.fit.where.h: 'h' needs a step (the table holds rows per slider position)",
      "panels.main.series.fit.where.k: 'kk' is not a parameter",
      "panels.main.series.probe: a dragged point is drawn at its params and takes no where or column",
      "panels.main.series.probe.drag.y: 'pz' is not a parameter",
      'derived.e: at("errr", …) names no series of this chart (series: fit, probe)',
      'readouts.e_out: at("err", …) names no series of this chart (series: fit, probe)',
    ]);
  });

  it("evaluates a goal that reads at() where its view starts", () => {
    const spec = chart(SPEC);
    checkWidget(spec, () => TABLE);
    expect(checkView(spec, { state: { k: 2, h: 1 }, goal: { when: 'e == at("err", 1)' } }, () => TABLE)).toEqual([
      "goal.when already holds at the view's starting values, so the learner's first nudge would meet it; start the view (state) where it does not",
    ]);
    expect(checkView(spec, { state: { k: 1 }, goal: { when: 'e == at("err", 1) and k == 2' } }, () => TABLE)).toEqual([]);
  });

  it("needs x and y, or panels instead of them", () => {
    expect(() => chart({ type: "data-chart", dataset: "t", x: { column: "x" } })).toThrow(/needs x and y, or panels/);
    expect(() => chart({ ...SPEC, x: { column: "x" } })).toThrow(/needs x and y, or panels/);
    expect(() => chart({ ...SPEC, panels: [SPEC.panels[0]] })).toThrow();
  });
});

describe("slider positions", () => {
  const p = { tex: "p", min: 0, max: 4, step: 0.5, default: 1 };

  it("snap a dragged value to the nearest position inside the range", () => {
    expect(positions(p)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
    expect(snap(p, 1.3)).toBe(1.5);
    expect(snap(p, 1.2)).toBe(1);
    expect(snap(p, -3)).toBe(0);
    expect(snap(p, 9)).toBe(4);
    expect(snap({ min: 0, max: 0.3, step: 0.1 }, 0.29)).toBe(0.3);
    expect(nearestPosition(p, 2.24)).toBe(4);
  });

  it("are labelled only when every position has a label", () => {
    expect(positionLabels({ ...p, max: 1, labels: { "0": "a", "0.5": "b", "1": "c" } })).toEqual(["a", "b", "c"]);
    expect(positionLabels({ ...p, max: 1, labels: { "0": "a", "1": "c" } })).toBeNull();
    expect(positionLabels(p)).toBeNull();
  });
});

describe("speed on a 100k-row table", () => {
  // 50 x 20 slider positions, 100 x values each: 100,000 rows.
  const rows = ["series,a,b,x,y"];
  for (let a = 0; a < 50; a++) for (let b = 0; b < 20; b++) for (let x = 0; x < 100; x++) rows.push(`f,${a},${b},${x},${a + b + x / 100}`);
  const big = parseTable(rows.join("\n"), "csv");
  const spec = chart({
    type: "data-chart",
    dataset: "big",
    params: { a: { tex: "a", min: 0, max: 49, step: 1, default: 0 }, b: { tex: "b", min: 0, max: 19, step: 1, default: 0 } },
    x: { column: "x" },
    y: { column: "y" },
    series: [{ id: "f", where: { series: "f", a: { param: "a" }, b: { param: "b" } } }],
  });

  it("indexes once, then answers a slider move without rescanning the table", () => {
    const t0 = performance.now();
    chartSet(spec, big, { a: 0, b: 0 });
    const index = performance.now() - t0;
    const times: number[] = [];
    for (let i = 1; i <= 40; i++) {
      const t = performance.now();
      const d = chartSet(spec, big, { a: i, b: i % 20 });
      times.push(performance.now() - t);
      expect(d[0]!.series[0]!.points).toHaveLength(100);
    }
    const worst = Math.max(...times);
    console.log(`100k rows: index ${index.toFixed(1)} ms once; slider move worst ${worst.toFixed(2)} ms, median ${times.sort((x, y) => x - y)[20]!.toFixed(2)} ms`);
    expect(worst).toBeLessThan(10);
  });
});
