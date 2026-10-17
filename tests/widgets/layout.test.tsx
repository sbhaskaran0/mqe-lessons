// @vitest-environment happy-dom
// Layout and revisit behaviour of the widget frame: free sliders first with locked parameters as chips, the compare
// button, plot heights sized to the room the pane has, a revisited step starting where progress left it (`initial`),
// and a prediction commit that never scrolls the page.
import "./setup";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WidgetEntry } from "../../src/ir";
import { collectViews } from "../../src/widgets/Gallery";
import type { InteractiveBlock, WidgetProps } from "../../src/widgets/host";
import { AXIS_ROOM, MAX_PLOT, MIN_PLOT, StageContext, useStageHeight } from "../../src/widgets/ui/stage";
import { WidgetHost } from "../../src/widgets/WidgetHost";
import { fixture, lectureViews, widget } from "./setup";

type Props = Partial<Omit<WidgetProps, "entry" | "view">>;

async function mount(entry: WidgetEntry, view: InteractiveBlock | null = null, props: Props = {}) {
  const ui = (v: InteractiveBlock | null, p: Props = props) => <WidgetHost entry={entry} view={v} datasets={fixture().index.datasets} contentBase="/content/" {...p} />;
  const r = render(ui(view));
  await waitFor(() => expect(r.container.querySelector(".w-root:not(.w-skeleton)")).not.toBeNull());
  const c = r.container;
  return {
    c,
    rerender: (v: InteractiveBlock | null, p?: Props) => r.rerender(ui(v, p)),
    slider: (id: string) => c.querySelector<HTMLInputElement>(`[data-param="${id}"] input`),
    move: (id: string, v: number) => fireEvent.change(c.querySelector<HTMLInputElement>(`[data-param="${id}"] input`)!, { target: { value: String(v) } }),
    button: (text: RegExp) => [...c.querySelectorAll<HTMLButtonElement>("button")].find((b) => text.test(b.textContent ?? "")),
  };
}

const view = (i: number) => lectureViews()[i] as InteractiveBlock;
const STEADY = () => widget("toy-steady-state-explorer");

describe("parameter panel", () => {
  it("lists the free sliders first, then the locked parameters as chips, after the plot and readouts", async () => {
    const w = await mount(STEADY(), view(0)); // locks A and alpha
    const root = w.c.querySelector(".w-root")!;
    const at = (sel: string) => [...root.querySelectorAll("*")].indexOf(root.querySelector(sel)!);
    expect(at(".w-stage")).toBeLessThan(at(".w-readouts"));
    expect(at(".w-readouts")).toBeLessThan(at(".w-params"));
    expect(at(".w-params")).toBeLessThan(at(".w-chips"));
    const sliders = [...w.c.querySelectorAll(".w-params [data-param]")].map((e) => e.getAttribute("data-param"));
    expect(sliders).toEqual(["s", "delta"]);
    const chips = [...w.c.querySelectorAll(".w-chips .w-chip")];
    expect(chips.map((e) => e.getAttribute("data-param"))).toEqual(["A", "alpha"]);
    for (const chip of chips) {
      expect(chip.querySelector("input")).toBeNull();
      expect(chip.querySelector(".katex")).not.toBeNull(); // the symbol, set with KaTeX
      expect(chip.querySelector(".w-lock")).not.toBeNull();
    }
    expect(chips[1]!.querySelector(".w-chip-value")!.textContent).toBe("0.50");
  });

  it("keeps the declared order within each group, whichever parameters a view locks", async () => {
    const locked = { ...view(0), lock: ["s"] } as InteractiveBlock;
    const w = await mount(STEADY(), locked);
    expect([...w.c.querySelectorAll(".w-params [data-param]")].map((e) => e.getAttribute("data-param"))).toEqual(["A", "alpha", "delta"]);
    expect([...w.c.querySelectorAll(".w-chip")].map((e) => e.getAttribute("data-param"))).toEqual(["s"]);
  });

  it("explore mode (no view) is all sliders and no chips", async () => {
    const w = await mount(STEADY());
    expect(w.c.querySelectorAll(".w-params input[type=range]")).toHaveLength(4);
    expect(w.c.querySelector(".w-chips")).toBeNull();
  });

  it("a view that locks every parameter has no slider group at all", async () => {
    const w = await mount(STEADY(), { ...view(0), lock: ["s", "A", "alpha", "delta"] } as InteractiveBlock);
    expect(w.c.querySelector(".w-params")).toBeNull();
    expect(w.c.querySelectorAll(".w-chip")).toHaveLength(4);
  });

  it("a chip carries the same hover notation as the slider it replaces", async () => {
    const w = await mount(STEADY(), view(0));
    const sym = w.c.querySelector('.w-chip[data-param="alpha"] .w-sym-has-tip')!;
    expect(sym).not.toBeNull();
    fireEvent.mouseEnter(sym);
    expect(w.c.querySelector('[role="tooltip"]')?.textContent).toMatch(/capital share/i);
    fireEvent.mouseLeave(sym);
    expect(w.c.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("a locked parameter turns back into a slider when the next view frees it", async () => {
    const w = await mount(STEADY(), view(0));
    expect(w.slider("A")).toBeNull();
    act(() => w.rerender(null));
    expect(w.slider("A")).not.toBeNull();
    expect(w.c.querySelector(".w-chip")).toBeNull();
  });
});

describe("compare button", () => {
  const withFigure = (e: WidgetEntry): WidgetEntry => ({ ...e, spec: { ...e.spec, compare_figure: "assets/fig.png" } });

  it("is a small button of the widget's own button family, with an icon, in the widget header", async () => {
    const w = await mount(withFigure(STEADY()));
    const b = w.button(/Compare with the lecture figure/)!;
    expect(b.classList.contains("w-btn")).toBe(true);
    expect(b.classList.contains("w-btn-sm")).toBe(true);
    expect(b.classList.contains("w-btn-quiet")).toBe(false);
    expect(b.querySelector("svg")).not.toBeNull();
    expect(b.closest(".w-head")).not.toBeNull();
    expect(b.closest(".w-root")).not.toBeNull(); // inside the widget, so it takes the widget's type, not the page's
    expect(b.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(b);
    expect(b.getAttribute("aria-pressed")).toBe("true");
    expect(w.c.querySelector(".w-compare-figure img")?.getAttribute("src")).toBe("/content/assets/fig.png");
  });

  it("takes no row of its own above the widget", async () => {
    const w = await mount(withFigure(STEADY()));
    expect(w.c.querySelector(".w-compare-bar")).toBeNull();
    expect(w.c.querySelector(".w-compare-body")!.firstElementChild!.classList.contains("w-compare-widget")).toBe(true);
  });

  it("sits beside the reset tool in the header on a compact layout too", async () => {
    const w = await mount(withFigure(STEADY()), null, { compact: true });
    const tools = w.button(/Compare/)!.parentElement!;
    expect(tools.classList.contains("w-toolbar")).toBe(true);
    expect(tools.textContent).toContain("Reset");
  });
});

describe("plot height", () => {
  type Share = Parameters<typeof useStageHeight>[1];
  function Probe({ share }: { share?: Share }) {
    return <output>{useStageHeight(340, share)}</output>;
  }
  const height = (budget: number | null, share?: Share) => {
    const { container, unmount } = render(
      <StageContext.Provider value={budget}>
        <Probe share={share} />
      </StageContext.Provider>,
    );
    const h = Number(container.querySelector("output")!.textContent);
    unmount();
    return h;
  };

  it("takes the widget's own height when nothing measured the room", () => {
    expect(height(null)).toBe(340);
    expect(height(null, { parts: 2, axes: 1, axis: false })).toBe(340);
  });

  it("follows the budget between a minimum and a maximum", () => {
    expect(height(300)).toBe(300);
    expect(height(900)).toBe(MAX_PLOT);
    expect(height(20)).toBe(MIN_PLOT);
  });

  it("splits the budget among stacked plots so the ones above the shared axis are shorter by its room", () => {
    const upper = height(500, { parts: 2, axes: 1, axis: false });
    const last = height(500, { parts: 2, axes: 1, axis: true });
    expect(last - upper).toBe(AXIS_ROOM);
    expect(upper + last).toBe(500);
    // Three stacked plots never shrink below a readable area; the pane scrolls (its controls stay docked) instead.
    expect(height(60, { parts: 3, axes: 1, axis: false })).toBeGreaterThanOrEqual(100);
  });

  it("keeps the widget's own heights when no scrolling pane surrounds it", async () => {
    const compact = await mount(STEADY(), null, { compact: true });
    expect((compact.c.querySelector(".w-plot") as HTMLElement).style.height).toBe("260px");
    const desktop = await mount(STEADY());
    expect((desktop.c.querySelector(".w-plot") as HTMLElement).style.height).toBe("340px");
  });
});

describe("initial (a revisited step)", () => {
  it("shows the success state of a goal already met, without calling onGoalMet", async () => {
    const onGoalMet = vi.fn();
    const w = await mount(STEADY(), view(1), { onGoalMet, initial: { goalMet: true } });
    expect(w.c.querySelector('[data-goal="met"]')?.textContent).toContain("golden rule");
    w.move("s", 0.3);
    w.move("s", 0.5);
    w.move("s", 0.2);
    w.move("s", 0.5);
    expect(onGoalMet).not.toHaveBeenCalled();
    expect(w.c.querySelector('[data-goal="met"]')).not.toBeNull();
  });

  it("without `initial`, the same view still asks for the goal and fires once", async () => {
    const onGoalMet = vi.fn();
    const w = await mount(STEADY(), view(1), { onGoalMet });
    expect(w.c.querySelector('[data-goal="met"]')).toBeNull();
    w.move("s", 0.3);
    w.move("s", 0.5);
    expect(onGoalMet).toHaveBeenCalledTimes(1);
  });

  it("is read when a view arrives, not mid-view", async () => {
    const onGoalMet = vi.fn();
    const w = await mount(STEADY(), view(1), { onGoalMet });
    // The player re-renders with the progress it just recorded; the live view must not flip on its own account.
    act(() => w.rerender(view(1), { onGoalMet, initial: { goalMet: true } }));
    expect(w.c.querySelector('[data-goal="met"]')).toBeNull();
    // The next arrival of that view reads it.
    act(() => w.rerender(view(0), { onGoalMet }));
    act(() => w.rerender(view(1), { onGoalMet, initial: { goalMet: true } }));
    expect(w.c.querySelector('[data-goal="met"]')).not.toBeNull();
    expect(onGoalMet).not.toHaveBeenCalled();
  });

  it("starts a prediction committed and revealed, showing the recorded choice, without calling onPredict", async () => {
    const onPredict = vi.fn();
    const w = await mount(widget("toy-convergence"), view(2), { onPredict, initial: { predicted: { option: 0, correct: false } } });
    expect(w.c.querySelector(".w-predict")?.getAttribute("data-phase")).toBe("revealed");
    expect(w.button(/Commit prediction/)).toBeUndefined();
    const radios = [...w.c.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios.map((r) => r.getAttribute("aria-checked"))[0]).toBe("true");
    expect(radios.slice(1).every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
    expect(w.c.querySelector(".w-option-wrong")?.textContent).toContain("Jumps up at once");
    expect(w.c.querySelector(".w-option-right")?.textContent).toContain("Rises gradually");
    expect(w.c.querySelector(".w-predict-result")?.textContent).toContain("Not quite");
    expect(w.c.querySelector('[data-el="capital"]')).not.toBeNull(); // the hidden series is shown
    expect(radios.every((r) => r.disabled)).toBe(true);
    expect(onPredict).not.toHaveBeenCalled();
  });

  it("judges a recorded choice against the spec's answer, not the stored flag", async () => {
    const w = await mount(widget("toy-convergence"), view(2), { initial: { predicted: { option: 1 } } });
    expect(w.c.querySelector(".w-predict-result")?.textContent).toMatch(/^Right/);
  });

  it("shows a recorded numeric guess in words", async () => {
    const v: InteractiveBlock = { t: "interactive", widget: "toy-steady-state-explorer", predict: { hide: ["steady", "kbar_out"], ask: "Where is $\\bar{k}$?" } };
    const onPredict = vi.fn();
    const w = await mount(STEADY(), v, { onPredict, initial: { predicted: { value: 30 } } });
    expect(w.c.querySelector(".w-predict-result")?.textContent).toContain("Your guess");
    expect(w.c.querySelector(".w-predict-result")?.textContent).toContain("30");
    expect(w.c.querySelector('[data-readout="kbar_out"]')).not.toBeNull();
    expect(onPredict).not.toHaveBeenCalled();
  });

  it("ignores a recorded guess for a view that asks nothing", async () => {
    const w = await mount(STEADY(), view(0), { initial: { predicted: { option: 0 } } });
    expect(w.c.querySelector(".w-predict")).toBeNull();
  });
});

describe("committing a prediction", () => {
  it("never scrolls anything into view, and focuses the result without scrolling", async () => {
    const scroll = vi.fn();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = scroll;
    const w = await mount(widget("toy-convergence"), view(2));
    fireEvent.click(w.button(/Rises gradually/)!);
    fireEvent.click(w.button(/Commit prediction/)!);
    await waitFor(() => expect(w.c.querySelector(".w-predict-result")).not.toBeNull());
    expect(scroll).not.toHaveBeenCalled();
    const result = w.c.querySelector(".w-predict-result") as HTMLElement;
    expect(document.activeElement).toBe(result);
    const ours = focus.mock.calls.filter((_, i) => focus.mock.contexts[i] === result);
    expect(ours.length).toBeGreaterThan(0);
    for (const args of ours) expect(args[0]).toEqual({ preventScroll: true });
    focus.mockRestore();
  });
});

describe("gallery labels", () => {
  it("an interactive note's own view is labelled with the note alone, and no label ends in a separator", () => {
    const body = {
      slug: "w",
      sections: [{ id: "widget", heading: "", role: "other", steps: [{ id: "widget-1", blocks: [{ t: "interactive", widget: "x" }] }] }],
    } as unknown as Parameters<typeof collectViews>[0];
    expect(collectViews(body, "OLS Line Fitter").map((v) => v.label)).toEqual(["OLS Line Fitter"]);
    const headed = { ...body, sections: [{ ...body.sections[0]!, heading: "Fit" }] } as typeof body;
    expect(collectViews(headed, "OLS Line Fitter").map((v) => v.label)).toEqual(["OLS Line Fitter · Fit"]);
    const { notes } = fixture();
    const labels = Object.values(notes).flatMap((n) => collectViews(n, n.slug).map((v) => v.label));
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l).not.toMatch(/·\s*$/);
  });
});
