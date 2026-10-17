// @vitest-environment happy-dom
// `aspect: equal`: equal units on both axes with the authored ranges kept, by shaping and centring the plot box
// (vector and contour diagrams), unlike `square`, which widens the shorter range to fill the room.
import "./setup";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WidgetEntry } from "../../src/ir";
import { checkWidget, type PanelsSpec } from "../../src/widgets/expr";
import { PlotFrame } from "../../src/widgets/plot/PlotFrame";
import { WidgetSpec } from "../../src/widgets/spec";
import { WidgetHost } from "../../src/widgets/WidgetHost";

/** The clip rectangle is the plot box (plus 2px each side) in SVG user units. */
const box = (root: Element) => {
  const r = root.querySelector("clipPath rect")!;
  return { w: Number(r.getAttribute("width")) - 4, h: Number(r.getAttribute("height")) - 4 };
};

describe("PlotFrame equal", () => {
  it("keeps the ranges and gives the plot box their shape, centred in the width", async () => {
    const r = render(<PlotFrame x={[-2, 2]} y={[-2, 2]} height={300} equal ariaLabel="eq"><g /></PlotFrame>);
    await waitFor(() => expect(r.container.querySelector("clipPath rect")).not.toBeNull());
    const { w, h } = box(r.container);
    expect(w).toBeCloseTo(h, 6);
    const frame = r.container.querySelector<HTMLElement>(".w-plot-box")!;
    expect(parseFloat(frame.style.marginLeft)).toBeGreaterThan(100); // 600px wide room, a ~250px drawing
    expect(r.container.querySelector(".w-axes text")!.textContent).toBe("−2"); // ticks still span the authored range
  });

  it("a 2:1 range gets a 2:1 box; without `equal` the box fills the room as before", async () => {
    const r = render(<PlotFrame x={[0, 4]} y={[0, 2]} height={300} equal ariaLabel="eq"><g /></PlotFrame>);
    await waitFor(() => expect(r.container.querySelector("clipPath rect")).not.toBeNull());
    const { w, h } = box(r.container);
    expect(w / h).toBeCloseTo(2, 6);
    const plain = render(<PlotFrame x={[-2, 2]} y={[-2, 2]} height={300} ariaLabel="plain"><g /></PlotFrame>);
    await waitFor(() => expect(plain.container.querySelector("clipPath rect")).not.toBeNull());
    expect(box(plain.container).w).toBeGreaterThan(box(plain.container).h * 1.5);
    expect(plain.container.querySelector<HTMLElement>(".w-plot-box")!.style.marginLeft).toBe("");
  });
});

describe("aspect on panels", () => {
  it("contour and vector panels take aspect: equal and draw a square box for square ranges", async () => {
    const spec = WidgetSpec.parse({
      type: "panels",
      params: { a: { tex: "a", min: 0.5, max: 2, default: 1 } },
      vars: { x1: {}, x2: {} },
      panels: [
        { kind: "contour", id: "quad", aspect: "equal", x: { var: "x1", min: -2, max: 2 }, y: { var: "x2", min: -2, max: 2 }, f: "a*x1^2 + x2^2", levels: [1], grid: 20 },
        { kind: "vector", id: "eig", aspect: "equal", x: { min: -4, max: 4 }, y: { min: -4, max: 4 }, arrows: [{ id: "v", from: [0, 0], to: [1, 1] }] },
      ],
    }) as PanelsSpec;
    expect(checkWidget(spec)).toEqual({ errors: [], notes: [] });
    expect(WidgetSpec.safeParse({ ...spec, panels: [{ ...spec.panels[0], aspect: "wide" }] }).success).toBe(false);
    const entry: WidgetEntry = { slug: "t", name: "T", type: "panels", spec, illustrates: [], notation: [] };
    const r = render(<WidgetHost entry={entry} view={null} datasets={{}} contentBase="" />);
    await waitFor(() => expect(r.container.querySelector('[data-panel="eig"] clipPath rect')).not.toBeNull());
    for (const id of ["quad", "eig"]) {
      const { w, h } = box(r.container.querySelector(`[data-panel="${id}"]`)!);
      expect(w).toBeCloseTo(h, 6);
    }
  });
});
