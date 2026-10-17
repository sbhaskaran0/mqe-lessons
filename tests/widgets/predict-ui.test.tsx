// @vitest-environment happy-dom
// The prediction panel: the explain step (per-option feedback, then `why`), the optional "Why do you think so?" reason,
// and compute-before-reveal (a number graded against a named readout within `tol`).
import "./setup";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WidgetEntry } from "../../src/ir";
import { grade } from "../../src/widgets/core/useWidgetRuntime";
import type { InteractiveBlock, WidgetProps } from "../../src/widgets/host";
import { WidgetHost } from "../../src/widgets/WidgetHost";
import { fixture, widget } from "./setup";

type Props = Partial<Omit<WidgetProps, "entry" | "view">>;

async function mount(entry: WidgetEntry, view: InteractiveBlock, props: Props = {}) {
  const r = render(<WidgetHost entry={entry} view={view} datasets={fixture().index.datasets} contentBase="" {...props} />);
  await waitFor(() => expect(r.container.querySelector(".w-root:not(.w-skeleton)")).not.toBeNull());
  const c = r.container;
  return {
    c,
    el: (id: string) => c.querySelector(`[data-el="${id}"]`),
    readout: (id: string) => c.querySelector(`[data-readout="${id}"] output`)?.textContent ?? null,
    button: (text: RegExp) => [...c.querySelectorAll("button")].find((b) => text.test(b.textContent ?? "")),
    result: () => c.querySelector(".w-predict-result"),
    number: () => c.querySelector<HTMLInputElement>(".w-predict-number input"),
    reason: () => c.querySelector<HTMLInputElement>(".w-predict-reason input"),
  };
}

const withPredict = (widgetSlug: string, predict: InteractiveBlock["predict"]): InteractiveBlock => ({ t: "interactive", widget: widgetSlug, predict });
const STEADY = "toy-steady-state-explorer";

describe("explain step", () => {
  const options = ["To the right", "To the left", "It stays put"];
  const predict = {
    hide: ["steady"],
    ask: "Saving rises. Where does the steady state go?",
    options,
    answer: 0,
    feedback: [null, "A higher $s$ lifts the saving curve, so the crossing moves right, not left.", null],
    why: "The saving curve shifts **up**, so it crosses at a larger $k$.",
  };

  it("a wrong choice shows its own feedback first, then why, both with maths", async () => {
    const w = await mount(widget(STEADY), withPredict(STEADY, predict));
    fireEvent.click(w.button(/To the left/)!);
    fireEvent.click(w.button(/Commit prediction/)!);
    const paragraphs = [...w.result()!.querySelectorAll("p")];
    expect(paragraphs.map((p) => p.className)).toEqual(["", "w-predict-feedback", "w-predict-why"]);
    expect(paragraphs[0]!.textContent).toMatch(/^Not quite/);
    expect(paragraphs[1]!.textContent).toContain("moves right, not left");
    expect(paragraphs[1]!.querySelector(".katex")).not.toBeNull();
    expect(paragraphs[2]!.querySelector("strong")?.textContent).toBe("up");
    expect(paragraphs[2]!.querySelector(".katex")).not.toBeNull();
  });

  it("a right choice shows why, and no feedback when the option has none", async () => {
    const w = await mount(widget(STEADY), withPredict(STEADY, predict));
    fireEvent.click(w.button(/To the right/)!);
    fireEvent.click(w.button(/Commit prediction/)!);
    expect(w.result()!.querySelector(".w-predict-feedback")).toBeNull();
    expect(w.result()!.querySelector(".w-predict-why")?.textContent).toContain("larger");
    expect(w.result()!.getAttribute("aria-live")).toBe("polite");
  });

  it("a prediction without why or feedback shows only the verdict", async () => {
    const w = await mount(widget(STEADY), withPredict(STEADY, { hide: ["steady"], ask: "Which way?", options, answer: 0 }));
    fireEvent.click(w.button(/To the left/)!);
    fireEvent.click(w.button(/Commit prediction/)!);
    expect(w.result()!.querySelectorAll("p")).toHaveLength(1);
  });

  it("a revisited step shows the explanation again without asking", async () => {
    const w = await mount(widget(STEADY), withPredict(STEADY, predict), { initial: { predicted: { option: 1, correct: false } } });
    expect(w.button(/Commit prediction/)).toBeUndefined();
    expect(w.c.querySelector(".w-predict-feedback")?.textContent).toContain("moves right");
    expect(w.c.querySelector(".w-predict-why")).not.toBeNull();
  });

  it("the optional reason goes out with the commit, trimmed; it never blocks and an empty one is left out", async () => {
    const onPredict = vi.fn();
    const w = await mount(widget(STEADY), withPredict(STEADY, predict), { onPredict });
    expect(w.reason()!.labels?.[0]?.textContent).toContain("Why do you think so?");
    fireEvent.click(w.button(/To the left/)!);
    fireEvent.change(w.reason()!, { target: { value: "  s is on the wrong side  " } });
    fireEvent.click(w.button(/Commit prediction/)!);
    expect(onPredict).toHaveBeenCalledWith({ option: 1, correct: false, explanation: "s is on the wrong side" });

    const again = vi.fn();
    const w2 = await mount(widget(STEADY), withPredict(STEADY, predict), { onPredict: again });
    fireEvent.click(w2.button(/It stays put/)!);
    fireEvent.change(w2.reason()!, { target: { value: "   " } });
    fireEvent.click(w2.button(/Commit prediction/)!);
    expect(again).toHaveBeenCalledWith({ option: 2, correct: false });
  });
});

describe("compute before reveal", () => {
  // kbar_out is 25.00 at this widget's defaults.
  const readoutPredict = { hide: ["steady"], ask: "Compute $\\bar{k}$ before you look.", readout: "kbar_out", tol: 0.5, why: "It is $(s/\\delta)^{1/(1-\\alpha)}$." };

  async function commitNumber(text: string, onPredict = vi.fn()) {
    const w = await mount(widget(STEADY), withPredict(STEADY, readoutPredict), { onPredict });
    fireEvent.change(w.number()!, { target: { value: text } });
    fireEvent.click(w.button(/Commit prediction/)!);
    return { w, onPredict };
  }

  it("asks for a number, with the readout and the marker hidden, and commit waits for a number", async () => {
    const w = await mount(widget(STEADY), withPredict(STEADY, readoutPredict));
    expect(w.number()).not.toBeNull();
    expect(w.number()!.labels?.length).toBeGreaterThan(0);
    expect(w.c.querySelector('[data-handle="predict-marker"]')).toBeNull();
    expect(w.readout("kbar_out")).toBeNull();
    expect(w.el("steady")).toBeNull();
    expect(w.button(/Commit prediction/)!.disabled).toBe(true);
    fireEvent.change(w.number()!, { target: { value: "24" } });
    expect(w.button(/Commit prediction/)!.disabled).toBe(false);
  });

  it("a number within tol is correct; the readout is then revealed with the model's value", async () => {
    const { w, onPredict } = await commitNumber("25.3");
    expect(onPredict).toHaveBeenCalledWith({ value: 25.3, expected: 25, correct: true });
    expect(w.readout("kbar_out")).toBe("25.00");
    expect(w.el("steady")?.classList.contains("w-reveal")).toBe(true);
    expect(w.result()!.querySelector("p")!.textContent).toBe("Right. You: 25.3 · model: 25. Here is what happens.");
    expect(w.result()!.querySelector(".w-predict-why .katex")).not.toBeNull();
    expect(w.number()).toBeNull();
  });

  it("a number outside tol is incorrect and still shows the model's value", async () => {
    const { w, onPredict } = await commitNumber("30");
    expect(onPredict).toHaveBeenCalledWith({ value: 30, expected: 25, correct: false });
    expect(w.result()!.querySelector("p")!.textContent).toMatch(/^Not quite\. You: 30 · model: 25\./);
    expect(w.readout("kbar_out")).toBe("25.00");
  });

  it("exactly tol away is correct", async () => {
    const { onPredict } = await commitNumber("24.5");
    expect(onPredict).toHaveBeenCalledWith(expect.objectContaining({ correct: true }));
  });

  it("grades against the params at commit time", async () => {
    const onPredict = vi.fn();
    const w = await mount(widget(STEADY), withPredict(STEADY, { ...readoutPredict, tol: 0.01 }), { onPredict });
    const saving = w.c.querySelector<HTMLInputElement>('[data-param="s"] input')!;
    fireEvent.change(saving, { target: { value: saving.max } });
    fireEvent.change(w.number()!, { target: { value: "25" } });
    fireEvent.click(w.button(/Commit prediction/)!);
    expect(onPredict.mock.calls[0]![0].correct).toBe(false);
    expect(onPredict.mock.calls[0]![0].expected).not.toBe(25);
  });

  it("a revisit starts revealed and does not ask again", async () => {
    const w = await mount(widget(STEADY), withPredict(STEADY, readoutPredict), { initial: { predicted: { value: 30, correct: false } } });
    expect(w.number()).toBeNull();
    expect(w.button(/Commit prediction/)).toBeUndefined();
    expect(w.readout("kbar_out")).toBe("25.00");
    expect(w.result()!.querySelector("p")!.textContent).toMatch(/^Not quite\. You: 30/);
  });

  it("a goal waits for the commit", async () => {
    const goal = { when: "kbar_out > 0", success: "Done." };
    const onGoalMet = vi.fn();
    const v: InteractiveBlock = { t: "interactive", widget: STEADY, goal, predict: readoutPredict };
    const w = await mount(widget(STEADY), v, { onGoalMet });
    const saving = w.c.querySelector<HTMLInputElement>('[data-param="s"] input')!;
    fireEvent.change(saving, { target: { value: String(Number(saving.max) / 2) } });
    expect(onGoalMet).not.toHaveBeenCalled();
  });
});

describe("grade", () => {
  it("is absolute, inclusive of tol, and false for non-finite numbers", () => {
    expect(grade(16.05, 16, 0.05)).toBe(true);
    expect(grade(16.06, 16, 0.05)).toBe(false);
    expect(grade(15.95, 16, 0.05)).toBe(true);
    expect(grade(16, 16, 0)).toBe(true);
    expect(grade(NaN, 16, 1)).toBe(false);
    expect(grade(1, Infinity, 1)).toBe(false);
  });
});
