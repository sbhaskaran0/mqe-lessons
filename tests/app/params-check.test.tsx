// @vitest-environment happy-dom
// F2 in the player: a numeric check with `vary` shows the base variant on the first try, a new seeded variant on each
// retry, grades against the variant's answer, tolerance and formula wrong answers, and keeps the seed so a reload
// shows the numbers the learner answered.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMarkdown } from "../../src/content/markdown";
import { ContentProvider, type Content } from "../../src/content/context";
import type { Block, NumericCheck } from "../../src/ir";
import { Check, seedFrom } from "../../src/lesson/Check";
import { progress } from "../../src/progress";
import { instantiate } from "../../src/params";

const KBAR: NumericCheck = {
  t: "check",
  kind: "numeric",
  prompt: "With $s = 0.3$, $A = 1$, $\\alpha = 0.5$ and $\\delta = 0.1$, what is steady-state capital $\\bar{k}$?",
  answer: 9,
  tol: 0.09,
  vary: [{ sym: "s", lo: 0.2, hi: 0.4, step: 0.05 }, { sym: "\\delta", values: [0.05, 0.08, 0.1] }],
  compute: "\\left(\\frac{sA}{\\delta}\\right)^{\\frac{1}{1-\\alpha}}",
  bindings: [
    { sym: "s", value: 0.3, span: "$s = 0.3$" },
    { sym: "A", value: 1, span: "$A = 1$" },
    { sym: "\\alpha", value: 0.5, span: "$\\alpha = 0.5$" },
    { sym: "\\delta", value: 0.1, span: "$\\delta = 0.1$" },
  ],
  wrongCompute: [{ tex: "sA/\\delta", md: "that is the ratio before the power" }],
  why: "Square $sA/\\delta$: with $s = 0.3$ and $\\delta = 0.1$ that is 9.",
};
const block = KBAR as Block;
const plain: Block = { t: "check", kind: "numeric", prompt: "What is the value?", answer: 25, tol: 0.05, why: "Square five.", wrong: [{ answer: 10, tol: 0.05, md: "You doubled." }] };

const content = { md: createMarkdown({ noteHref: () => null, assetUrl: (s) => s }) } as unknown as Content;
const KEY = "t#s#0";
const mount = (b: Block, extra: Partial<Parameters<typeof Check>[0]> = {}) =>
  render(
    <ContentProvider value={content}>
      <Check block={b as Extract<Block, { t: "check" }>} storeKey={KEY} {...extra} />
    </ContentProvider>,
  );
const promptText = () => document.querySelector(".check-prompt")!.textContent!.trim();
const answerLine = () => document.querySelector(".check-answer")?.textContent;
const input = () => screen.getByLabelText("Your answer") as HTMLInputElement;
const type = (v: string) => fireEvent.change(input(), { target: { value: v } });
const button = () => screen.getByRole("button", { name: "Check answer" }) as HTMLButtonElement;
/** Types an answer and submits it, once the lazy `src/params` chunk has let the submit through. */
async function answer(v: string) {
  type(v);
  await waitFor(() => expect(button().disabled).toBe(false));
  fireEvent.click(button());
}
const tryAgain = () => fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
const retrySeed = (n: number) => seedFrom(`${KEY}#${n}`);
/** KaTeX renders `$s = 0.25$` as "s=0.25" plus its annotation, so compare with spaces removed. */
const hasNumbers = (v: ReturnType<typeof instantiate>) => {
  const t = promptText().replace(/\s+/g, "");
  expect(t).toContain(`s=${v.values.s}`);
  expect(t).toContain(`δ=${v.values["\\delta"]}`);
};

beforeEach(() => progress.reset());
afterEach(cleanup);

describe("a varied numeric check", () => {
  it("the retry seeds are stable, nonzero and differ from each other, and each draws a variant other than the base", () => {
    expect(seedFrom("a")).toBe(seedFrom("a"));
    expect(new Set([1, 2, 3, 4].map(retrySeed)).size).toBe(4);
    for (const n of [1, 2, 3, 4, 5]) {
      expect(retrySeed(n)).not.toBe(0);
      expect(instantiate(KBAR, retrySeed(n)).prompt).not.toBe(KBAR.prompt);
    }
  });

  it("the first try is the base variant: the written text, no computed-answer line, seed 0", async () => {
    mount(block);
    expect(promptText()).toContain("s = 0.3");
    await answer("9");
    expect(screen.getByText("Correct.")).toBeTruthy();
    expect(answerLine()).toBeUndefined();
    expect(promptText()).toContain("s = 0.3");
    expect(progress.get().checks[KEY]).toMatchObject({ result: "correct", answer: 9, seed: 0 });
  });

  it("a formula wrong answer on the base variant shows its diagnosis", async () => {
    mount(block);
    await answer("3");
    expect(screen.getByText(/that is the ratio before the power/)).toBeTruthy();
    expect(answerLine()).toContain("The answer is 9");
  });

  it("Try again draws a new variant: new numbers, graded against its answer, with the computed answer shown", async () => {
    mount(block);
    await answer("5");
    expect(screen.getByText("Not quite.")).toBeTruthy();
    tryAgain();

    const v = instantiate(KBAR, retrySeed(1));
    await waitFor(() => hasNumbers(v));
    await answer(String(v.answer + v.tol * 0.9));
    expect(screen.getByText("Correct.")).toBeTruthy();
    expect(answerLine()).toContain(`The answer is ${Number(v.answer.toPrecision(10))}`);
    expect(progress.get().checks[KEY]).toMatchObject({ result: "correct", firstTry: "incorrect", tries: 2, seed: retrySeed(1) });
  });

  it("grades a variant against its tolerance (just outside is wrong) and diagnoses its own formula slip", async () => {
    mount(block);
    await answer("5");
    tryAgain();
    const v = instantiate(KBAR, retrySeed(1));
    await waitFor(() => hasNumbers(v));
    await answer(String(v.answer + v.tol * 1.5));
    expect(screen.getByText("Not quite.")).toBeTruthy();
    tryAgain();
    const v2 = instantiate(KBAR, retrySeed(2));
    await waitFor(() => hasNumbers(v2));
    await answer(String(v2.wrong[0]!.answer));
    expect(screen.getByText(/that is the ratio before the power/)).toBeTruthy();
    expect(answerLine()).toContain("The answer is");
  });

  it("a reload shows the variant the learner answered, then the next retry moves on", async () => {
    mount(block);
    await answer("5");
    tryAgain();
    await waitFor(() => hasNumbers(instantiate(KBAR, retrySeed(1))));
    await answer("5");
    const shown = promptText();
    expect(progress.get().checks[KEY]).toMatchObject({ result: "incorrect", tries: 2, seed: retrySeed(1) });
    cleanup();

    mount(block);
    await waitFor(() => expect(promptText()).toBe(shown));
    expect(input().value).toBe("5");
    expect(answerLine()).toContain("The answer is");
    tryAgain();
    await waitFor(() => hasNumbers(instantiate(KBAR, retrySeed(2))));
  });
});

describe("a varied check in review", () => {
  it("draws from the caller's seed, a different variant per seed, grades it, and leaves the lesson's record alone", async () => {
    const onAnswer = vi.fn();
    mount(block, { onAnswer, seed: 1 });
    const v = instantiate(KBAR, seedFrom(`${KEY}@1`));
    await waitFor(() => hasNumbers(v));
    await answer(String(v.answer));
    expect(onAnswer).toHaveBeenCalledWith("correct", v.answer);
    expect(answerLine()).toContain("The answer is");
    expect(progress.get().checks[KEY]).toBeUndefined();
    cleanup();

    mount(block, { onAnswer, seed: 2 });
    const v2 = instantiate(KBAR, seedFrom(`${KEY}@2`));
    expect(v2.values).not.toEqual(v.values);
    await waitFor(() => hasNumbers(v2));
  });

  it("without a seed it draws from the day", async () => {
    mount(block, { onAnswer: vi.fn() });
    const day = new Date().toISOString().slice(0, 10);
    await waitFor(() => hasNumbers(instantiate(KBAR, seedFrom(`${KEY}@${day}`))));
  });
});

describe("a plain numeric check", () => {
  it("is unchanged: written text, its own wrong answers, no seed stored, no computed-answer line when right", async () => {
    mount(plain);
    expect(promptText()).toBe("What is the value?");
    await answer("10");
    expect(screen.getByText(/You doubled/)).toBeTruthy();
    expect(answerLine()).toContain("The answer is 25");
    expect(progress.get().checks[KEY]?.seed).toBeUndefined();
    tryAgain();
    expect(promptText()).toBe("What is the value?");
    await answer("25");
    expect(screen.getByText("Correct.")).toBeTruthy();
    expect(answerLine()).toBeUndefined();
    expect(progress.get().checks[KEY]?.seed).toBeUndefined();
  });
});
