// @vitest-environment happy-dom
// F5 on #/review: the "How sure are you?" control above each unanswered item is optional, and the level chosen is
// recorded with the verdict when the item is answered.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContent, ContentProvider } from "../../src/content/context";
import type { Block, Index, NoteBody, NoteMeta } from "../../src/ir";
import { progress } from "../../src/progress";
import { ReviewPage } from "../../src/review/ReviewPage";

const check: Block = { t: "check", kind: "mcq", prompt: "Pick one", options: [{ md: "Right", correct: true }, { md: "Wrong", correct: false }], why: "Because." };
const body = { slug: "l1", notation: [], sections: [{ id: "s", heading: "H", steps: [{ id: "s-1", blocks: [check] }] }] } as unknown as NoteBody;
const loaded = vi.hoisted(() => ({ promise: undefined as Promise<unknown> | undefined }));
loaded.promise = Promise.resolve(body);
vi.mock("../../src/content/store", async (orig) => ({ ...(await orig<typeof import("../../src/content/store")>()), loadNote: () => loaded.promise }));
const meta = { slug: "l1", name: "l1", title: "Lecture", type: "lecture", path: "l1.md", summary: "", tags: [], aliases: [], requires: [], lessons: [], courses: [], edges: { out: [], in: [] }, figures: [], interactives: [], checks: 1, words: 0, created: "", updated: "" } as unknown as NoteMeta;
const content = createContent({ courses: [], notes: { l1: meta }, widgets: {}, datasets: {} } as unknown as Index);
const KEY = "l1#s-1#0";
const NOW = new Date(2026, 9, 17, 9, 0).getTime();

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  progress.reset();
  const file = JSON.parse(progress.exportJson());
  file.progress.leitner = { [KEY]: { box: 1, due: new Date(2026, 9, 16).getTime(), lapses: 0, at: 1 } };
  progress.importJson(JSON.stringify(file));
  await act(async () => void render(<ContentProvider value={content}><ReviewPage /></ContentProvider>));
  await waitFor(() => expect(document.querySelector(".review-card .check")).toBeTruthy());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const card = () => screen.getByRole("article", { name: "Lecture" });
const answer = (option: string) => {
  fireEvent.click(within(card()).getByLabelText(option));
  fireEvent.click(within(card()).getByRole("button", { name: "Check answer" }));
};

describe("confidence on review", () => {
  it("asks before the answer and records the level with the verdict", () => {
    expect(within(card()).getByText(/How sure are you/)).toBeTruthy();
    fireEvent.click(within(card()).getByRole("button", { name: "Fairly sure" }));
    answer("Wrong");
    expect(progress.get().confidence[KEY]).toMatchObject([{ level: 2, correct: false }]);
    expect(within(card()).getByText("You said: Fairly sure.")).toBeTruthy();
    expect(within(card()).queryByRole("button", { name: "Sure" })).toBeNull();
  });

  it("is optional: no level, nothing recorded", () => {
    answer("Right");
    expect(progress.get().confidence[KEY]).toBeUndefined();
    expect(progress.get().leitner[KEY]).toMatchObject({ box: 2 });
  });

  it("pressing the chosen level again clears it", () => {
    const sure = within(card()).getByRole("button", { name: "Sure" });
    fireEvent.click(sure);
    expect(sure.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(sure);
    expect(sure.getAttribute("aria-pressed")).toBe("false");
    answer("Right");
    expect(progress.get().confidence[KEY]).toBeUndefined();
  });
});
