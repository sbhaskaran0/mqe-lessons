// @vitest-environment happy-dom
// "Compare with the lecture figure": any widget type whose spec sets compare_figure gets the toggle, which puts the
// lecture image beside the live widget without remounting it.
import "./setup";
import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WidgetEntry } from "../../src/ir";
import { block, entryOf, mount, serveFixture } from "./data-helpers";
import { widget } from "./setup";

afterEach(() => vi.unstubAllGlobals());

const FIGURE = "assets/figures/premium.png";
const withFigure = (e: WidgetEntry, figure: string | null = FIGURE): WidgetEntry => ({ ...e, spec: { ...e.spec, compare_figure: figure ?? undefined } });
const props = { contentBase: "/content/" };

const FIT = entryOf({
  type: "scatter-fit",
  params: { a: { tex: "a", min: -5, max: 5, default: 0, step: 0.1 }, b: { tex: "b", min: -2, max: 4, default: 0.5, step: 0.1 } },
  generate: { n: 20, seed: 3, x: "uniform(0, 10)", y: "1 + 2*x + normal(0, 1)" },
  x: {},
  y: {},
  line: { intercept: "a", slope: "b" },
  compare_figure: FIGURE,
});
const DIST = entryOf({
  type: "distribution",
  params: { s: { tex: "\\sigma", min: 0.1, max: 1.6, default: 0.5, step: 0.05 } },
  family: "lognormal",
  dist: { sigma: "s" },
  measures: ["gini"],
  compare_figure: FIGURE,
});

// [the widget type, its entry, setup, a name when two cases share a type]
const cases: [string, () => WidgetEntry, () => void, string?][] = [
  ["panels", () => widget("toy-steady-state-explorer"), () => {}, "panels (a curve panel)"],
  ["panels", () => withFigure(widget("toy-convergence")), () => {}, "panels (path panels)"],
  ["scatter-fit", () => FIT, () => {}],
  ["distribution", () => DIST, () => {}],
  ["data-chart", () => withFigure(widget("toy-saving-chart")), () => serveFixture()],
];

describe("the compare toggle", () => {
  for (const [type, entry, setup, name] of cases) {
    it(`${name ?? type}: shows the lecture figure beside the live widget and hides it again`, async () => {
      setup();
      const e = entry();
      const w = await mount(e, null, props);
      await waitFor(() => expect(w.button(/compare with the lecture figure/i)).toBeDefined());
      // Looked up each time: a data widget shows the button on its loading card first, then on its own header.
      const toggle = () => w.button(/compare with the lecture figure/i)!;
      expect(toggle().getAttribute("aria-pressed")).toBe("false");
      expect(w.c.querySelector("img")).toBeNull();
      expect(w.c.querySelector('[data-compare="off"]')).not.toBeNull();

      fireEvent.click(toggle());
      const img = w.c.querySelector("img")!;
      expect(img.getAttribute("src")).toBe(`/content/${e.spec.compare_figure}`);
      expect(img.getAttribute("alt")).toMatch(/lecture figure/i);
      expect(toggle().getAttribute("aria-pressed")).toBe("true");
      expect(w.c.querySelector('[data-compare="on"]')).not.toBeNull();
      // the figure comes first, the widget stays
      const body = w.c.querySelector(".w-compare-body")!;
      expect(body.children[0]!.className).toContain("w-compare-figure");
      expect(body.children[1]!.querySelector(`[data-type="${type}"]`)).not.toBeNull();

      fireEvent.click(toggle());
      expect(w.c.querySelector("img")).toBeNull();
      expect(toggle().getAttribute("aria-pressed")).toBe("false");
    });
  }

  it("does not remount the widget: a slider keeps its value through the toggle", async () => {
    const w = await mount(DIST, null, props);
    await w.ready();
    w.move("s", 1.3);
    expect(w.slider("s").value).toBe("1.3");
    fireEvent.click(w.button(/compare/i)!);
    expect(w.slider("s").value).toBe("1.3");
    expect(w.readout("gini")).not.toBeNull();
    fireEvent.click(w.button(/compare/i)!);
    expect(w.slider("s").value).toBe("1.3");
  });

  it("a widget with no compare_figure has no toggle", async () => {
    const w = await mount(withFigure(widget("toy-steady-state-explorer"), null), null, props);
    await w.ready();
    expect(w.button(/compare/i)).toBeUndefined();
    expect(w.c.querySelector(".w-compare")).toBeNull();
  });

  it("stacks on a compact layout", async () => {
    const w = await mount(DIST, null, { ...props, compact: true });
    await w.ready();
    expect(w.c.querySelector(".w-compare")!.className).toContain("w-compare-compact");
  });

  it("works with the view's state: presets still apply with the figure open", async () => {
    const w = await mount(DIST, null, props);
    await w.ready();
    fireEvent.click(w.button(/compare/i)!);
    w.rerender(block({ state: { s: 1 } }), props);
    await waitFor(() => expect(w.slider("s").value).toBe("1"));
    expect(w.c.querySelector("img")).not.toBeNull();
  });

  it("a figure that fails to load says so instead of showing a broken image", async () => {
    const w = await mount(DIST, null, props);
    await w.ready();
    fireEvent.click(w.button(/compare/i)!);
    fireEvent.error(w.c.querySelector("img")!);
    expect(w.c.textContent).toContain("lecture figure could not be loaded");
    expect(w.c.querySelector("img")).toBeNull();
  });

  it("is not offered on a widget that failed to validate", async () => {
    const bad = { ...DIST, spec: { ...DIST.spec, dist: { sigma: "nope" } } } as WidgetEntry;
    const w = await mount(bad, null, props);
    await waitFor(() => expect(w.c.querySelector(".w-notice-error")).not.toBeNull());
    expect(w.button(/compare/i)).toBeUndefined();
  });
});
