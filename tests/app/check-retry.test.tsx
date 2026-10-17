// @vitest-environment happy-dom
// F1: a wrong answer can be tried again. The store keeps the first submitted result (`firstTry`) for statistics,
// counts every submit in `tries` and holds the latest as `result`; a correct answer is final. Review mode (`onAnswer`)
// starts unanswered, reports the answer and leaves the lesson's record alone.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMarkdown } from "../../src/content/markdown";
import { ContentProvider, type Content } from "../../src/content/context";
import type { Block } from "../../src/ir";
import { Check } from "../../src/lesson/Check";
import { progress } from "../../src/progress";

type CheckBlock = Extract<Block, { t: "check" }>;

const mcq: CheckBlock = {
  t: "check",
  kind: "mcq",
  prompt: "If the saving rate doubles, what happens to long-run growth?",
  options: [
    { md: "It doubles", correct: false },
    { md: "It is unchanged", correct: true },
    { md: "It falls to zero", correct: false },
  ],
  why: "Capital per worker is constant in the steady state.",
};
const numeric: CheckBlock = { t: "check", kind: "numeric", prompt: "What is the value?", answer: 25, tol: 0.05, why: "Square five." };

const content = { md: createMarkdown({ noteHref: () => null, assetUrl: (s) => s }) } as unknown as Content;
const KEY = "t#s#0";
const mount = (b: CheckBlock, onAnswer?: Parameters<typeof Check>[0]["onAnswer"]) =>
  render(
    <ContentProvider value={content}>
      <Check block={b} storeKey={KEY} {...(onAnswer ? { onAnswer } : {})} />
    </ContentProvider>,
  );
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
const pick = (opt: string) => fireEvent.click(screen.getByLabelText(opt));
const type = (v: string) => fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: v } });

beforeEach(() => progress.reset());
afterEach(cleanup);

describe("multiple choice", () => {
  it("offers Try again after a wrong answer; it clears the choice and hides the verdict and the why", () => {
    mount(mcq);
    pick("It doubles");
    submit();
    expect(screen.getByText("Not quite.")).toBeTruthy();
    expect(screen.getByText(/constant in the steady state/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));

    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.queryByText(/constant in the steady state/)).toBeNull();
    expect((screen.getByLabelText("It doubles") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("It doubles").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Check answer" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
    // Focus goes to the first input, since the button that had it is gone.
    expect(document.activeElement).toBe(screen.getByLabelText("It doubles"));
    // The lesson's record is still the wrong answer until the next submit, so the gate stays open.
    expect(progress.get().checks[KEY]).toMatchObject({ result: "incorrect", tries: 1 });
  });

  it("a right second answer becomes the result, keeps the first try, counts the tries and is final", () => {
    mount(mcq);
    pick("It doubles");
    submit();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    pick("It is unchanged");
    submit();
    expect(screen.getByText("Correct.")).toBeTruthy();
    expect(progress.get().checks[KEY]).toMatchObject({ result: "correct", firstTry: "incorrect", tries: 2, answer: [1] });
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
    expect((screen.getByLabelText("It doubles").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  });

  it("another wrong answer can be tried again too, and the verdict takes focus on each submit", () => {
    mount(mcq);
    pick("It doubles");
    submit();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    pick("It falls to zero");
    submit();
    expect(progress.get().checks[KEY]).toMatchObject({ result: "incorrect", firstTry: "incorrect", tries: 2, answer: [2] });
    expect(document.activeElement).toBe(screen.getByRole("status"));
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
  });

  it("a right first answer offers no retry", () => {
    mount(mcq);
    pick("It is unchanged");
    submit();
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
    expect(progress.get().checks[KEY]).toMatchObject({ result: "correct", firstTry: "correct", tries: 1 });
  });

  it("opening a check that was answered wrong earlier shows the answer, with Try again, and takes no focus", () => {
    progress.recordCheck(KEY, "incorrect", [0]);
    mount(mcq);
    expect(screen.getByText("Not quite.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("numeric", () => {
  it("clears the typed number on Try again and records the second attempt", () => {
    mount(numeric);
    type("24");
    submit();
    expect(screen.getByText("Not quite.")).toBeTruthy();
    expect(screen.getByText(/The answer is 25/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    const input = screen.getByLabelText("Your answer") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.readOnly).toBe(false);
    expect(screen.queryByText(/The answer is 25/)).toBeNull();
    expect(document.activeElement).toBe(input);
    type("25");
    submit();
    expect(screen.getByText("Correct.")).toBeTruthy();
    expect(progress.get().checks[KEY]).toMatchObject({ result: "correct", firstTry: "incorrect", tries: 2, answer: 25 });
  });
});

describe("as a scheduled review (onAnswer)", () => {
  it("starts unanswered even if the lesson recorded an answer, reports the answer, and leaves the record alone", () => {
    progress.recordCheck(KEY, "incorrect", [0]);
    const before = progress.get().checks[KEY];
    const onAnswer = vi.fn();
    mount(mcq, onAnswer);
    expect(screen.getByRole("status").textContent).toBe("");
    expect((screen.getByLabelText("It doubles") as HTMLInputElement).checked).toBe(false);
    pick("It is unchanged");
    act(() => submit());
    expect(onAnswer).toHaveBeenCalledWith("correct", [1]);
    expect(screen.getByText("Correct.")).toBeTruthy();
    expect(progress.get().checks[KEY]).toBe(before);
  });

  it("shows a wrong answer's explanation without offering a retry", () => {
    const onAnswer = vi.fn();
    mount(numeric, onAnswer);
    type("3");
    submit();
    expect(onAnswer).toHaveBeenCalledWith("incorrect", 3);
    expect(screen.getByText("Square five.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
    expect(progress.get().checks[KEY]).toBeUndefined();
  });
});
