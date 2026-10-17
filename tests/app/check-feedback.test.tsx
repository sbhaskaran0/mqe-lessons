// @vitest-environment happy-dom
// B2: a multiple-choice option's own feedback appears under the option that was chosen, and a numeric answer near an
// anticipated wrong value shows that value's diagnosis instead of the generic "Not quite". The first answer is still final.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    { md: "It doubles", correct: false, feedback: "Doubling saving raises the **level** once; growth then returns to zero." },
    { md: "It is unchanged", correct: true },
    { md: "It falls to zero", correct: false, feedback: "Growth is already zero in the steady state." },
  ],
  why: "Capital per worker is constant in the steady state.",
};
const numeric: CheckBlock = {
  t: "check",
  kind: "numeric",
  prompt: "What is $\bar{k}$?",
  answer: 25,
  tol: 0.05,
  wrong: [{ answer: 5, tol: 0, md: "that is $sA/\delta$; square it" }],
  why: "$5^2 = 25$.",
};

const content = { md: createMarkdown({ noteHref: () => null, assetUrl: (s) => s }) } as unknown as Content;
const KEY = "t#s#0";
const mount = (b: CheckBlock) =>
  render(
    <ContentProvider value={content}>
      <Check block={b} storeKey={KEY} />
    </ContentProvider>,
  );
const answer = (opt: string) => {
  fireEvent.click(screen.getByLabelText(opt));
  fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
};
const submitNumber = (v: string) => {
  fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: v } });
  fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
};

beforeEach(() => progress.reset());
afterEach(cleanup);

describe("multiple-choice option feedback", () => {
  it("shows nothing before the check is answered", () => {
    mount(mcq);
    expect(document.querySelector(".mcq-feedback")).toBeNull();
  });

  it("shows the chosen wrong option's feedback, not the others', and links it to the option", () => {
    mount(mcq);
    answer("It doubles");
    const notes = document.querySelectorAll(".mcq-feedback");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.textContent).toContain("raises the level once");
    expect(notes[0]!.querySelector("strong")).toBeTruthy();
    expect(screen.getByLabelText("It doubles").getAttribute("aria-describedby")).toBe(notes[0]!.id);
    expect(screen.getByText("Not quite.")).toBeTruthy();
    expect(screen.getByText(/constant in the steady state/)).toBeTruthy();
  });

  it("shows no feedback for a chosen option that has none, and keeps the first answer final", () => {
    mount(mcq);
    answer("It is unchanged");
    expect(document.querySelector(".mcq-feedback")).toBeNull();
    expect(screen.getByText("Correct.")).toBeTruthy();
    expect((screen.getByLabelText("It doubles").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    expect(progress.get().checks[KEY]).toMatchObject({ result: "correct", answer: [1], tries: 1 });
  });

  it("reads the feedback back from the stored answer on a revisit", () => {
    progress.recordCheck(KEY, "incorrect", [2]);
    mount(mcq);
    expect(document.querySelector(".mcq-feedback")!.textContent).toContain("already zero");
  });
});

describe("numeric wrong-answer diagnosis", () => {
  it("shows the diagnosis for an anticipated wrong answer instead of the generic message", () => {
    mount(numeric);
    submitNumber("5");
    expect(screen.queryByText("Not quite.")).toBeNull();
    expect(document.querySelector(".check-diagnosis")!.textContent).toContain("that is");
    expect(screen.getByRole("status").textContent).toContain("square it");
    expect(screen.getByText(/The answer is 25/)).toBeTruthy();
    expect(progress.get().checks[KEY]).toMatchObject({ result: "incorrect", answer: 5 });
  });

  it("uses the wrong entry's tolerance", () => {
    mount({ ...numeric, wrong: [{ answer: 5, tol: 0.5, md: "close to five" }] } as CheckBlock);
    submitNumber("5.4");
    expect(screen.getByRole("status").textContent).toContain("close to five");
  });

  it("keeps 'Not quite.' for a wrong answer nobody anticipated, and 'Correct.' for the right one", () => {
    mount(numeric);
    submitNumber("7");
    expect(screen.getByText("Not quite.")).toBeTruthy();
    expect(document.querySelector(".check-diagnosis")).toBeNull();
    cleanup();
    progress.reset();
    mount(numeric);
    submitNumber("25");
    expect(screen.getByText("Correct.")).toBeTruthy();
  });

  it("a block without wrong entries behaves as before", () => {
    mount({ ...numeric, wrong: undefined } as unknown as CheckBlock);
    submitNumber("5");
    expect(screen.getByText("Not quite.")).toBeTruthy();
  });
});
