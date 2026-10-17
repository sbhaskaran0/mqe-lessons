// @vitest-environment happy-dom
// #/review: due items are shown unanswered with the real Check or Derive, an answer reschedules the item and leaves the
// lesson's own record alone, and the list is fixed for the visit.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calloutToIR } from "../../src/derive";
import { createContent, ContentProvider } from "../../src/content/context";
import type { Block, Index, NoteBody, NoteMeta } from "../../src/ir";
import { progress, reviewDeriveKey } from "../../src/progress";
import { ReviewPage } from "../../src/review/ReviewPage";

const NOW = new Date(2026, 9, 17, 9, 0).getTime();
const midnight = (day: number) => new Date(2026, 9, day).getTime();

const check: Block = {
  t: "check",
  kind: "mcq",
  prompt: "Does saving change long-run growth?",
  options: [
    { md: "Yes", correct: false },
    { md: "No, only the level", correct: true },
  ],
  why: "Capital per worker is constant.",
};
const derive = calloutToIR(String.raw`> [!derive]- Take the root
> objective: 1
> symbols: $s \in (0.05, 0.95)$, $A$, $\delta \in (0.02, 0.2)$, $k$
> unknowns: $k$
> given: $sAk = \delta k$
>
> 1. Solve: $k = \delta / (sA)$
>
> accept: $k = \frac{\delta}{sA}$`) as unknown as Block;

const body = {
  slug: "l1",
  notation: [],
  sections: [{ id: "s", heading: "The model", steps: [{ id: "s-1", heading: "Saving", blocks: [{ t: "prose", md: "intro" }, check, derive] }] }],
} as unknown as NoteBody;
// loadNote caches its promise, and `use` needs the same one on every render.
const loaded = vi.hoisted(() => ({ promise: undefined as Promise<unknown> | undefined }));
loaded.promise = Promise.resolve(body);
vi.mock("../../src/content/store", async (orig) => ({ ...(await orig<typeof import("../../src/content/store")>()), loadNote: () => loaded.promise }));

const meta = { slug: "l1", name: "l1", title: "Growth lecture", type: "lecture", path: "l1.md", summary: "", tags: [], aliases: [], requires: [], lessons: [], courses: [], edges: { out: [], in: [] }, figures: [], interactives: [], checks: 1, words: 0, created: "", updated: "" } as unknown as NoteMeta;
const content = createContent({ courses: [], notes: { l1: meta }, widgets: {}, datasets: {} } as unknown as Index);
const CHECK = "l1#s-1#1";
const DERIVE = "l1#s-1#2";

// Awaited, so the page's suspended cards can settle inside act.
const mount = async () => {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <ContentProvider value={content}>
        <ReviewPage />
      </ContentProvider>,
    );
  });
  return view;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  progress.reset();
  progress.setSettings({ review: false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The card, once its question has loaded (until then a frame with the same name stands in for it). */
async function loadedCard() {
  await waitFor(() => expect(document.querySelector(".review-card .check, .review-card .derive")).toBeTruthy());
  return screen.getByRole("article", { name: "Growth lecture" });
}

const due = (box: 1 | 2 | 3 | 4 = 1) => ({ box, due: midnight(16), lapses: 0, at: 1 });
const seed = (leitner: Record<string, ReturnType<typeof due>>) => {
  // The store's own actions would stamp today's date; write the schedule the way an older visit left it.
  const text = progress.exportJson();
  const file = JSON.parse(text);
  file.progress.leitner = leitner;
  expect(progress.importJson(JSON.stringify(file))).toBeNull();
};

describe("ReviewPage", () => {
  it("says nothing is due, and when something will be", async () => {
    seed({ [CHECK]: { box: 2, due: midnight(20), lapses: 0, at: 1 } });
    await mount();
    expect(screen.getByRole("heading", { name: "Nothing due" })).toBeTruthy();
    expect(screen.getByText("in 3 days")).toBeTruthy();
  });

  it("shows a due check unanswered, even when the lesson has an answer, and reschedules it without touching the lesson's record", async () => {
    progress.recordCheck(CHECK, "incorrect", [0]);
    seed({ [CHECK]: due(1) });
    const lessonRecord = progress.get().checks[CHECK];
    await mount();
    const card = await loadedCard();
    expect(within(card).getByText("Does saving change long-run growth?")).toBeTruthy();
    expect(within(card).getByRole("status").textContent).toBe("");
    expect(within(card).getByRole("link", { name: /Open in the lecture/ }).getAttribute("href")).toBe("#/lesson/l1?at=s-1");
    expect(within(card).getByText(/The model/)).toBeTruthy();

    fireEvent.click(within(card).getByLabelText("No, only the level"));
    fireEvent.click(within(card).getByRole("button", { name: "Check answer" }));
    expect(within(card).getByText("Correct.")).toBeTruthy();
    expect(progress.get().leitner[CHECK]).toMatchObject({ box: 2, due: midnight(20) });
    expect(progress.get().checks[CHECK]).toBe(lessonRecord);
    // The item stays on the page with its result for the rest of the visit.
    expect(within(card).getByText("Right. Back in 3 days.")).toBeTruthy();
    expect(screen.getByText("Done for today: 1 of 1 right.")).toBeTruthy();
  });

  it("a wrong answer starts the item over and offers no retry", async () => {
    seed({ [CHECK]: due(3) });
    await mount();
    const card = await loadedCard();
    fireEvent.click(within(card).getByLabelText("Yes"));
    fireEvent.click(within(card).getByRole("button", { name: "Check answer" }));
    expect(within(card).queryByRole("button", { name: /Try again/ })).toBeNull();
    expect(progress.get().leitner[CHECK]).toMatchObject({ box: 1, lapses: 1, due: midnight(18) });
    expect(within(card).getByText("Not yet. Back tomorrow.")).toBeTruthy();
  });

  it("a right answer in the last box takes the item off the schedule", async () => {
    seed({ [CHECK]: due(4) });
    await mount();
    const card = await loadedCard();
    fireEvent.click(within(card).getByLabelText("No, only the level"));
    fireEvent.click(within(card).getByRole("button", { name: "Check answer" }));
    expect(progress.get().leitner[CHECK]).toBeUndefined();
    expect(within(card).getByText("Right. This one is off the schedule.")).toBeTruthy();
  });

  it("runs a derivation review on a scratch record: giving up counts as a miss and the lesson's record is untouched", async () => {
    progress.recordDerive(DERIVE, { result: "gave-up" });
    seed({ [DERIVE]: due(2) });
    // A scratch record left by an earlier visit must not start this one half done.
    progress.recordDerive(reviewDeriveKey(DERIVE), { result: "gave-up" });
    const lessonRecord = progress.get().derives[DERIVE];
    await mount();
    const card = await loadedCard();
    fireEvent.click(await within(card).findByRole("button", { name: "Show worked derivation" }));
    await waitFor(() => expect(progress.get().leitner[DERIVE]).toMatchObject({ box: 1, lapses: 1 }));
    expect(progress.get().derives[DERIVE]).toBe(lessonRecord);
    expect(within(card).getByText("Not yet. Back tomorrow.")).toBeTruthy();
  });

  it("clears the scratch derivation record when the page closes", async () => {
    seed({ [DERIVE]: due(1) });
    const { unmount } = await mount();
    const card = await loadedCard();
    fireEvent.click(await within(card).findByRole("button", { name: "Show worked derivation" }));
    await waitFor(() => expect(progress.get().derives[reviewDeriveKey(DERIVE)]).toBeDefined());
    unmount();
    expect(progress.get().derives[reviewDeriveKey(DERIVE)]).toBeUndefined();
  });

  it("lists at most 20 items per visit and says how many wait", async () => {
    const many: Record<string, ReturnType<typeof due>> = {};
    for (let i = 0; i < 23; i++) many[`l1#s-1#${1 + 3 * i}`] = due(1);
    seed(many);
    await mount();
    expect(await screen.findAllByRole("article")).toHaveLength(20);
    expect(screen.getByText(/0 of 20 reviewed \(3 more are due/)).toBeTruthy();
  });

  it("offers to drop an item whose block is no longer in the lecture", async () => {
    seed({ "l1#s-1#0": due(1) });
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Remove it from the schedule" }));
    expect(progress.get().leitner["l1#s-1#0"]).toBeUndefined();
  });
});
