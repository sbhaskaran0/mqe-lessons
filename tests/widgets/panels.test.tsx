// @vitest-environment happy-dom
// The panels runtime: rebinding, equations bound per place, sweeps, the show rule, marching squares, and the panel
// kinds new with B0 (a sweep's current-value mark, contour, vector) rendered from inline specs.
import "./setup";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WidgetEntry } from "../../src/ir";
import { checkWidget, curveAt, derivedOrder, type PanelsSpec, simulate, withDerived } from "../../src/widgets/expr";
import type { InteractiveBlock } from "../../src/widgets/host";
import { visibleElements } from "../../src/widgets/panels/show";
import { autoLevels, contourSegments, sampleGrid } from "../../src/widgets/plot/contour";
import { WidgetSpec } from "../../src/widgets/spec";
import { WidgetHost } from "../../src/widgets/WidgetHost";

const panels = (s: unknown) => WidgetSpec.parse({ type: "panels", ...(s as object) }) as PanelsSpec;
const entryOf = (spec: PanelsSpec): WidgetEntry => ({ slug: "test-widget", name: "Test Widget", type: "panels", spec, illustrates: [], notation: [] });

/** The basic Solow model as a view would see it: s and delta held fixed, s1/s2 and delta1/delta2 the shock. */
const SOLOW = {
  params: {
    k1: { tex: "k_1", min: 1, max: 120, default: 25 },
    s1: { tex: "s_1", min: 0.05, max: 0.9, default: 0.5 },
    s2: { tex: "s_2", min: 0.05, max: 0.9, default: 0.6 },
    tstar: { tex: "t^*", min: 1, max: 60, step: 1, default: 10 },
  },
  fixed: { s: 0.5, A: 1, alpha: 0.5, delta: 0.1 },
  vars: { k: {} },
  equations: { f: "A*k^alpha", next_k: "s*f + (1-delta)*k", c: "(1-s)*f" },
  derived: {
    kbar: "(s*A/delta)^(1/(1-alpha))",
    kbar1: { of: "kbar", with: { s: "s1" } },
    kbar2: { of: "kbar", with: { s: "s2" } },
  },
  recurrence: { var: "k", init: "k1", t0: 1, periods: 100, next: { of: "next_k", with: { s: "t < tstar ? s1 : s2" } } },
  panels: [
    { kind: "path", id: "levels", series: [{ id: "capital", expr: "k" }, { id: "target", expr: "t < tstar ? kbar1 : kbar2" }] },
    { kind: "path", id: "flows", series: [{ id: "output", expr: "f" }, { id: "consumption", expr: { of: "c", with: { s: "t < tstar ? s1 : s2" } } }] },
  ],
};

describe("rebinding", () => {
  it("evaluates a model quantity with params replaced, and re-derives what it reads", () => {
    const spec = panels(SOLOW);
    const v = withDerived(spec, { k1: 25, s1: 0.5, s2: 0.6, tstar: 10 });
    expect(v.kbar).toBeCloseTo(25, 12); // the model's own, at the fixed s = 0.5
    expect(v.kbar1).toBeCloseTo(25, 12);
    expect(v.kbar2).toBeCloseTo(36, 12);
    expect(checkWidget(spec)).toEqual({ errors: [], notes: [] });
  });

  it("switches regime inside a recurrence: k is flat until t*, consumption jumps at t*", () => {
    const sim = simulate(panels(SOLOW), { k1: 25, s1: 0.5, s2: 0.6, tstar: 10 });
    expect(sim.series.capital![9]).toBeCloseTo(25, 10); // t = 10, still the old capital
    expect(sim.series.capital![10]).toBeCloseTo(25.5, 10); // built with s2 from t* on
    expect(sim.series.consumption![8]).toBeCloseTo(2.5, 10);
    expect(sim.series.consumption![9]).toBeCloseTo(2.0, 10);
    expect(sim.series.capital![99]).toBeCloseTo(35.880873, 5);
  });

  it("a rebinding that reads itself, directly or through its target, is a cycle", () => {
    expect(derivedOrder({ a: { of: "b", with: { s: "a" } }, b: "s" }).cycle).toEqual(["a"]);
    expect(derivedOrder({ a: { of: "b", with: {} }, b: "a + 1" }).cycle.sort()).toEqual(["a", "b"]);
    expect(derivedOrder({ b: "s * 2", a: { of: "b", with: { s: "s1" } } }).order).toEqual(["b", "a"]);
  });

  it("names what it rebinds and what it targets", () => {
    const bad = panels({ ...SOLOW, derived: { ...SOLOW.derived, kbar1: { of: "kbarr", with: { q: "s1" } } } });
    expect(checkWidget(bad).errors).toEqual([
      "derived.kbar1: rebinding 'of: kbarr' must name a derived value",
      "derived.kbar1.with: 'q' is not a parameter of the model",
    ]);
  });
});

describe("scopes per place", () => {
  it("a curve over a variable reads equations of that variable only", () => {
    const spec = panels({
      params: { a: { tex: "a", min: 0, max: 2, default: 1 } },
      vars: { x: {}, y: {} },
      equations: { gx: "a*x", gy: "a*y" },
      panels: [{ kind: "curve", id: "p", x: { var: "x", min: 0, max: 1 }, y: {}, curves: [{ id: "c1", expr: "gx" }, { id: "c2", expr: "gy" }] }],
    });
    expect(checkWidget(spec, undefined, { tests: false }).errors).toEqual(["panels[0].curves.c2: unknown name 'gy'"]);
  });

  it("a path panel needs the recurrence, and a mark needs a sweep axis", () => {
    const spec = panels({
      params: { a: { tex: "a", min: 0, max: 2, default: 1 } },
      vars: { x: {} },
      panels: [
        { kind: "path", id: "t", series: [{ id: "s", expr: "a" }] },
        { kind: "curve", id: "p", x: { var: "x", min: 0, max: 1 }, y: {}, curves: [{ id: "c", expr: "a*x", mark: true }] },
      ],
    });
    expect(checkWidget(spec, undefined, { tests: false }).errors).toEqual([
      "panels[0]: a path panel needs the view's recurrence",
      "panels[1].curves.c.mark needs a sweep axis (x: {sweep: <param>})",
    ]);
  });
});

/** c-bar(s) = (1 - s) (s/δ)^(α/(1-α)): a hill with its top at s = α. */
const HILL = panels({
  params: { s: { tex: "s", min: 0.05, max: 0.95, step: 0.01, default: 0.3 }, alpha: { tex: "\\alpha", min: 0.2, max: 0.8, default: 0.5 } },
  fixed: { delta: 0.1 },
  derived: { kbar: "(s/delta)^(1/(1-alpha))", cbar: "(1-s)*kbar^alpha" },
  panels: [{ kind: "curve", id: "hill", x: { sweep: "s" }, y: { min: 0 }, curves: [{ id: "cbar_s", expr: "cbar", mark: true }] }],
  tests: [{ expect: { "cbar_s@0.5": 2.5, "cbar_s@0.3": 2.1 } }],
});

describe("a sweep axis", () => {
  it("re-derives the model at each x, so the curve is c-bar as s varies", () => {
    expect(checkWidget(HILL)).toEqual({ errors: [], notes: [] });
    const p = HILL.panels[0] as Extract<PanelsSpec["panels"][number], { kind: "curve" }>;
    const scope = withDerived(HILL, { s: 0.3, alpha: 0.5 });
    expect(curveAt(HILL, p, "cbar", { s: 0.3, alpha: 0.5 }, scope, 0.5)).toBeCloseTo(2.5, 12);
  });

  it("marks the current value with a handle that moves s along the curve", async () => {
    const r = render(<WidgetHost entry={entryOf(HILL)} view={null} datasets={{}} contentBase="" />);
    await waitFor(() => expect(r.container.querySelector('[data-handle="cbar_s-mark"]')).not.toBeNull());
    const handle = r.container.querySelector('[data-handle="cbar_s-mark"]')!;
    expect(handle.getAttribute("aria-valuenow")).toBe("0.3");
    fireEvent.keyDown(handle, { key: "ArrowRight", code: "ArrowRight" });
    fireEvent.keyUp(handle, { key: "ArrowRight", code: "ArrowRight" });
    expect(Number(r.container.querySelector<HTMLInputElement>('[data-param="s"] input')!.value)).toBeGreaterThan(0.3);
  });

  it("a locked s leaves a plain dot", async () => {
    const view: InteractiveBlock = { t: "interactive", widget: "test-widget", lock: ["s"] };
    const r = render(<WidgetHost entry={entryOf(HILL)} view={view} datasets={{}} contentBase="" />);
    await waitFor(() => expect(r.container.querySelector('[data-el="cbar_s-mark"] .w-dot')).not.toBeNull());
    expect(r.container.querySelector('[data-handle="cbar_s-mark"]')).toBeNull();
  });
});

describe("the show rule", () => {
  const two = panels({
    params: { a: { tex: "a", min: 0, max: 2, default: 1 } },
    vars: { x: {} },
    panels: [
      { kind: "curve", id: "left", x: { var: "x", min: 0, max: 1 }, y: {}, curves: [{ id: "l1", expr: "x" }, { id: "l2", expr: "a" }] },
      { kind: "curve", id: "right", x: { var: "x", min: 0, max: 1 }, y: {}, curves: [{ id: "r1", expr: "x" }] },
    ],
  });
  it("shows everything without a show list", () => {
    expect(visibleElements(two, undefined)).toEqual(["left", "l1", "l2", "right", "r1"]);
  });
  it("naming a mark shows only the named marks, and the panels that hold them", () => {
    expect(visibleElements(two, ["l2"])).toEqual(["left", "l2"]);
  });
  it("naming only panels shows them whole", () => {
    expect(visibleElements(two, ["right"])).toEqual(["right", "r1"]);
  });
  it("a named mark and a named panel: the panel shows, with only the named marks", () => {
    expect(visibleElements(two, ["right", "l1"])).toEqual(["left", "l1", "right"]);
  });
});

describe("marching squares", () => {
  it("traces a circle: every segment end lies on it", () => {
    const n = 40;
    const z = sampleGrid((x, y) => x * x + y * y, [-2, 2], [-2, 2], n);
    const segs = contourSegments(z, n, 1, [-2, 2], [-2, 2]);
    expect(segs.length).toBeGreaterThan(30);
    for (const [p, q] of segs) {
      expect(Math.hypot(p[0], p[1])).toBeCloseTo(1, 1);
      expect(Math.hypot(q[0], q[1])).toBeCloseTo(1, 1);
    }
  });

  it("splits a saddle cell by its centre, never crossing the diagonal it separates", () => {
    // corners (0,0) and (1,1) above the level, (1,0) and (0,1) below; the centre decides which pair joins
    const z = [1, 0, 0, 1];
    const low = contourSegments(z, 1, 0.6, [0, 1], [0, 1]); // centre 0.5 below: the high corners are cut off
    expect(low).toHaveLength(2);
    expect(low.every(([p, q]) => (p[0] + p[1] < 1) === (q[0] + q[1] < 1))).toBe(true);
    expect(contourSegments(z, 1, 0.4, [0, 1], [0, 1])).toHaveLength(2);
    expect(contourSegments([NaN, 0, 0, 1], 1, 0.5, [0, 1], [0, 1])).toEqual([]);
  });

  it("spreads automatic levels over the plotted values", () => {
    expect(autoLevels([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4)).toEqual([2, 4, 6, 8]);
    expect(autoLevels([NaN, NaN], 3)).toEqual([]);
  });
});

describe("contour and vector panels", () => {
  it("draw level sets of f over two variables, and arrows with heads", async () => {
    const spec = panels({
      params: { a: { tex: "a", min: 0.5, max: 2, default: 1 } },
      vars: { x1: {}, x2: {} },
      panels: [
        { kind: "contour", id: "quad", x: { var: "x1", min: -2, max: 2 }, y: { var: "x2", min: -2, max: 2 }, f: "a*x1^2 + x2^2", levels: [1, 2], grid: 30, arrows: [{ id: "v1", from: [0, 0], to: [1, 0], tex: "v_1" }] },
        { kind: "vector", id: "eig", x: { min: -2, max: 2 }, y: { min: -1, max: 1 }, square: true, arrows: [{ id: "v2", from: [0, 0], to: ["a", "a"] }] },
      ],
    });
    expect(checkWidget(spec)).toEqual({ errors: [], notes: [] });
    const r = render(<WidgetHost entry={entryOf(spec)} view={null} datasets={{}} contentBase="" />);
    await waitFor(() => expect(r.container.querySelector('[data-panel="quad"] [data-level="1"]')).not.toBeNull());
    expect(r.container.querySelector('[data-panel="quad"] [data-level="2"]')).not.toBeNull();
    expect(r.container.querySelector('[data-el="v1"] polygon.w-arrowhead')).not.toBeNull();
    expect(r.container.querySelector('[data-panel="eig"] [data-el="v2"] polygon')).not.toBeNull();
    expect(r.container.querySelector('[data-label="v1"] .katex')).not.toBeNull();
  });
});

describe("a model's own page (no panels)", () => {
  it("is its sliders and its derived values", async () => {
    const spec = panels({ params: { s: { tex: "s", min: 0, max: 1, default: 0.5 } }, derived: { twice: "2*s" }, panels: [] });
    const r = render(<WidgetHost entry={entryOf(spec)} view={null} datasets={{}} contentBase="" />);
    await waitFor(() => expect(r.container.querySelector('[data-readout="twice"] output')).not.toBeNull());
    expect(r.container.querySelector('[data-readout="twice"] output')!.textContent).toBe("1");
    expect(r.container.querySelector(".w-plot")).toBeNull();
    expect(r.container.querySelector('[data-param="s"] input')).not.toBeNull();
  });
});
