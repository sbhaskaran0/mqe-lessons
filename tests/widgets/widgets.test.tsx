// @vitest-environment happy-dom
// The widget runtime end to end: each type renders from the fixture export, views apply (presets, lock, show,
// highlight), goals fire once per view, predictions hide and reveal, and broken specs show an error card.
import "./setup";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WidgetEntry } from "../../src/ir";
import { solveParam } from "../../src/widgets/core/evaluate";
import { defaults, fitStats, generate, withDerived } from "../../src/widgets/expr";
import { format } from "../../src/widgets/format";
import { Gallery, collectViews } from "../../src/widgets/Gallery";
import type { InteractiveBlock, WidgetProps } from "../../src/widgets/host";
import { type Panel, WidgetSpec } from "../../src/widgets/spec";
import { WidgetErrorBoundary } from "../../src/widgets/ui/ErrorBoundary";
import { WidgetHost } from "../../src/widgets/WidgetHost";
import { fixture, lectureViews, setReducedMotion, widget } from "./setup";

type Props = Partial<Omit<WidgetProps, "entry" | "view">>;

async function mount(entry: WidgetEntry, view: InteractiveBlock | null = null, props: Props = {}) {
  const ui = (v: InteractiveBlock | null, p: Props = props) => <WidgetHost entry={entry} view={v} datasets={fixture().index.datasets} contentBase="" {...p} />;
  const r = render(ui(view));
  await waitFor(() => expect(r.container.querySelector(".w-root:not(.w-skeleton)")).not.toBeNull());
  const c = r.container;
  return {
    c,
    rerender: (v: InteractiveBlock | null, p?: Props) => r.rerender(ui(v, p)),
    el: (id: string) => c.querySelector(`[data-el="${id}"]`),
    slider: (id: string) => c.querySelector<HTMLInputElement>(`[data-param="${id}"] input`)!,
    readout: (id: string) => c.querySelector(`[data-readout="${id}"] output`)?.textContent ?? null,
    move: (id: string, v: number) => fireEvent.change(c.querySelector<HTMLInputElement>(`[data-param="${id}"] input`)!, { target: { value: String(v) } }),
    button: (text: RegExp) => [...c.querySelectorAll("button")].find((b) => text.test(b.textContent ?? "")),
  };
}

const view = (i: number) => lectureViews()[i] as InteractiveBlock;
const entryOf = (spec: unknown, slug = "test-widget"): WidgetEntry => {
  const s = spec as WidgetEntry["spec"];
  return { slug, name: "Test Widget", type: s.type, spec: s, illustrates: [], notation: [] };
};

const FIT = WidgetSpec.parse({
  type: "scatter-fit",
  title: "Fit a line",
  params: {
    a: { tex: "a", min: -5, max: 5, default: 0, step: 0.01 },
    b: { tex: "b", min: -2, max: 4, default: 0.5, step: 0.01 },
  },
  generate: { n: 30, seed: 7, x: "uniform(0, 10)", y: "1 + 2*x + normal(0, 1.5)" },
  x: { label: "Years of schooling" },
  y: { label: "Log wage" },
  line: { intercept: "a", slope: "b" },
});
const fitView = (extra: Partial<InteractiveBlock> = {}): InteractiveBlock => ({ t: "interactive", widget: "test-widget", ...extra });

describe("each widget type renders from the fixture export", () => {
  it("panels, a curve panel: curves, region, point, readouts and free sliders", async () => {
    const w = await mount(widget("toy-steady-state-explorer"));
    for (const id of ["output", "saving", "depreciation"]) expect(w.el(id)?.querySelector("path")?.getAttribute("d")).toMatch(/^M[\d.]+,-?[\d.]+L/);
    expect(w.el("consumption")).not.toBeNull();
    expect(w.el("steady")).not.toBeNull();
    expect(w.readout("kbar_out")).toBe("25.00");
    expect(w.readout("cbar_out")).toBe("2.500");
    expect(w.c.querySelectorAll(".w-param input:not(:disabled)")).toHaveLength(4);
    expect(w.c.querySelector(".w-lock")).toBeNull();
    expect(w.c.querySelector('[data-label="steady"] .katex')).not.toBeNull();
    expect(w.c.querySelector(".w-axis-title-x")?.textContent).toContain("Capital per worker");
  });

  it("panels, path panels: one panel per spec panel, series paths and the shock marker", async () => {
    const w = await mount(widget("toy-convergence"));
    expect([...w.c.querySelectorAll("[data-panel]")].map((p) => p.getAttribute("data-panel"))).toEqual(["levels", "growth"]);
    expect(w.c.querySelector('[data-panel="levels"] [data-el="capital"] path')?.getAttribute("d")?.split("L")).toHaveLength(61);
    expect(w.c.querySelector('[data-panel="growth"] [data-el="growth_y"]')).not.toBeNull();
    expect(w.c.querySelector('[data-label^="shock"]')?.textContent).toBe("Saving rate rises");
    expect(w.c.querySelector(".w-panel-kind")?.textContent).toBe("growth rate");
  });

  it("scatter-fit: seeded points, residuals and live SSR / R²", async () => {
    const w = await mount(entryOf(FIT));
    expect(w.el("points")?.querySelectorAll("circle")).toHaveLength(30);
    expect(w.el("residuals")?.querySelector("path")?.getAttribute("d")?.match(/M/g)).toHaveLength(30);
    const stats = fitStats(generate(FIT as never, defaults(FIT)), 0, 0.5);
    expect(w.readout("ssr")).toBe(format(undefined, stats.ssr));
    expect(w.readout("r2")).toBe(format(".3f", stats.r2));
    expect(w.c.querySelector('[data-handle="intercept"]')).not.toBeNull();
    expect(w.c.querySelector('[data-handle="slope"]')).not.toBeNull();
  });

  it("scatter-fit with a dataset explains that datasets arrive in phase 3", async () => {
    const spec = WidgetSpec.parse({ type: "scatter-fit", dataset: "toy-saving-rates", x: { column: "year" }, y: { column: "rate" }, line: { intercept: "a", slope: "b" } });
    const w = await mount(entryOf(spec));
    expect(w.c.textContent).toMatch(/phase 3/);
    expect(w.c.textContent).toContain("Toy saving rates by country group");
  });

  it("custom still renders the phase 3 stand-in card", async () => {
    const w = await mount(entryOf(WidgetSpec.parse({ type: "custom", component: "Demo", params: {} })));
    expect(w.c.textContent).toMatch(/coming in phase 3/);
  });
});

describe("phase (cobweb) panel", () => {
  const withPhase = () => {
    const spec = widget("toy-convergence").spec as Extract<WidgetSpec, { type: "panels" }>;
    return { ...widget("toy-convergence"), spec: { ...spec, panels: [...spec.panels, { kind: "path", id: "phase", phase: { label: "Cobweb" } }] } } as WidgetEntry;
  };

  it("draws the map, the 45° line and the cobweb of the simulated path", async () => {
    const w = await mount(withPhase());
    const phase = w.c.querySelector('[data-panel="phase"]')!;
    expect(phase.querySelector(".w-panel-title")?.textContent).toBe("Cobweb");
    expect(phase.querySelectorAll("line.w-curve")).toHaveLength(1);
    // map before the shock, map after it (dotted), and the cobweb
    expect(phase.querySelectorAll("path.w-curve")).toHaveLength(3);
    expect(phase.querySelector(".w-axis-title-y .katex")?.textContent).toContain("t+1");
  });

  it("is an element: a show list without 'phase' hides it", async () => {
    const w = await mount(withPhase(), { t: "interactive", widget: "toy-convergence", show: ["capital"] });
    expect(w.c.querySelector('[data-panel="phase"]')).toBeNull();
    expect(w.c.querySelector('[data-panel="growth"]')).toBeNull();
    expect(w.c.querySelector('[data-panel="levels"]')).not.toBeNull();
  });
});

describe("views", () => {
  it("apply presets, lock, show and highlight", async () => {
    const w = await mount(widget("toy-steady-state-explorer"), view(0));
    expect(w.slider("s").value).toBe("0.4");
    expect(w.readout("kbar_out")).toBe("16.00");
    // Locked parameters are chips, not sliders; the free one stays a slider.
    expect(w.c.querySelector('[data-param="A"] input')).toBeNull();
    expect(w.c.querySelector('[data-param="alpha"] input')).toBeNull();
    expect(w.slider("delta").disabled).toBe(false);
    expect(w.c.querySelectorAll('.w-chip[data-locked] .w-lock')).toHaveLength(2);
    expect(w.el("output")).toBeNull();
    expect(w.el("consumption")).toBeNull();
    expect(w.el("saving")).not.toBeNull();
    expect(w.el("depreciation")).not.toBeNull();
    expect(w.readout("cbar_out")).toBeNull();
    expect(w.el("steady")?.querySelector(".w-halo")).not.toBeNull();
    expect(w.el("saving")?.querySelector(".w-halo")).toBeNull();
  });

  it("shows a locked parameter as a chip with its value, never a slider", async () => {
    const w = await mount(widget("toy-steady-state-explorer"), view(0));
    const chip = w.c.querySelector('.w-chip[data-param="A"]')!;
    expect(chip.querySelector("input")).toBeNull();
    expect(chip.textContent).toContain("1.00");
  });

  it("animates presets when a new view arrives", async () => {
    setReducedMotion(false);
    const w = await mount(widget("toy-steady-state-explorer"));
    expect(w.slider("s").value).toBe("0.5");
    act(() => w.rerender(view(0)));
    expect(w.slider("s").value).toBe("0.5");
    await waitFor(() => expect(w.slider("s").value).toBe("0.4"));
  });

  it("keeps the learner's moves until the next view, and Reset restores the view's presets", async () => {
    const w = await mount(widget("toy-steady-state-explorer"), view(0));
    w.move("delta", 0.05);
    w.move("s", 0.6);
    act(() => w.rerender(view(1)));
    expect(w.c.querySelector('[data-param="delta"] input')).toBeNull();
    // delta, which view 1 doesn't preset, carries over; s takes view 1's preset.
    expect(w.c.querySelector('.w-chip[data-param="delta"] .w-chip-value')?.textContent).toBe("0.050");
    expect(w.slider("s").value).toBe("0.3");
    act(() => w.rerender(view(0)));
    expect(w.slider("s").value).toBe("0.4");
    fireEvent.click(w.button(/Reset/)!);
    expect(w.slider("delta").value).toBe("0.1");
    expect(w.slider("s").value).toBe("0.4");
  });

  it("explore mode (view null) shows everything and locks nothing", async () => {
    const w = await mount(widget("toy-steady-state-explorer"), view(0));
    act(() => w.rerender(null));
    expect(w.c.querySelector('[data-mode="explore"]')).not.toBeNull();
    expect(w.el("output")).not.toBeNull();
    expect(w.c.querySelectorAll(".w-param input:disabled")).toHaveLength(0);
    expect(w.c.querySelector(".w-chip")).toBeNull();
  });

  it("stacks into a compact layout", async () => {
    const w = await mount(widget("toy-steady-state-explorer"), null, { compact: true });
    expect(w.c.querySelector(".w-root.w-compact")).not.toBeNull();
    expect((w.c.querySelector(".w-plot") as HTMLElement).style.height).toBe("260px");
  });
});

describe("symbols explain themselves", () => {
  it("hovering a slider label shows its notation row", async () => {
    const w = await mount(widget("toy-steady-state-explorer"));
    const sym = w.c.querySelector('[data-param="s"] .w-sym-has-tip')!;
    expect(w.c.querySelector('[role="tooltip"]')).toBeNull();
    fireEvent.mouseEnter(sym);
    const tip = w.c.querySelector('[role="tooltip"]')!;
    expect(tip.textContent).toContain("Saving rate");
    expect(tip.textContent).toContain("Parameter in (0, 1)");
    expect(tip.textContent).toContain("typical 0.5");
    fireEvent.mouseLeave(sym);
    expect(w.c.querySelector('[role="tooltip"]')).toBeNull();
    fireEvent.click(w.c.querySelector('[data-param="delta"] .w-sym-button')!);
    expect(w.c.querySelector('[role="tooltip"]')?.textContent).toContain("Depreciation rate");
  });

  it("readout symbols find their rows too", async () => {
    const w = await mount(widget("toy-steady-state-explorer"));
    fireEvent.mouseEnter(w.c.querySelector('[data-readout="kbar_out"] .w-sym-has-tip')!);
    expect(w.c.querySelector('[role="tooltip"]')?.textContent).toContain("Steady-state capital and consumption");
  });
});

describe("goals", () => {
  it("fire onGoalMet exactly once when slider moves satisfy the goal", async () => {
    const onGoalMet = vi.fn();
    const w = await mount(widget("toy-steady-state-explorer"), view(1), { onGoalMet });
    w.move("s", 0.3);
    expect(onGoalMet).not.toHaveBeenCalled();
    expect(w.c.querySelector(".w-success")).toBeNull();
    w.move("s", 0.5);
    expect(onGoalMet).toHaveBeenCalledTimes(1);
    expect(w.c.querySelector(".w-success")?.textContent).toContain("That's the golden rule");
    expect(w.c.querySelector(".w-success .katex")).not.toBeNull();
    w.move("s", 0.505);
    w.move("s", 0.2);
    w.move("s", 0.5);
    expect(onGoalMet).toHaveBeenCalledTimes(1);
  });

  it("count once per view: a new view can be met again", async () => {
    const onGoalMet = vi.fn();
    const w = await mount(widget("toy-steady-state-explorer"), view(1), { onGoalMet });
    w.move("s", 0.3);
    w.move("s", 0.5);
    expect(onGoalMet).toHaveBeenCalledTimes(1);
    act(() => w.rerender(view(0), { onGoalMet }));
    act(() => w.rerender(view(1), { onGoalMet }));
    expect(w.c.querySelector(".w-success")).toBeNull();
    w.move("s", 0.3);
    w.move("s", 0.5);
    expect(onGoalMet).toHaveBeenCalledTimes(2);
  });

  it("need a learner move: presets that already satisfy the goal don't count", async () => {
    const onGoalMet = vi.fn();
    await mount(widget("toy-steady-state-explorer"), { ...view(1), state: { s: 0.5 } }, { onGoalMet });
    expect(onGoalMet).not.toHaveBeenCalled();
  });

  it("show the hint on request, or after a few unsuccessful tries", async () => {
    const w = await mount(widget("toy-steady-state-explorer"), view(1));
    expect(w.c.querySelector(".w-hint")).toBeNull();
    w.button(/Hint/)!.focus();
    fireEvent.click(w.button(/Hint/)!);
    expect(w.c.querySelector(".w-hint")?.textContent).toContain("Watch the consumption readout");
    // The button is gone; focus went to the hint it showed rather than falling to the page.
    expect(w.button(/Hint/)).toBeUndefined();
    expect(document.activeElement).toBe(w.c.querySelector(".w-hint"));

    let now = 1_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 1000));
    const v = await mount(widget("toy-steady-state-explorer"), view(1));
    v.move("s", 0.2);
    v.move("s", 0.3);
    expect(v.c.querySelector(".w-hint")).toBeNull();
    v.slider("s").focus();
    v.move("s", 0.35);
    expect(v.c.querySelector(".w-hint")).not.toBeNull();
    // A hint that shows by itself leaves focus on the slider the learner is using.
    expect(document.activeElement).toBe(v.slider("s"));
    clock.mockRestore();
  });

  it("Reset is not a move: back at presets where the goal holds, nothing is met until the learner moves again", async () => {
    const onGoalMet = vi.fn();
    const w = await mount(widget("toy-steady-state-explorer"), { ...view(1), state: { s: 0.5 } }, { onGoalMet });
    w.move("s", 0.3);
    fireEvent.click(w.button(/Reset/)!);
    expect(w.slider("s").value).toBe("0.5");
    expect(onGoalMet).not.toHaveBeenCalled();
    w.move("s", 0.505);
    expect(onGoalMet).toHaveBeenCalledTimes(1);
  });
});

describe("predictions", () => {
  it("hide the listed elements, then reveal them after the learner commits a choice", async () => {
    const onPredict = vi.fn();
    const w = await mount(widget("toy-convergence"), view(2), { onPredict });
    expect(w.el("capital")).toBeNull();
    expect(w.el("growth_y")).not.toBeNull();
    expect(w.c.querySelector(".w-predict-ask")?.textContent).toContain("Sketch the path of capital");
    const commit = w.button(/Commit prediction/)!;
    expect(commit.disabled).toBe(true);
    fireEvent.click(w.button(/Rises gradually/)!);
    expect(commit.disabled).toBe(false);
    fireEvent.click(commit);
    expect(onPredict).toHaveBeenCalledWith({ option: 1, correct: true });
    expect(w.el("capital")?.classList.contains("w-reveal")).toBe(true);
    expect(w.c.querySelector(".w-predict-result")?.textContent).toMatch(/^Right/);
    expect(w.button(/Commit prediction/)).toBeUndefined();
  });

  it("report a wrong choice with the right answer", async () => {
    const onPredict = vi.fn();
    const w = await mount(widget("toy-convergence"), view(2), { onPredict });
    fireEvent.click(w.button(/Jumps up at once/)!);
    fireEvent.click(w.button(/Commit prediction/)!);
    expect(onPredict).toHaveBeenCalledWith({ option: 0, correct: false });
    expect(w.c.querySelector(".w-predict-result")?.textContent).toContain("Rises gradually");
  });

  it("without options, the learner drags a marker on the plot and commits its value", async () => {
    const onPredict = vi.fn();
    const v: InteractiveBlock = { t: "interactive", widget: "toy-steady-state-explorer", predict: { hide: ["steady", "kbar_out"], ask: "Where is $\\bar{k}$?" } };
    const w = await mount(widget("toy-steady-state-explorer"), v, { onPredict });
    expect(w.el("steady")).toBeNull();
    expect(w.readout("kbar_out")).toBeNull();
    expect(w.button(/Commit prediction/)!.disabled).toBe(true);
    const marker = w.c.querySelector('[data-handle="predict-marker"]')!;
    expect(marker.getAttribute("role")).toBe("slider");
    fireEvent.keyDown(marker, { key: "ArrowRight", code: "ArrowRight" });
    fireEvent.keyUp(marker, { key: "ArrowRight", code: "ArrowRight" });
    expect(w.button(/Commit prediction/)!.disabled).toBe(false);
    fireEvent.click(w.button(/Commit prediction/)!);
    expect(onPredict).toHaveBeenCalledTimes(1);
    const value = onPredict.mock.calls[0]![0].value as number;
    expect(value).toBeGreaterThan(20);
    expect(value).toBeLessThan(40);
    expect(w.el("steady")?.classList.contains("w-reveal")).toBe(true);
    expect(w.readout("kbar_out")).toBe("25.00");
  });
});

describe("dragging", () => {
  const BUDGET = WidgetSpec.parse({
    type: "panels",
    vars: { c1: {} },
    params: { y1: { tex: "y_1", min: 0, max: 10, default: 4 }, y2: { tex: "y_2", min: 0, max: 10, default: 4 } },
    panels: [
      {
        kind: "curve",
        id: "budget_plot",
        x: { var: "c1", min: 0, max: 10 },
        y: { min: 0, max: 10 },
        curves: [{ id: "budget", expr: "y2 + 1.1*(y1 - c1)" }],
        points: [{ id: "endowment", x: "y1", y: "y2", drag: { x: "y1", y: "y2" } }],
      },
    ],
  });

  it("a draggable point moves the parameters it is bound to (keyboard steps)", async () => {
    const w = await mount(entryOf(BUDGET));
    const handle = w.c.querySelector('[data-handle="endowment"]')!;
    fireEvent.keyDown(handle, { key: "ArrowRight", code: "ArrowRight" });
    fireEvent.keyUp(handle, { key: "ArrowRight", code: "ArrowRight" });
    expect(Number(w.slider("y1").value)).toBeGreaterThan(4);
    expect(Number(w.slider("y2").value)).toBeCloseTo(4, 6);
  });

  it("a locked parameter makes its point static", async () => {
    const w = await mount(entryOf(BUDGET), { t: "interactive", widget: "test-widget", lock: ["y1", "y2"] });
    expect(w.c.querySelector('[data-handle="endowment"]')).toBeNull();
    expect(w.el("endowment")?.querySelector(".w-dot")).not.toBeNull();
  });

  it("a point at a derived coordinate maps a drag back onto its parameter", () => {
    const spec = widget("toy-steady-state-explorer").spec;
    const params = defaults(spec);
    const s = solveParam(spec, params, "s", "kbar", 16)!;
    expect(s).toBeCloseTo(0.4, 6);
    expect(withDerived(spec, { ...params, s }).kbar).toBeCloseTo(16, 6);
    expect(solveParam(spec, params, "s", "s", 2)).toBe(0.9);
  });
});

describe("scatter-fit", () => {
  const stats = fitStats(generate(FIT as never, defaults(FIT)), 0, 0);

  it("meets an SSR goal when the learner's line reaches least squares", async () => {
    const onGoalMet = vi.fn();
    const w = await mount(entryOf(FIT), fitView({ goal: { when: "ssr <= ssr_min * 1.01", success: "That is the least-squares line." } }), { onGoalMet });
    w.move("a", Number(stats.intercept_ols.toFixed(2)));
    expect(onGoalMet).not.toHaveBeenCalled();
    w.move("b", Number(stats.slope_ols.toFixed(2)));
    expect(onGoalMet).toHaveBeenCalledTimes(1);
  });

  it("Reveal OLS shows the OLS line and moves the learner's line onto it; focus goes to the SSR", async () => {
    const w = await mount(entryOf(FIT), fitView());
    w.move("a", 1);
    expect(w.el("ols")).toBeNull();
    w.button(/Reveal OLS/)!.focus();
    fireEvent.click(w.button(/Reveal OLS/)!);
    expect(w.el("ols")).not.toBeNull();
    expect(Number(w.slider("a").value)).toBeCloseTo(stats.intercept_ols, 6);
    expect(Number(w.slider("b").value)).toBeCloseTo(stats.slope_ols, 6);
    expect(w.button(/Reveal OLS/)).toBeUndefined();
    expect(w.c.querySelector(".w-readout-sub")?.textContent).toContain(format(undefined, stats.ssr_min));
    expect(document.activeElement).toBe(w.c.querySelector('[data-readout="ssr"]'));
  });

  it("with no SSR or R² on show, focus after Reveal goes to the widget", async () => {
    const w = await mount(entryOf(FIT), fitView({ show: ["points", "line"] }));
    fireEvent.click(w.button(/Reveal OLS/)!);
    expect(document.activeElement).toBe(w.c.querySelector(".w-root"));
  });

  it("in a view with a goal, Reveal OLS appears only once the learner has met it, so it can't hand the goal out", async () => {
    const onGoalMet = vi.fn();
    const w = await mount(entryOf(FIT), fitView({ goal: { when: "ssr <= ssr_min * 1.01", success: "ok" } }), { onGoalMet });
    w.move("a", 1);
    expect(w.button(/Reveal OLS/)).toBeUndefined();
    w.move("a", Number(stats.intercept_ols.toFixed(2)));
    w.move("b", Number(stats.slope_ols.toFixed(2)));
    expect(onGoalMet).toHaveBeenCalledTimes(1);
    fireEvent.click(w.button(/Reveal OLS/)!);
    expect(w.el("ols")).not.toBeNull();
    w.move("b", 0.5);
    w.move("b", Number(stats.slope_ols.toFixed(2)));
    expect(onGoalMet).toHaveBeenCalledTimes(1);
  });

  it("a revisited view whose goal was met offers Reveal straight away", async () => {
    const w = await mount(entryOf(FIT), fitView({ goal: { when: "ssr <= ssr_min * 1.01", success: "ok" } }), { initial: { goalMet: true } });
    expect(w.button(/Reveal OLS/)).toBeDefined();
  });

  it("the line's handles are sliders that report their parameter and its range", async () => {
    const w = await mount(entryOf(FIT));
    const a = w.c.querySelector('[data-handle="intercept"]')!;
    expect(a.getAttribute("role")).toBe("slider");
    expect([a.getAttribute("aria-valuenow"), a.getAttribute("aria-valuemin"), a.getAttribute("aria-valuemax")]).toEqual(["0", "-5", "5"]);
    const b = w.c.querySelector('[data-handle="slope"]')!;
    expect([b.getAttribute("aria-valuenow"), b.getAttribute("aria-valuemin"), b.getAttribute("aria-valuemax")]).toEqual(["0.5", "-2", "4"]);
    w.move("b", 1.25);
    expect(b.getAttribute("aria-valuenow")).toBe("1.25");
  });

  it("toggles residual squares, and `show` / `lock` apply to the built-in elements", async () => {
    const w = await mount(entryOf(FIT));
    expect(w.el("squares")).toBeNull();
    fireEvent.click(w.button(/Squares/)!);
    expect(w.el("squares")).not.toBeNull();
    act(() => w.rerender(fitView({ show: ["points", "line", "ssr"], lock: ["b"], highlight: "line" })));
    expect(w.el("residuals")).toBeNull();
    expect(w.readout("r2")).toBeNull();
    expect(w.readout("ssr")).not.toBeNull();
    expect(w.c.querySelector('[data-handle="slope"]')).toBeNull();
    expect(w.c.querySelector('[data-handle="intercept"]')).not.toBeNull();
    expect(w.el("line")?.querySelector(".w-halo")).not.toBeNull();
  });

  it("predict without options commits the learner's slope", async () => {
    const onPredict = vi.fn();
    const w = await mount(entryOf(FIT), fitView({ predict: { hide: ["ols", "ssr", "r2"], ask: "Fit the line by eye." } }), { onPredict });
    expect(w.readout("ssr")).toBeNull();
    expect(w.button(/Reveal OLS/)).toBeUndefined();
    expect(w.button(/Commit prediction/)!.disabled).toBe(true);
    w.move("b", 1.8);
    fireEvent.click(w.button(/Commit prediction/)!);
    expect(onPredict).toHaveBeenCalledWith({ value: 1.8 });
    expect(w.readout("ssr")).not.toBeNull();
  });
});

describe("broken specs", () => {
  it("a spec that fails the schema shows a readable error card", async () => {
    const entry = { ...widget("toy-steady-state-explorer"), spec: { type: "panels", vars: { k: {} }, panels: [{ kind: "curve", id: "d", x: { var: "k", min: 0, max: 1 }, y: { min: 0, max: 1 } }] } } as unknown as WidgetEntry;
    const w = await mount(entry);
    expect(w.c.querySelector('[role="alert"]')?.textContent).toContain("couldn't be drawn");
    expect(w.c.textContent).toMatch(/curves/);
  });

  it("an expression error names the expression", async () => {
    const base = widget("toy-steady-state-explorer").spec as Extract<WidgetSpec, { type: "panels" }>;
    const panel = base.panels[0] as Extract<Panel, { kind: "curve" }>;
    const spec = { ...base, panels: [{ ...panel, curves: [{ id: "output", expr: "A*q" }] }] };
    const w = await mount({ ...widget("toy-steady-state-explorer"), spec } as WidgetEntry);
    expect(w.c.textContent).toContain("panels[0].curves.output: unknown name 'q'");
  });

  it("an exception while rendering is caught by the boundary", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const Boom = () => {
      throw new Error("kaboom");
    };
    const { container } = render(
      <WidgetErrorBoundary entry={widget("toy-convergence")}>
        <Boom />
      </WidgetErrorBoundary>,
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("kaboom");
    expect(container.textContent).toContain("Interactives/Toy Convergence.md");
    quiet.mockRestore();
  });
});

describe("gallery", () => {
  it("lists every widget with the views that place it", async () => {
    const { notes, index } = fixture();
    expect(collectViews(notes["toy-101-l1-growth"]!, "Toy 101 L1").map((v) => v.block.widget)).toEqual([
      "toy-steady-state-explorer", "toy-steady-state-explorer", "toy-convergence", "toy-saving-chart", "toy-steady-state-explorer", "toy-golden-rule",
    ]);
    const { container } = render(<Gallery index={index} loadNote={async (slug) => notes[slug]!} />);
    const item = () => container.querySelector('[data-gallery="toy-steady-state-explorer"]')!;
    await waitFor(() => expect(item().querySelectorAll("option")).toHaveLength(5));
    expect(container.querySelectorAll("[data-gallery]")).toHaveLength(Object.keys(index.widgets).length);
    await waitFor(() => expect(item().querySelector('[data-param="s"] input')).not.toBeNull());
    const select = item().querySelector("select")!;
    const option = [...select.querySelectorAll("option")].find((o) => o.textContent?.includes("lock A,alpha)") && !o.textContent.includes("goal"))!;
    fireEvent.change(select, { target: { value: option.value } });
    expect(item().querySelector<HTMLInputElement>('[data-param="s"] input')!.value).toBe("0.4");
  });
});

describe("assistive tech", () => {
  it("a plot is a named figure, not an img, so the sliders on it stay reachable; its tick labels are hidden", async () => {
    const w = await mount(entryOf(FIT));
    const plot = w.c.querySelector(".w-plot")!;
    expect(plot.getAttribute("role")).toBe("figure");
    expect(plot.getAttribute("aria-label")).toBe("Fit a line: 30 points and a line to fit");
    expect(w.c.querySelector('[role="img"]')).toBeNull();
    expect(plot.querySelector('[role="slider"]')).not.toBeNull();
    expect(plot.querySelector(".w-axes")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("readout values are <output>s silenced on their own (an output is a live region whatever its parent says)", async () => {
    const w = await mount(widget("toy-steady-state-explorer"));
    const outputs = [...w.c.querySelectorAll(".w-readout output")];
    expect(outputs.length).toBeGreaterThan(0);
    for (const o of outputs) expect(o.getAttribute("aria-live")).toBe("off");
  });

  it("a draggable point reports the parameter it moves; a prediction marker its position on the x axis", async () => {
    const budget = WidgetSpec.parse({
      type: "panels",
      vars: { c1: {} },
      params: { y1: { tex: "y_1", min: 0, max: 8, default: 4 }, y2: { tex: "y_2", min: 0, max: 10, default: 4 } },
      panels: [
        {
          kind: "curve",
          id: "budget_plot",
          x: { var: "c1", min: 0, max: 10 },
          y: { min: 0, max: 10 },
          curves: [{ id: "budget", expr: "y2 + 1.1*(y1 - c1)" }],
          points: [{ id: "endowment", x: "y1", y: "y2", drag: { x: "y1", y: "y2" } }],
        },
      ],
    });
    const w = await mount(entryOf(budget));
    const h = w.c.querySelector('[data-handle="endowment"]')!;
    expect([h.getAttribute("aria-valuenow"), h.getAttribute("aria-valuemin"), h.getAttribute("aria-valuemax")]).toEqual(["4", "0", "8"]);
    const v: InteractiveBlock = { t: "interactive", widget: "toy-steady-state-explorer", predict: { hide: ["steady"], ask: "Where?" } };
    const p = await mount(widget("toy-steady-state-explorer"), v);
    const m = p.c.querySelector('[data-handle="predict-marker"]')!;
    const xs = (widget("toy-steady-state-explorer").spec as Extract<WidgetSpec, { type: "panels" }>).panels[0] as Extract<Panel, { kind: "curve" }>;
    expect([m.getAttribute("aria-valuemin"), m.getAttribute("aria-valuemax")]).toEqual([String(xs.x.min), String(xs.x.max)]);
  });
});
