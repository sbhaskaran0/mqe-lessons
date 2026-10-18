// @vitest-environment happy-dom
// A precomputed data-chart drawn: the fixture's Toy Bandwidth Lookup (two panels, a labelled kernel, a dragged probe,
// a goal that reads at()). Moving a slider redraws the looked-up rows; the probe steps by the arrow keys; the panels
// obey `show`; and a 100k-row table redraws a slider move quickly.
import "./setup";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixture, widget } from "./setup";
import { block, entryOf, memoryDataset, mount, serve, serveFixture } from "./data-helpers";

afterEach(() => vi.unstubAllGlobals());

const GOAL = { when: 'kernel == 2 and abs(err - at("ise", at("h_opt", 0))) < 1e-9 and px == 2', success: "Smallest error", hint: "Switch the kernel" };
const START = { h: 0.5, kernel: 1, px: 1, py: 0.1 };
const pathOf = (c: HTMLElement, id: string) => c.querySelector(`[data-el="${id}"] path.w-curve`)?.getAttribute("d") ?? "";

describe("a precomputed chart", () => {
  it("draws both panels, a labelled kernel choice, bars, a rug and the probe", async () => {
    serveFixture();
    const w = await mount(widget("toy-bandwidth-lookup"), block({ state: START }));
    await w.ready();
    expect([...w.c.querySelectorAll("[data-panel]")].map((p) => p.getAttribute("data-panel"))).toEqual(["density", "error"]);
    expect(w.c.querySelectorAll('[data-el="hist"] rect')).toHaveLength(4);
    expect(w.c.querySelectorAll('[data-el="rug"] line')).toHaveLength(5);
    expect(w.c.querySelectorAll('[data-el="h_opt"] circle')).toHaveLength(1);
    expect(w.c.querySelector('[data-handle="probe"]')).not.toBeNull();
    const group = w.c.querySelector('[data-param="kernel"] [role="radiogroup"]')!;
    expect([...group.querySelectorAll('[role="radio"]')].map((r) => [r.textContent, r.getAttribute("aria-checked")])).toEqual([["Gaussian", "true"], ["Box", "false"]]);
    expect(w.c.querySelector('[data-param="kernel"] input')).toBeNull();
    expect(w.readout("ise_now")).toBe("0.050");
  });

  it("moving a slider or the kernel redraws the rows of the new position", async () => {
    serveFixture();
    const w = await mount(widget("toy-bandwidth-lookup"), block({ state: START }));
    await w.ready();
    const before = pathOf(w.c, "kde");
    w.move("h", 1);
    const atH1 = pathOf(w.c, "kde");
    expect(atH1).not.toBe(before);
    expect(atH1.split("L")).toHaveLength(5);
    expect(w.readout("ise_now")).toBe("0.030");
    const errBefore = pathOf(w.c, "ise");
    fireEvent.click(w.c.querySelector('[data-param="kernel"] [role="radio"][data-value="2"]')!);
    expect(pathOf(w.c, "kde")).not.toBe(atH1);
    expect(pathOf(w.c, "ise")).not.toBe(errBefore);
    expect(w.readout("ise_now")).toBe("0.020");
  });

  it("the kernel choice moves with the arrow keys, as a radio group does", async () => {
    serveFixture();
    const w = await mount(widget("toy-bandwidth-lookup"), block({ state: START }));
    await w.ready();
    const radios = () => [...w.c.querySelectorAll<HTMLButtonElement>('[data-param="kernel"] [role="radio"]')];
    expect(radios().map((r) => r.tabIndex)).toEqual([0, -1]);
    fireEvent.keyDown(radios()[0]!, { key: "ArrowRight" });
    expect(radios()[1]!.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(radios()[1]);
    fireEvent.keyDown(radios()[1]!, { key: "Home" });
    expect(radios()[0]!.getAttribute("aria-checked")).toBe("true");
  });

  it("the probe steps one slider position per arrow key, and a locked param holds", async () => {
    serveFixture();
    const w = await mount(widget("toy-bandwidth-lookup"), block({ state: START, lock: ["py"] }));
    await w.ready();
    const handle = () => w.c.querySelector('[data-handle="probe"]')!;
    expect(handle().getAttribute("aria-valuetext")).toBe("Probe x 1.0, Probe y 0.10");
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(handle().getAttribute("aria-valuetext")).toBe("Probe x 2.0, Probe y 0.10");
    fireEvent.keyDown(handle(), { key: "ArrowUp" });
    expect(handle().getAttribute("aria-valuetext")).toBe("Probe x 2.0, Probe y 0.10");
    fireEvent.keyDown(handle(), { key: "ArrowLeft", shiftKey: true });
    expect(handle().getAttribute("aria-valuetext")).toBe("Probe x 0.0, Probe y 0.10");
  });

  it("meets a goal that reads at() only after the learner's moves", async () => {
    serveFixture();
    const onGoalMet = vi.fn();
    const w = await mount(widget("toy-bandwidth-lookup"), block({ state: START, goal: GOAL }), { onGoalMet });
    await w.ready();
    fireEvent.click(w.c.querySelector('[data-param="kernel"] [role="radio"][data-value="2"]')!);
    w.move("h", 1);
    expect(onGoalMet).not.toHaveBeenCalled();
    fireEvent.keyDown(w.c.querySelector('[data-handle="probe"]')!, { key: "ArrowRight" });
    fireEvent.keyDown(w.c.querySelector('[data-handle="probe"]')!, { key: "ArrowRight" });
    await waitFor(() => expect(onGoalMet).toHaveBeenCalledTimes(1));
  });

  it("show names panels and series: a named series shows only itself, a named panel shows whole", async () => {
    serveFixture();
    const w = await mount(widget("toy-bandwidth-lookup"), block({ show: ["error"] }));
    await w.ready();
    expect([...w.c.querySelectorAll("[data-panel]")].map((p) => p.getAttribute("data-panel"))).toEqual(["error"]);
    w.rerender(block({ show: ["kde", "ise"] }));
    await waitFor(() => expect(w.c.querySelectorAll("[data-panel]")).toHaveLength(2));
    expect(w.el("kde")).not.toBeNull();
    expect(w.el("hist")).toBeNull();
    w.rerender(block({ predict: { ask: "Where is the error smallest?", hide: ["error"], options: ["Small h", "Large h"], answer: 0 } }));
    await waitFor(() => expect(w.c.querySelectorAll("[data-panel]")).toHaveLength(1));
  });

  it("the existing fixture chart still draws as one chart", async () => {
    serveFixture();
    const w = await mount(widget("toy-saving-chart"));
    await w.ready();
    expect(w.c.querySelectorAll(".w-chart-panels")).toHaveLength(0);
    expect(w.c.querySelectorAll(".w-plot")).toHaveLength(1);
    expect(fixture().index.widgets["toy-saving-chart"]!.spec.type).toBe("data-chart");
  });
});

describe("a 100k-row table", () => {
  it("redraws a slider move well under 50 ms", async () => {
    const rows = ["series,a,b,x,y"];
    for (let a = 0; a < 50; a++) for (let b = 0; b < 20; b++) for (let x = 0; x < 100; x++) rows.push(`f,${a},${b},${x},${(a + 1) * Math.sin(x / 10 + b)}`);
    const d = memoryDataset("big", rows.join("\n"));
    serve(d.files);
    const e = entryOf({
      type: "data-chart",
      dataset: "big",
      params: { a: { tex: "a", min: 0, max: 49, step: 1, default: 0 }, b: { tex: "b", min: 0, max: 19, step: 1, default: 0 } },
      x: { column: "x" },
      y: { column: "y" },
      series: [{ id: "f", where: { series: "f", a: { param: "a" }, b: { param: "b" } } }],
    });
    const w = await mount(e, null, {}, { big: d.meta });
    await w.ready();
    const times: number[] = [];
    for (let i = 1; i <= 20; i++) {
      const t = performance.now();
      act(() => w.move("a", i));
      times.push(performance.now() - t);
    }
    const median = [...times].sort((x, y) => x - y)[10]!;
    console.log(`100k rows rendered: slider move median ${median.toFixed(1)} ms, worst ${Math.max(...times).toFixed(1)} ms (happy-dom)`);
    expect(median).toBeLessThan(50);
  });
});
