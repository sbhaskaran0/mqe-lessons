// @vitest-environment happy-dom
// #/exam: set up, sit and read back a mixed exam. The answers are held back until the end, the timer submits by
// itself, a reload resumes the same questions (a varied one with the same numbers), exam answers leave the lesson's
// `checks` alone, and the results break down by objective.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContent, ContentProvider } from "../../src/content/context";
import { ExamPage } from "../../src/exam/ExamPage";
import type { Block, Index, NoteBody, NoteMeta } from "../../src/ir";
import { progress } from "../../src/progress";

const mcq = (prompt: string, correct: number, objectives?: number[]): Block => ({
  t: "check",
  kind: "mcq",
  prompt,
  options: [0, 1].map((i) => ({ md: `${prompt} option ${i}`, correct: i === correct, ...(i !== correct ? { feedback: `Feedback for ${prompt} option ${i}` } : {}) })),
  why: `Because of ${prompt}.`,
  ...(objectives ? { objectives } : {}),
});
const varied: Block = {
  t: "check",
  kind: "numeric",
  prompt: "With $s = 0.3$, $A = 1$, $\\alpha = 0.5$ and $\\delta = 0.1$, what is $\\bar{k}$?",
  answer: 9,
  tol: 0.09,
  why: "Square $sA/\\delta$.",
  objectives: [1],
  vary: [{ sym: "s", lo: 0.2, hi: 0.4, step: 0.05 }, { sym: "\\delta", values: [0.05, 0.08, 0.1] }],
  compute: "\\left(\\frac{sA}{\\delta}\\right)^{\\frac{1}{1-\\alpha}}",
  bindings: [
    { sym: "s", value: 0.3, span: "$s = 0.3$" },
    { sym: "A", value: 1, span: "$A = 1$" },
    { sym: "\\alpha", value: 0.5, span: "$\\alpha = 0.5$" },
    { sym: "\\delta", value: 0.1, span: "$\\delta = 0.1$" },
  ],
};
const note = (slug: string, blocks: Block[]) => ({ slug, notation: [], sections: [{ id: "s", heading: "Sec", steps: blocks.map((b, i) => ({ id: `s-${i + 1}`, heading: `Step ${i + 1}`, blocks: [b] })) }] }) as unknown as NoteBody;
const bodies: Record<string, NoteBody> = {
  l1: note("l1", [mcq("Alpha one", 0, [1]), mcq("Alpha two", 1)]),
  l2: note("l2", [mcq("Beta one", 0, [2]), varied]),
};
vi.mock("../../src/content/store", async (orig) => ({ ...(await orig<typeof import("../../src/content/store")>()), loadNote: (slug: string) => Promise.resolve(bodies[slug]) }));

const meta = (slug: string, title: string, extra: Partial<NoteMeta> = {}) =>
  ({ slug, name: slug, title, type: "lecture", path: `${slug}.md`, summary: "", tags: [], aliases: [], requires: [], lessons: [], courses: [], course: "Toy 101", edges: { out: [], in: [] }, figures: [], interactives: [], checks: 2, words: 0, created: "", updated: "", ...extra }) as unknown as NoteMeta;
const content = createContent({
  courses: [{ code: "Toy 101", id: "toy-101", hub: "toy-101", lectures: ["l1", "l2"], practice: [], guides: [] }],
  notes: {
    l1: meta("l1", "Alpha lecture", { lecture: 1, objectives: [{ n: 1, md: "Know alpha", tested: 1 }] }),
    l2: meta("l2", "Beta lecture", { lecture: 2, objectives: [{ n: 1, md: "Compute k", tested: 1 }, { n: 2, md: "Explain beta", tested: 1 }] }),
  },
  widgets: {},
  datasets: {},
} as unknown as Index);

const mount = async (id?: string) => {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<ContentProvider value={content}><ExamPage id={id} /></ContentProvider>);
  });
  return view;
};
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  progress.reset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Opens l1 and l2 (both started), sets the count and starts. */
async function start(count: number, timer = 0) {
  progress.markSeen("l1", ["s-1"], "s-1");
  progress.markSeen("l2", ["s-1"], "s-1");
  const view = await mount();
  fireEvent.change(screen.getByLabelText("Number of questions"), { target: { value: String(count) } });
  if (timer) fireEvent.change(screen.getByLabelText("Timer"), { target: { value: String(timer) } });
  await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Start exam" })));
  await screen.findByRole("heading", { name: /Question 1 of/ }, { timeout: 15_000 });
  return view;
}

describe("setup", () => {
  it("lists lectures by course and ticks the ones the learner has started", async () => {
    progress.markSeen("l1", ["s-1"], "s-1");
    await mount();
    expect(screen.getByText("Toy 101")).toBeTruthy();
    expect((screen.getByLabelText(/Alpha lecture/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Beta lecture/) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Number of questions") as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText("Timer") as HTMLSelectElement).value).toBe("0");
    fireEvent.click(screen.getByLabelText(/Alpha lecture/));
    expect((screen.getByRole("button", { name: "Start exam" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves the session as it starts, capped at the pool", async () => {
    await start(99, 20);
    const [exam] = progress.get().exams;
    expect(progress.get().exams).toHaveLength(1);
    expect(exam!.items).toHaveLength(4);
    expect(exam).toMatchObject({ timerMin: 20 });
    expect(exam!.finishedAt).toBeUndefined();
    // Neighbours come from different lectures.
    const slugs = exam!.items.map((i) => i.key.split("#")[0]);
    expect(slugs.every((s, i) => i === 0 || s !== slugs[i - 1])).toBe(true);
  });
});

/** Answers the question on screen (first option for a multiple choice, the number for a numeric one), with a level. */
async function answerCurrent(level?: string, numeric = "1") {
  if (level) fireEvent.click(screen.getByRole("button", { name: level }));
  const input = screen.queryByLabelText("Your answer");
  if (input) fireEvent.change(input, { target: { value: numeric } });
  else fireEvent.click(screen.getAllByRole("radio")[0]!);
  fireEvent.click(screen.getByRole("button", { name: /Next question|Finish exam/ }));
  await settle();
}

describe("sitting the exam", () => {
  it("holds the answers back, asks how sure, and grades everything at the end", async () => {
    await start(4);
    // No verdicts or explanations while the exam runs.
    expect(screen.queryByText(/Because of/)).toBeNull();
    expect(screen.queryByText("Correct.")).toBeNull();
    expect(screen.getByText(/How sure are you/)).toBeTruthy();
    await answerCurrent("Sure");
    expect(screen.queryByText(/Feedback for/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Question 2 of 4" })).toBeTruthy();
    expect(progress.get().exams[0]!.items.filter((i) => i.answer !== undefined)).toHaveLength(1);
    await answerCurrent("Guessing");
    await answerCurrent();
    expect(progress.get().exams[0]!.finishedAt).toBeUndefined();
    await answerCurrent("Fairly sure");

    const exam = progress.get().exams[0]!;
    expect(exam.finishedAt).toBeTypeOf("number");
    expect(exam.items.every((i) => typeof i.correct === "boolean")).toBe(true);
    // Ratings were filed with the verdicts, once, for the rated items; lessons' checks are untouched.
    const rated = exam.items.filter((i) => i.confidence);
    expect(rated).toHaveLength(3);
    expect(Object.values(progress.get().confidence).flat().map((r) => r.level).sort()).toEqual([1, 2, 3]);
    for (const i of rated) expect(progress.get().confidence[i.key]![0]).toMatchObject({ level: i.confidence, correct: i.correct });
    expect(progress.get().checks).toEqual({});
  });

  it("shows the results: score, answers, why, a link to the step, and the breakdown by objective", async () => {
    await start(4);
    for (let i = 0; i < 4; i++) await answerCurrent();
    cleanup();
    await mount(progress.get().exams[0]!.id);
    const exam = progress.get().exams[0]!;
    const right = exam.items.filter((i) => i.correct).length;
    expect(await screen.findByText(new RegExp(`${right} of 4 right`))).toBeTruthy();
    // Every question, with why, in the order asked.
    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(4);
    expect(within(cards[0]!).getByText(/Because of|Square/)).toBeTruthy();
    const link = within(cards[0]!).getByRole("link", { name: /Open in the lecture/ });
    expect(link.getAttribute("href")).toMatch(/^#\/lesson\/l[12]\?at=s-\d$/);
    // A wrong pick shows its own feedback.
    const wrongMcq = cards.find((c) => within(c).queryByText(/Feedback for/));
    expect(wrongMcq).toBeTruthy();
    // By objective: lecture and objective text, plus the untagged item.
    const body = document.querySelector(".exam-objectives")!.textContent!;
    expect(body).toContain("Alpha lecture");
    expect(body).toContain("Know alpha");
    expect(body).toContain("Compute k");
    expect(body).toContain("Explain beta");
    expect(body).toContain("Untagged");
    expect(within(document.querySelector(".exam-objectives") as HTMLElement).getAllByRole("progressbar").length).toBeGreaterThanOrEqual(4);
  });

  it("resumes after a reload on the same question, with the same varied numbers", async () => {
    progress.markSeen("l2", ["s-1"], "s-1");
    const view = await mount();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Start exam" })));
    await screen.findByRole("heading", { name: /Question 1 of 2/ }, { timeout: 15_000 });
    // l2 holds a multiple choice and the varied numeric check; get the varied one on screen.
    if (!screen.queryByLabelText("Your answer")) await answerCurrent();
    await screen.findByLabelText("Your answer");
    const prompt = () => document.querySelector<HTMLElement>(".exam-card .check-prompt")!.textContent;
    const before = prompt();
    expect(before).toContain("what is");
    view.unmount();
    await mount();
    await screen.findByLabelText("Your answer", {}, { timeout: 15_000 });
    expect(prompt()).toBe(before);
  });
});

describe("the timer", () => {
  it("submits what is answered when time runs out, counting the rest as wrong", async () => {
    const t0 = new Date(2026, 9, 17, 9, 0).getTime();
    progress.saveExam({ id: "exam-t", startedAt: t0, timerMin: 10, items: ["l1#s-1#0", "l1#s-2#0", "l2#s-1#0"].map((key) => ({ key, kind: "check" as const })) });
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"], now: t0 });
    await mount();
    for (let i = 0; i < 5; i++) await settle();
    expect(screen.getByRole("timer").textContent).toContain("10:00");
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    await settle();
    await act(async () => void vi.advanceTimersByTime(5 * 60_000));
    expect(screen.getByRole("timer").textContent).toContain("5:00");
    expect(progress.get().exams[0]!.finishedAt).toBeUndefined();
    // Time runs out with the second question's choice picked but not submitted: that choice still counts.
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    await act(async () => void vi.advanceTimersByTime(5 * 60_000));
    const exam = progress.get().exams[0]!;
    expect(exam.finishedAt).toBeGreaterThanOrEqual(t0 + 10 * 60_000);
    expect(exam.items.map((i) => i.answer)).toEqual([[0], [1], undefined]);
    expect(exam.items.map((i) => i.correct)).toEqual([true, true, false]);
  });

  it("submits at once when a reload finds the time already spent", async () => {
    const t0 = new Date(2026, 9, 17, 9, 0).getTime();
    progress.saveExam({ id: "exam-late", startedAt: t0 - 30 * 60_000, timerMin: 10, items: [{ key: "l1#s-1#0", kind: "check" }] });
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"], now: t0 });
    await mount();
    for (let i = 0; i < 5; i++) await settle();
    expect(progress.get().exams[0]).toMatchObject({ items: [{ correct: false }] });
    expect(progress.get().exams[0]!.finishedAt).toBeTypeOf("number");
  });
});
