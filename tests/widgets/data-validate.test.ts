// `npm run validate` for data and distribution widgets: parametric `tests` are recomputed from the closed forms,
// dataset-backed ones from the dataset file in the export, and bad specs or datasets are reported.
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateContent } from "../../src/validate";
import { parseTable, type Table } from "../../src/widgets/data/table";
import { checkWidget } from "../../src/widgets/expr";
import { normCdf } from "../../src/widgets/distribution/measures";
import { WidgetSpec } from "../../src/widgets/spec";
import { exportFixture, scratchDir } from "../helpers";

const spec = (s: unknown) => WidgetSpec.parse(s);
const gini = (sigma: number) => 2 * normCdf(sigma / Math.SQRT2) - 1;

const LOGNORMAL = {
  type: "distribution",
  params: { s: { tex: "\\sigma", min: 0.1, max: 1.6, default: 0.5 } },
  family: "lognormal",
  dist: { sigma: "s" },
  measures: ["gini"],
};

describe("parametric distribution tests", () => {
  it("recomputes Gini, ratios and the rest at the test's params", () => {
    const r = checkWidget(
      spec({ ...LOGNORMAL, tests: [{ params: { s: 0.8 }, expect: { gini: gini(0.8), varlog: 0.64, p90p10: 7.7716500608, s: 0.8 } }, { expect: { gini: gini(0.5) } }] }),
    );
    expect(r.errors).toEqual([]);
    expect(r.notes).toEqual([]);
  });

  it("reports a wrong expectation with the computed value", () => {
    const r = checkWidget(spec({ ...LOGNORMAL, tests: [{ params: { s: 0.8 }, expect: { gini: 0.5 } }] }));
    expect(r.errors).toEqual(["tests[0]: gini = 0.428392, expected 0.5 ± 0.000001"]);
  });

  it("readouts can read the measures in a test", () => {
    const r = checkWidget(spec({ ...LOGNORMAL, derived: { half: "s/2" }, readouts: [{ id: "double", expr: "gini*2" }], tests: [{ expect: { half: 0.25, double: gini(0.5) * 2 } }] }));
    expect(r.errors).toEqual([]);
    expect(r.notes).toEqual([]);
  });

  it("derived values can't read the measures: the runtime works them out before the distribution exists", () => {
    const r = checkWidget(spec({ ...LOGNORMAL, derived: { halfG: "gini/2" }, tests: [{ expect: { halfG: gini(0.5) / 2 } }] }));
    expect(r.errors).toEqual(["derived.halfG: unknown name 'gini'"]);
    expect(r.notes).toEqual([]);
  });

  it("a test that fails to evaluate is an error, not a note", () => {
    // Fine at the default s = 0.5; at s = 0.8 the square root is complex and max() rejects it.
    const r = checkWidget(spec({ ...LOGNORMAL, readouts: [{ id: "x", expr: "max(1, sqrt(0.7 - s))" }], tests: [{ params: { s: 0.8 }, expect: { x: 1 } }] }));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^tests\[0\]: Cannot calculate max/);
    expect(r.notes).toEqual([]);
  });

  it("a measure is a name goals can use: an unknown name is still an error", () => {
    expect(checkWidget(spec({ ...LOGNORMAL, readouts: [{ id: "x", expr: "gini + nope" }] })).errors).toEqual(["readouts.x: unknown name 'nope'"]);
  });

  it("closed forms for the other families", () => {
    const r = checkWidget(
      spec({
        type: "distribution",
        params: { a: { tex: "\\alpha", min: 1.1, max: 5, default: 2 } },
        family: "pareto",
        dist: { alpha: "a", xmin: 3 },
        tests: [{ params: { a: 3 }, expect: { gini: 0.2, mean: 4.5, top10: 0.1 ** (2 / 3) } }],
      }),
    );
    expect(r.errors).toEqual([]);
    const u = checkWidget(spec({ type: "distribution", family: "uniform", dist: { hi: 2 }, tests: [{ expect: { gini: 1 / 3, mean: 1 } }] }));
    expect(u.errors).toEqual([]);
  });

  it("checks the family's parameters", () => {
    expect(checkWidget(spec({ type: "distribution", family: "lognormal", dist: { mu: 0 } })).errors).toEqual(["dist.sigma: a lognormal needs it"]);
    expect(checkWidget(spec({ type: "distribution", family: "lognormal", dist: { sigma: 1, alpha: 2 } })).errors).toEqual(["dist.alpha: a lognormal takes sigma, mu"]);
    expect(checkWidget(spec({ type: "distribution", family: "pareto", dist: { alpha: "q" } })).errors).toEqual(["dist.alpha: unknown name 'q'"]);
    expect(checkWidget(spec({ type: "distribution", family: "normal", dist: { sigma: 1 }, column: "x" })).errors).toEqual(["column and weight read a dataset; a family has none"]);
    expect(checkWidget(spec({ type: "distribution", dataset: "d", column: "x", dist: { sigma: 1 } })).errors).toEqual(["dist gives a family's parameters; a dataset has none"]);
    expect(checkWidget(spec({ type: "distribution", family: "normal", dist: { sigma: 1 }, weight: "w" })).errors).toContain("weight needs a dataset");
  });
});

describe("dataset-backed tests", () => {
  const table = (csv: string): Table => parseTable(csv, "csv");
  const lookup = (csv: string) => (id: string) => (id === "pay" ? table(csv) : undefined);
  const DIST = { type: "distribution", dataset: "pay", column: "wage", measures: ["gini"] };

  it("computes measures of a column", () => {
    const r = checkWidget(spec({ ...DIST, tests: [{ expect: { gini: 0.25, mean: 2.5, median: 2.5, top10: 0.16, p90p10: 4 } }] }), lookup("wage\n1\n2\n3\n4\n"));
    expect(r.errors).toEqual([]);
    expect(r.notes).toEqual([]);
  });

  it("weights count", () => {
    const r = checkWidget(spec({ ...DIST, weight: "w", tests: [{ expect: { mean: 3 } }] }), lookup("wage,w\n1,1\n2,1\n3,1\n4,3\n"));
    expect(r.errors).toEqual([]);
  });

  it("reports a wrong number, and runs nothing (a note) when no data is given", () => {
    const wrong = checkWidget(spec({ ...DIST, tests: [{ expect: { gini: 0.3 } }] }), lookup("wage\n1\n2\n3\n4\n"));
    expect(wrong.errors).toEqual(["tests[0]: gini = 0.25, expected 0.3 ± 0.000001"]);
    const none = checkWidget(spec({ ...DIST, tests: [{ expect: { gini: 0.25 } }] }));
    expect(none.errors).toEqual([]);
    expect(none.notes).toHaveLength(1);
    expect(none.notes[0]).toMatch(/tests\[0\] not run: .*dataset 'pay'/);
  });

  it("names a column the dataset lacks", () => {
    expect(checkWidget(spec({ ...DIST, weight: "ww" }), lookup("wage\n1\n")).errors).toEqual(["column 'ww' is not in the dataset (columns: wage)"]);
    expect(checkWidget(spec({ ...DIST, column: "name" }), lookup("name\na\nb\n")).errors).toEqual(["column 'name' has no numbers"]);
  });

  const CHART = {
    type: "data-chart",
    dataset: "pay",
    x: { column: "year" },
    y: { column: "rate" },
    series: [
      { id: "rich", where: { group: "rich" } },
      { id: "poor", where: { group: "poor" } },
    ],
  };
  const LONG = "year,group,rate\n2000,rich,0.25\n2000,poor,0.1\n2001,rich,0.22\n2001,poor,0.07\n2002,rich,0.3\n2002,poor,0.2\n";

  it("data-chart: series values at an x and summaries", () => {
    const r = checkWidget(spec({ ...CHART, tests: [{ expect: { "rich@2001": 0.22, "poor@2000": 0.1, "rich.max": 0.3, "poor.min": 0.07, "rich.first": 0.25, "poor.last": 0.2, "rich.n": 3, "poor.mean": 0.37 / 3 } }] }), lookup(LONG));
    expect(r.errors).toEqual([]);
    const bad = checkWidget(spec({ ...CHART, tests: [{ expect: { "rich@2001": 0.2, "poor@1999": 0, "nope.max": 1 } }] }), lookup(LONG));
    expect(bad.errors).toEqual(["tests[0]: rich@2001 = 0.22, expected 0.2 ± 0.000001", "tests[0]: poor@1999 is NaN (expected 0)", "tests[0]: nope.max is undefined (expected 1)"]);
  });

  it("data-chart: wide format, a filter that matches nothing, a missing column, a band annotation that isn't there", () => {
    const wide = { type: "data-chart", dataset: "pay", x: { column: "year" }, y: { column: "a" }, series: [{ id: "A", column: "a" }, { id: "B", column: "b" }], tests: [{ expect: { "B@2": 20, "A.n": 2 } }] };
    expect(checkWidget(spec(wide), lookup("year,a,b\n1,1,10\n2,2,20\n")).errors).toEqual([]);
    expect(checkWidget(spec({ ...CHART, series: [{ id: "x", where: { group: "middle" } }] }), lookup(LONG)).errors).toEqual(["series 'x' has no data (its filter matches no rows, or 'rate' is empty there)"]);
    expect(checkWidget(spec({ ...CHART, y: { column: "wages" } }), lookup(LONG)).errors[0]).toMatch(/series 'rich' column 'wages' is not in the dataset/);
    const band = { type: "data-chart", dataset: "pay", x: { column: "c" }, y: { column: "v" }, annotations: [{ id: "n", x: "Spain", label: "?" }] };
    expect(checkWidget(spec(band), lookup("c,v\nUS,1\nUK,2\n")).errors).toEqual(["annotations.n: x 'Spain' is not one of the x values (US, UK)"]);
  });

  it("scatter-fit on a dataset now runs its tests too", () => {
    const fit = { type: "scatter-fit", dataset: "pay", x: { column: "x" }, y: { column: "y" }, params: { a: { tex: "a", min: -5, max: 5, default: 0 }, b: { tex: "b", min: -5, max: 5, default: 1 } }, line: { intercept: "a", slope: "b" }, tests: [{ expect: { slope_ols: 2, intercept_ols: 0, n: 3 } }] };
    expect(checkWidget(spec(fit), lookup("x,y\n1,2\n2,4\n3,6\n")).errors).toEqual([]);
  });
});

describe("npm run validate on an export", () => {
  const copy = () => {
    const dir = scratchDir("mqe-validate");
    cpSync(exportFixture(), dir, { recursive: true });
    return dir;
  };
  const withTests = (dir: string, tests: unknown) => {
    const file = path.join(dir, "index.json");
    const index = JSON.parse(readFileSync(file, "utf8"));
    index.widgets["toy-saving-chart"].spec.tests = tests;
    writeFileSync(file, JSON.stringify(index));
  };

  it("reads the dataset file from the export and checks data-chart tests against it", () => {
    const dir = copy();
    withTests(dir, [{ expect: { "rich@2008": 0.22, "poor@2008": 0.07, "rich.n": 21, "poor.max": 0.1 } }]);
    const r = validateContent(dir);
    expect(r.errors).toEqual([]);
    expect(r.notes.filter((n) => n.includes("not run"))).toEqual([]);
  });

  it("fails a wrong number", () => {
    const dir = copy();
    withTests(dir, [{ expect: { "rich@2008": 0.25 } }]);
    expect(validateContent(dir).errors).toEqual(["widgets.toy-saving-chart: tests[0]: rich@2008 = 0.22, expected 0.25 ± 0.000001"]);
  });

  it("fails when the dataset no longer has a column the widget draws", () => {
    const dir = copy();
    const file = path.join(dir, "assets", "data", "exports", "toy-saving-rates.csv");
    writeFileSync(file, readFileSync(file, "utf8").replace("year,group,rate", "year,group,share"));
    const errors = validateContent(dir).errors;
    expect(errors.some((e) => e.includes("column 'rate' is not in the dataset (columns: year, group, share)"))).toBe(true);
  });

  it("the unmodified fixture still validates", () => {
    expect(validateContent(copy()).errors).toEqual([]);
  });
});
