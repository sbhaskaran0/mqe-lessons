// @vitest-environment happy-dom
// What #/review hands the lesson's Check and Derive: a seed that differs per item and per visit (so a varied check
// shows a fresh variant), and `exercise` on every derivation (so Settings "Review mode" cannot turn a review into a
// worked answer). Check and Derive are stand-ins here; their own behaviour is tested with them.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContent, ContentProvider } from "../../src/content/context";
import type { Block, Index, NoteBody, NoteMeta } from "../../src/ir";
import { progress } from "../../src/progress";
import { ReviewPage } from "../../src/review/ReviewPage";

const seen = vi.hoisted(() => ({ checks: [] as { key: string; seed: number | undefined }[], derives: [] as { key: string; exercise: boolean | undefined }[] }));
vi.mock("../../src/lesson/Check", () => ({
  Check: (p: { storeKey: string; seed?: number }) => {
    seen.checks.push({ key: p.storeKey, seed: p.seed });
    return <div className="check">check</div>;
  },
}));
vi.mock("../../src/lesson/Derive", () => ({
  Derive: (p: { storeKey: string; exercise?: boolean }) => {
    seen.derives.push({ key: p.storeKey, exercise: p.exercise });
    return <div className="derive">derive</div>;
  },
}));

const mcq = (prompt: string): Block => ({ t: "check", kind: "mcq", prompt, options: [{ md: "a", correct: true }, { md: "b", correct: false }], why: "w" });
const derive = { t: "derive", title: "d", steps: [{ md: "x", tex: "x" }] } as unknown as Block;
const body = { slug: "l1", notation: [], sections: [{ id: "s", heading: "H", steps: [{ id: "s-1", blocks: [mcq("one"), mcq("two"), derive] }] }] } as unknown as NoteBody;
const loaded = vi.hoisted(() => ({ promise: undefined as Promise<unknown> | undefined }));
loaded.promise = Promise.resolve(body);
vi.mock("../../src/content/store", async (orig) => ({ ...(await orig<typeof import("../../src/content/store")>()), loadNote: () => loaded.promise }));

const meta = { slug: "l1", name: "l1", title: "Lecture", type: "lecture", path: "l1.md", summary: "", tags: [], aliases: [], requires: [], lessons: [], courses: [], edges: { out: [], in: [] }, figures: [], interactives: [], checks: 2, words: 0, created: "", updated: "" } as unknown as NoteMeta;
const content = createContent({ courses: [], notes: { l1: meta }, widgets: {}, datasets: {} } as unknown as Index);
const NOW = new Date(2026, 9, 17, 9, 0).getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  progress.reset();
  seen.checks.length = 0;
  seen.derives.length = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const due = { box: 1, due: new Date(2026, 9, 16).getTime(), lapses: 0, at: 1 };
async function mount(at: number) {
  vi.setSystemTime(at);
  const file = JSON.parse(progress.exportJson());
  file.progress.leitner = { "l1#s-1#0": due, "l1#s-1#1": due, "l1#s-1#2": due };
  progress.importJson(JSON.stringify(file));
  await act(async () => void render(<ContentProvider value={content}><ReviewPage /></ContentProvider>));
}

describe("ReviewPage hands Check and Derive their props", () => {
  it("seeds each check differently, and differently on the next visit", async () => {
    await mount(NOW);
    expect(await screen.findAllByText("check")).toHaveLength(2);
    const first = new Map(seen.checks.map((c) => [c.key, c.seed]));
    expect(first.get("l1#s-1#0")).toBeTypeOf("number");
    expect(first.get("l1#s-1#0")).not.toBe(first.get("l1#s-1#1"));
    cleanup();
    seen.checks.length = 0;
    await mount(NOW + 60_000);
    await screen.findAllByText("check");
    expect(seen.checks.find((c) => c.key === "l1#s-1#0")!.seed).not.toBe(first.get("l1#s-1#0"));
  });

  it("marks every derivation an exercise", async () => {
    await mount(NOW);
    await screen.findByText("derive");
    expect(seen.derives.length).toBeGreaterThan(0);
    expect(seen.derives.every((d) => d.exercise === true)).toBe(true);
  });
});
