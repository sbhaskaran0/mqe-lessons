// @vitest-environment happy-dom
// distribution end to end: a lognormal with a σ slider (the Gini readout follows the closed form), the four views,
// goals on built-in measures, predictions, and a dataset column (weighted) measured from a served CSV.
import "./setup";
import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { format } from "../../src/widgets/format";
import { normCdf } from "../../src/widgets/distribution/measures";
import { block, entryOf, memoryDataset, mount, serve } from "./data-helpers";

afterEach(() => vi.unstubAllGlobals());

const LOGNORMAL = {
  type: "distribution",
  title: "Lognormal incomes",
  params: { s: { tex: "\\sigma", min: 0.1, max: 1.6, default: 0.5, step: 0.05 } },
  family: "lognormal",
  dist: { mu: 0, sigma: "s" },
  views: ["density", "lorenz", "cdf"],
  measures: ["gini", "p90p10", "varlog", "top10"],
};
const gini = (sigma: number) => 2 * normCdf(sigma / Math.SQRT2) - 1;

describe("a parametric distribution with a σ slider", () => {
  it("shows measures from the closed forms and updates them as σ moves", async () => {
    const w = await mount(entryOf(LOGNORMAL));
    await w.ready();
    expect(w.readout("gini")).toBe(format(".3f", gini(0.5)));
    expect(w.readout("varlog")).toBe(format(".3f", 0.25));
    expect(w.readout("p90p10")).toBe(format(".2f", Math.exp(2 * 0.5 * 1.2815515655446004)));
    w.move("s", 1.2);
    expect(w.readout("gini")).toBe(format(".3f", gini(1.2)));
    expect(w.readout("gini")).not.toBe(format(".3f", gini(0.5)));
    expect(w.readout("top10")).toBe(format(".1%", 1 - normCdf(1.2815515655446004 - 1.2)));
    w.move("s", 0.1);
    expect(Number(w.readout("gini"))).toBeLessThan(0.1);
  });

  it("draws the density, with tabs for the other views", async () => {
    const w = await mount(entryOf(LOGNORMAL));
    await w.ready();
    expect([...w.c.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(["Density", "Lorenz curve", "CDF"]);
    expect(w.c.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Density");
    expect(w.el("density")!.querySelector("path")!.getAttribute("d")).toMatch(/^M[\d.]+,-?[\d.]+L/);
    expect(w.c.querySelector("path.w-area")).not.toBeNull();
    // the density's curve moves when σ does
    const before = w.el("density")!.querySelector("path")!.getAttribute("d");
    w.move("s", 1.4);
    expect(w.el("density")!.querySelector("path")!.getAttribute("d")).not.toBe(before);
  });

  it("the Lorenz view draws the curve, the 45° line and the shaded Gini area", async () => {
    const w = await mount(entryOf(LOGNORMAL));
    await w.ready();
    fireEvent.click(w.c.querySelector('[data-view="lorenz"]')!);
    expect(w.el("lorenz")).not.toBeNull();
    expect(w.el("equality")).not.toBeNull();
    const shade = w.c.querySelector("path.w-area")!;
    expect(shade.getAttribute("d")).toMatch(/Z$/);
    expect(w.c.querySelector('[data-label="gini-area"] .katex')).not.toBeNull();
    // the curve's end points are the corners of the square
    const d = w.el("lorenz")!.querySelector("path")!.getAttribute("d")!.split("L");
    const [x0, y0] = d[0]!.slice(1).split(",").map(Number);
    const [x1, y1] = d[d.length - 1]!.split(",").map(Number);
    expect(y0).toBeCloseTo(0, 5);
    expect(x0).toBeCloseTo(0, 5);
    expect(y1! / -1).toBeGreaterThan(0);
    expect(x1).toBeGreaterThan(0);
  });

  it("the CDF view draws a curve, and each view keeps the readouts", async () => {
    const w = await mount(entryOf(LOGNORMAL));
    await w.ready();
    fireEvent.click(w.c.querySelector('[data-view="cdf"]')!);
    expect(w.el("cdf")).not.toBeNull();
    expect(w.readout("gini")).toBe(format(".3f", gini(0.5)));
  });

  it("a histogram is bars; a log x axis labels powers of ten", async () => {
    const w = await mount(entryOf({ ...LOGNORMAL, views: ["histogram"], x: { log: true, label: "Income" } }));
    await w.ready();
    expect(w.el("histogram")!.querySelectorAll("rect").length).toBeGreaterThan(20);
    expect(w.c.querySelector(".w-axis-title-x")?.textContent).toContain("Income (log scale)");
    expect([...w.c.querySelectorAll(".w-ticks text")].map((t) => t.textContent)).toEqual(expect.arrayContaining(["1"]));
    expect(w.c.querySelector('[role="tablist"]')).toBeNull();
  });

  it("marks the percentile lines behind the ratios, and drops them with the measure", async () => {
    const w = await mount(entryOf(LOGNORMAL));
    await w.ready();
    expect(["line-p10", "line-p90"].map((id) => w.el(id) !== null)).toEqual([true, true]);
    expect(w.el("line-p50")).toBeNull();
    w.rerender(block({ show: ["density", "gini"] }));
    await waitFor(() => expect(w.el("line-p10")).toBeNull());
  });

  it("a view's show list picks the plot and the readouts; highlight picks the tab", async () => {
    const w = await mount(entryOf(LOGNORMAL), block({ show: ["lorenz", "gini"], highlight: "lorenz" }));
    await w.ready();
    expect(w.c.querySelector('[role="tablist"]')).toBeNull();
    expect(w.el("lorenz")).not.toBeNull();
    expect(w.el("density")).toBeNull();
    expect(w.readout("gini")).not.toBeNull();
    expect(w.readout("p90p10")).toBeNull();
    expect(w.el("lorenz")!.querySelector(".w-halo")).not.toBeNull();
  });

  it("highlight chooses which of several views opens", async () => {
    const w = await mount(entryOf(LOGNORMAL), block({ highlight: "cdf" }));
    await w.ready();
    expect(w.c.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("CDF");
  });

  it("a goal on a measure fires once, when the learner's move satisfies it", async () => {
    const onGoalMet = vi.fn();
    const goal = { when: "gini > 0.4", success: "That is a **very** unequal society.", hint: "Raise sigma." };
    const w = await mount(entryOf(LOGNORMAL), block({ goal, state: { s: 0.3 } }), { onGoalMet });
    await w.ready();
    expect(onGoalMet).not.toHaveBeenCalled();
    w.move("s", 0.6);
    expect(onGoalMet).not.toHaveBeenCalled();
    w.move("s", 0.9);
    await waitFor(() => expect(onGoalMet).toHaveBeenCalledTimes(1));
    expect(w.c.querySelector('[data-goal="met"]')?.textContent).toContain("very unequal");
    w.move("s", 1.1);
    expect(onGoalMet).toHaveBeenCalledTimes(1);
  });

  it("a locked σ is a chip rather than a slider, and a preset applies", async () => {
    const w = await mount(entryOf(LOGNORMAL), block({ state: { s: 1 }, lock: ["s"] }));
    await w.ready();
    expect(w.c.querySelector('[data-param="s"] input')).toBeNull();
    expect(w.c.querySelector('.w-chip[data-param="s"]')).not.toBeNull();
    expect(w.readout("gini")).toBe(format(".3f", gini(1)));
  });

  it("a prediction hides the Gini until committed, then reveals it", async () => {
    const onPredict = vi.fn();
    const predict = { hide: ["gini"], ask: "Will the Gini rise?", options: ["Rise", "Fall"], answer: 0 };
    const w = await mount(entryOf(LOGNORMAL), block({ predict }), { onPredict });
    await w.ready();
    expect(w.readout("gini")).toBeNull();
    expect(w.readout("p90p10")).not.toBeNull();
    fireEvent.click(w.c.querySelector('[role="radio"]')!);
    fireEvent.click(w.button(/commit/i)!);
    await waitFor(() => expect(w.readout("gini")).not.toBeNull());
    expect(onPredict).toHaveBeenCalledWith({ option: 0, correct: true });
  });

  it("a marker prediction reads a value off the density axis", async () => {
    const onPredict = vi.fn();
    const w = await mount(entryOf(LOGNORMAL), block({ predict: { hide: ["p90p10"], ask: "Where is the median?" } }), { onPredict });
    await w.ready();
    expect(w.c.querySelector('[data-handle="predict-marker"]')).not.toBeNull();
    expect(w.button(/commit/i)!.hasAttribute("disabled")).toBe(true);
  });

  it("parameters that define no distribution say so, and read as NaN", async () => {
    const w = await mount(entryOf({ ...LOGNORMAL, params: { s: { tex: "\\sigma", min: -1, max: 1, default: -0.5, step: 0.1 } } }));
    await w.ready();
    expect(w.readout("gini")).toBe("—");
    expect(w.c.textContent).toContain("don't define a distribution");
  });

  it("the other families render and report their closed forms", async () => {
    const pareto = await mount(entryOf({ type: "distribution", params: { a: { tex: "\\alpha", min: 1.2, max: 4, default: 2, step: 0.1 } }, family: "pareto", dist: { alpha: "a", xmin: 1 }, views: ["density", "lorenz"], measures: ["gini", "top10"] }));
    await pareto.ready();
    expect(pareto.readout("gini")).toBe("0.333"); // 1 / (2α − 1)
    pareto.move("a", 3);
    expect(pareto.readout("gini")).toBe("0.200");
  });

  it("derived values and readouts can read the measures", async () => {
    const w = await mount(entryOf({ ...LOGNORMAL, derived: { twice: "2*s" }, readouts: [{ id: "gx2", expr: "gini*2", tex: "2G", format: ".3f" }] }));
    await w.ready();
    expect(w.readout("gx2")).toBe(format(".3f", 2 * gini(0.5)));
  });
});

describe("a dataset column", () => {
  const spec = (over = {}) => ({ type: "distribution", dataset: "pay", column: "wage", views: ["histogram", "lorenz", "cdf"], measures: ["gini", "mean", "median", "top10", "p90p10"], x: { label: "Wage" }, ...over });

  it("measures the column (1, 2, 3, 4 has Gini 0.25) and draws bars from it", async () => {
    const d = memoryDataset("pay", "wage,w\n1,1\n2,1\n3,1\n4,1\n");
    serve(d.files);
    const w = await mount(entryOf(spec()), null, {}, { pay: d.meta });
    await w.ready();
    expect(w.readout("gini")).toBe("0.250");
    expect(w.readout("mean")).toBe("2.5");
    expect(w.readout("median")).toBe("2.5");
    expect(w.readout("top10")).toBe("16.0%");
    expect(w.readout("p90p10")).toBe(format(".2f", 4));
    expect(w.el("histogram")!.querySelectorAll("rect")).toHaveLength(4); // the four occupied bins
    expect(w.c.querySelector(".w-data-note")?.textContent).toContain("Dataset pay");
    expect(w.c.querySelector(".w-axis-title-x")?.textContent).toContain("Wage");
  });

  it("uses a weight column", async () => {
    const d = memoryDataset("pay", "wage,w\n1,1\n2,1\n3,1\n4,3\n");
    serve(d.files);
    const w = await mount(entryOf(spec({ weight: "w" })), null, {}, { pay: d.meta });
    await w.ready();
    expect(w.readout("mean")).toBe("3"); // (1 + 2 + 3 + 12) / 6
    expect(w.c.querySelector(".w-data-note")?.textContent).toContain("weighted by");
  });

  it("goals read measures of a dataset too", async () => {
    const d = memoryDataset("pay", "wage\n1\n1\n1\n9\n");
    serve(d.files);
    const e = entryOf(spec({ params: { k: { tex: "k", min: 0, max: 1, default: 0, step: 0.1 } }, measures: ["gini"] }));
    const onGoalMet = vi.fn();
    const w = await mount(e, block({ goal: { when: "gini > 0.45 and k > 0.2", success: "ok" } }), { onGoalMet }, { pay: d.meta });
    await w.ready();
    w.move("k", 0.5);
    await waitFor(() => expect(onGoalMet).toHaveBeenCalledTimes(1));
  });

  it("a column of negative values has no Lorenz curve, and says so", async () => {
    const d = memoryDataset("pay", "wage\n-1\n2\n3\n");
    serve(d.files);
    const w = await mount(entryOf(spec({ views: ["lorenz"] })), null, {}, { pay: d.meta });
    await waitFor(() => expect(w.c.textContent).toContain("needs non-negative values"));
    expect(w.readout("gini")).toBe("—");
  });

  it("a missing column is an error card that names the columns", async () => {
    const d = memoryDataset("pay", "wage\n1\n2\n");
    serve(d.files);
    const w = await mount(entryOf(spec({ column: "salary" })), null, {}, { pay: d.meta });
    await waitFor(() => expect(w.c.querySelector(".w-notice-error")).not.toBeNull());
    expect(w.c.textContent).toContain("no column 'salary' (columns: wage)");
  });

  it("shows ≈ context for chart-read datasets", async () => {
    const d = memoryDataset("pay", "wage\n1\n2\n", { description: "Approximate values read off the lecture chart." });
    serve(d.files);
    const w = await mount(entryOf(spec()), null, {}, { pay: d.meta });
    await w.ready();
    expect(w.c.querySelector(".w-data-note")?.textContent).toContain("≈ Approximate");
  });
});
