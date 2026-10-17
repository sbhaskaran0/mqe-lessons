// Practice sets: grouping, grades in the progress store (and their backward-compatible storage), filters, and the
// progress dashboard's aggregation.
import { describe, expect, it } from "vitest";
import { parseHash, href } from "../../src/app/router";
import { buildModel } from "../../src/content/model";
import type { Index, NoteMeta, PracticeItem } from "../../src/ir";
import { filterIds, groupItems, setSummary, shows } from "../../src/practice/model";
import { buildDashboard, parseBlockKey, parsePracticeKey } from "../../src/progress/dashboard";
import { createProgressStore, emptyProgress, practiceKey, PROGRESS_KEY, type StorageLike } from "../../src/progress/store";

function memoryStorage(seed?: Record<string, string>): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

const item = (id: string, group?: string, extra: Partial<PracticeItem> = {}): PracticeItem => ({
  id,
  number: id.slice(1),
  ...(group ? { group } : {}),
  prompt: `Question ${id}`,
  answer: `Answer ${id}`,
  links: [],
  ...extra,
});

const ITEMS = [item("q1", "A. Concepts"), item("q2", "A. Concepts"), item("q3", "B. Calculations"), item("q4", "A. Concepts"), item("q5")];

describe("practice grouping", () => {
  it("groups questions under their headings in first-appearance order, keeping set order inside a group", () => {
    const groups = groupItems(ITEMS);
    expect(groups.map((g) => [g.title, g.items.map((i) => i.id)])).toEqual([
      ["A. Concepts", ["q1", "q2", "q4"]],
      ["B. Calculations", ["q3"]],
      [undefined, ["q5"]],
    ]);
  });
});

describe("practice grades", () => {
  it("stores a grade under slug#practice-<id>, keeps the first verdict, and can be cleared", () => {
    let t = 100;
    const storage = memoryStorage();
    const store = createProgressStore(storage, () => t++);
    const key = practiceKey("set", "q3");
    expect(key).toBe("set#practice-q3");
    store.gradePractice(key, "notyet");
    store.gradePractice(key, "got");
    expect(store.get().practice[key]).toEqual({ grade: "got", first: "notyet", at: 101 });
    expect(JSON.parse(storage.map.get(PROGRESS_KEY)!).practice[key].grade).toBe("got");
    store.clearPractice(key);
    expect(store.get().practice[key]).toBeUndefined();
  });

  it("reads progress saved before practice existed, and imports old exports", () => {
    const old = { version: 1, steps: { "a#s1": 1 }, notes: {}, checks: {}, checkpoints: {} };
    const store = createProgressStore(memoryStorage({ [PROGRESS_KEY]: JSON.stringify(old) }));
    expect(store.get().steps).toEqual({ "a#s1": 1 });
    expect(store.get().practice).toEqual({});
    expect(store.importJson(JSON.stringify({ format: "mqe-lessons-progress", exported: "x", progress: old }))).toBeNull();
    expect(store.get().practice).toEqual({});
    store.gradePractice("a#practice-q1", "got");
    const round = createProgressStore(memoryStorage());
    expect(round.importJson(store.exportJson())).toBeNull();
    expect(round.get().practice["a#practice-q1"]?.grade).toBe("got");
  });

  it("summarizes a set and filters it to review or untried questions", () => {
    const store = createProgressStore(memoryStorage());
    store.gradePractice(practiceKey("set", "q1"), "got");
    store.gradePractice(practiceKey("set", "q3"), "notyet");
    store.gradePractice(practiceKey("other", "q2"), "notyet");
    const data = store.get();
    expect(setSummary(data, "set", ITEMS)).toEqual({ total: 5, got: 1, partly: 0, notYet: 1, untried: 3 });
    expect([...filterIds(data, "set", ITEMS, "review")]).toEqual(["q3"]);
    expect([...filterIds(data, "set", ITEMS, "new")]).toEqual(["q2", "q4", "q5"]);
    expect(filterIds(data, "set", ITEMS, undefined).size).toBe(5);
    expect(shows("review", undefined)).toBe(false);
  });

  it("routes #/practice/<slug> with a question and a filter", () => {
    expect(parseHash("#/practice/econ-430-l1-practice-questions")).toEqual({ name: "practice", slug: "econ-430-l1-practice-questions" });
    expect(parseHash("#/practice/s?at=q3&show=review")).toEqual({ name: "practice", slug: "s", at: "q3", show: "review" });
    expect(parseHash("#/practice/s?show=bogus")).toEqual({ name: "practice", slug: "s" });
    expect(href({ name: "practice", slug: "s", at: "q3", show: "review" })).toBe("#/practice/s?at=q3&show=review");
    expect(parseHash("#/progress")).toEqual({ name: "progress" });
    expect(href({ name: "progress" })).toBe("#/progress");
  });
});

const meta = (slug: string, type: NoteMeta["type"], extra: Partial<NoteMeta> = {}): NoteMeta => ({
  slug,
  name: slug,
  title: slug.toUpperCase(),
  type,
  path: `${slug}.md`,
  summary: "",
  tags: [],
  aliases: [],
  requires: [],
  lessons: [],
  courses: [],
  edges: { out: [], in: [] },
  figures: [],
  interactives: [],
  checks: 0,
  words: 0,
  created: "2026-10-01T00:00:00Z",
  updated: "2026-10-01T00:00:00Z",
  ...extra,
});

const index = {
  courses: [
    { code: "Toy 101", id: "toy-101", hub: "toy-101", lectures: ["l1", "l2"], practice: ["set"], guides: [] },
    { code: "Toy 202", id: "toy-202", hub: "toy-202", lectures: ["m1"], practice: [], guides: [] },
  ],
  notes: {
    "toy-101": meta("toy-101", "course"),
    "toy-202": meta("toy-202", "course"),
    l1: meta("l1", "lecture", { course: "Toy 101", lecture: 1, checks: 3 }),
    l2: meta("l2", "lecture", { course: "Toy 101", lecture: 2, checks: 2 }),
    set: meta("set", "practice", { course: "Toy 101", lecture: 1, pairedAnswers: "answers" }),
    answers: meta("answers", "practice", { course: "Toy 101", lecture: 1 }),
    m1: meta("m1", "lecture", { course: "Toy 202", lecture: 1, checks: 1 }),
    c: meta("c", "concept", { checks: 1 }),
  },
} as unknown as Index;

describe("progress dashboard", () => {
  const model = buildModel(index);

  it("parses check, predict and practice keys", () => {
    expect(parseBlockKey("l1#6-the-steady-state-1#2")).toEqual({ slug: "l1", stepId: "6-the-steady-state-1", block: 2, predict: false });
    expect(parseBlockKey("l1#s-1#0#predict")).toMatchObject({ predict: true, block: 0 });
    expect(parsePracticeKey("set#practice-q12")).toEqual({ slug: "set", id: "q12" });
    expect(parseBlockKey("set#practice-q12")).toBeUndefined();
  });

  it("aggregates per course, builds the review queue and recent activity", () => {
    const data = emptyProgress();
    data.steps = { "l1#a": 1, "l1#b": 2, "c#x": 3 };
    data.notes = { l1: { total: 4, seen: 2, furthest: 1, at: 50 }, c: { total: 1, seen: 1, furthest: 0, at: 10 } };
    data.checks = {
      "l1#a#0": { result: "correct", tries: 1, at: 20 },
      "l1#b#1": { result: "incorrect", tries: 1, at: 30 },
      "l2#z#0": { result: "skipped", tries: 0, at: 40 },
      "c#x#0": { result: "incorrect", tries: 1, at: 5 },
      "gone#x#0": { result: "incorrect", tries: 1, at: 99 },
    };
    data.checkpoints = {
      "l1#b#2": { kind: "goal", result: "met", at: 31 },
      "l2#y#0": { kind: "goal", result: "skipped", at: 41 },
      "l1#b#2#predict": { kind: "predict", result: "incorrect", at: 32 },
    };
    data.practice = { "set#practice-q1": { grade: "got", first: "got", at: 60 }, "set#practice-q2": { grade: "notyet", first: "notyet", at: 70 } };

    const d = buildDashboard(model, data);
    const toy = d.courses.find((c) => c.course.id === "toy-101")!;
    expect(toy.lectures.map((l) => [l.meta.slug, l.fraction, l.seen, l.total])).toEqual([
      ["l1", 0.5, 2, 4],
      ["l2", 0, 0, 0],
    ]);
    expect(toy.fraction).toBe(0.25);
    // 5 checks in its lectures, 3 recorded.
    expect(toy.checks).toEqual({ correct: 1, wrong: 1, skipped: 1, open: 2 });
    expect(toy.goals).toEqual({ met: 1, skipped: 1 });
    expect(toy.predictions).toEqual({ right: 0, wrong: 1 });
    expect(toy.practice).toMatchObject({ got: 1, notYet: 1 });
    expect(toy.practice.sets.map((m) => m.slug)).toEqual(["set"]);
    expect(toy.started).toBe(true);
    const other = d.courses.find((c) => c.course.id === "toy-202")!;
    expect(other).toMatchObject({ started: false, checks: { correct: 0, wrong: 0, skipped: 0, open: 1 } });

    // Notes outside courses keep their own tally; unknown notes are ignored.
    expect(d.other.notes.map((m) => m.slug)).toEqual(["c"]);
    expect(d.other.checks).toMatchObject({ wrong: 1 });

    // Newest first; each links to its exact step (a lecture opens as a lesson) or question.
    expect(d.review.map((r) => [r.kind, r.key, r.href])).toEqual([
      ["practice", "set#practice-q2", "#/practice/set?at=q2"],
      ["goal", "l2#y#0", "#/lesson/l2?at=y"],
      ["check", "l2#z#0", "#/lesson/l2?at=z"],
      ["check", "l1#b#1", "#/lesson/l1?at=b"],
      ["check", "c#x#0", "#/note/c?at=x"],
    ]);

    expect(d.recent.map((a) => [a.meta.slug, a.at])).toEqual([
      ["set", 70],
      ["l1", 50],
      ["l2", 41],
      ["c", 10],
    ]);
    expect(d.recent.find((a) => a.meta.slug === "l1")).toMatchObject({ seen: 2, total: 4, checks: 2 });
    expect(d.recent[0]).toMatchObject({ practice: 2 });
    expect(d.totals).toEqual({ steps: 3, answered: 3, correct: 1, practiced: 2 });
  });

  it("is empty but complete with no progress", () => {
    const d = buildDashboard(model, emptyProgress());
    expect(d.review).toEqual([]);
    expect(d.recent).toEqual([]);
    expect(d.courses.map((c) => c.started)).toEqual([false, false]);
    expect(d.totals).toEqual({ steps: 0, answered: 0, correct: 0, practiced: 0 });
  });
});
