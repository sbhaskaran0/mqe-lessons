// The sections spaced review added to the progress store (leitner, confidence, exams): defaults, old files, import and
// export, recovery, and the rules for entering and leaving the schedule.
import { describe, expect, it } from "vitest";
import { buildDashboard, dueItems, nextReviewDue } from "../../src/progress/dashboard";
import { buildModel } from "../../src/content/model";
import type { Index, NoteMeta } from "../../src/ir";
import { createProgressStore, emptyProgress, PROGRESS_BACKUP_KEY, PROGRESS_KEY, reviewDeriveKey, type ExamRecord, type StorageLike } from "../../src/progress/store";

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}
const DAY = 86_400_000;
const T0 = new Date(2026, 9, 16, 15, 0).getTime();
const midnight = (day: number) => new Date(2026, 9, day).getTime();
const clock = (start: number) => {
  let t = start;
  return { now: () => t, set: (v: number) => void (t = v) };
};
const K = "l1#s-1#0";
const D = "l1#s-2#0";

describe("empty data and old files", () => {
  it("starts with empty sections", () => {
    const e = emptyProgress();
    expect([e.leitner, e.confidence, e.exams]).toEqual([{}, {}, []]);
    expect(createProgressStore(memoryStorage()).get().leitner).toEqual({});
  });

  it("reads a version 1 file without the sections as having none", () => {
    const storage = memoryStorage();
    const { leitner: _l, confidence: _c, exams: _e, ...old } = emptyProgress();
    storage.setItem(PROGRESS_KEY, JSON.stringify({ ...old, checks: { [K]: { result: "incorrect", tries: 1, at: 5 } } }));
    const store = createProgressStore(storage);
    expect(store.get()).toMatchObject({ version: 1, leitner: {}, confidence: {}, exams: [] });
    expect(store.get().checks[K]!.result).toBe("incorrect");
    expect(storage.map.has(PROGRESS_BACKUP_KEY)).toBe(false);
  });

  it("imports an old export, and an export round-trips the new sections", () => {
    const { leitner: _l, confidence: _c, exams: _e, ...old } = emptyProgress();
    const store = createProgressStore(memoryStorage());
    expect(store.importJson(JSON.stringify({ format: "mqe-lessons-progress", exported: "2026-10-01T00:00:00Z", progress: old }))).toBeNull();
    expect(store.get().leitner).toEqual({});

    store.recordCheck(K, "incorrect", [0]);
    store.recordConfidence(K, 2, false);
    const exam: ExamRecord = { id: "x1", startedAt: 1, finishedAt: 2, timerMin: 30, items: [{ key: K, kind: "check", answer: [1], correct: true, confidence: 3 }] };
    store.saveExam(exam);
    const other = createProgressStore(memoryStorage());
    expect(other.importJson(store.exportJson())).toBeNull();
    expect(other.get().leitner[K]).toMatchObject({ box: 1, lapses: 0 });
    expect(other.get().confidence[K]).toHaveLength(1);
    expect(other.get().exams).toEqual([exam]);
  });

  it("keeps the good records of a damaged section, backs the file up, and drops the rest", () => {
    const storage = memoryStorage();
    const good = { box: 2, due: 5, lapses: 0, at: 1 };
    const raw = JSON.stringify({
      ...emptyProgress(),
      leitner: { good, bad: { box: 9, due: 5, lapses: 0, at: 1 } },
      confidence: { good: [{ level: 3, correct: true, at: 1 }], bad: [{ level: 7, correct: true, at: 1 }] },
      exams: [{ id: "e", startedAt: 1, items: [] }, { id: 3 }],
    });
    storage.setItem(PROGRESS_KEY, raw);
    const d = createProgressStore(storage).get();
    expect(d.leitner).toEqual({ good });
    expect(Object.keys(d.confidence)).toEqual(["good"]);
    expect(d.exams).toEqual([{ id: "e", startedAt: 1, items: [] }]);
    expect(storage.getItem(PROGRESS_BACKUP_KEY)).toBe(raw);
  });

  it("a progress reset clears the schedule", () => {
    const store = createProgressStore(memoryStorage());
    store.recordCheck(K, "incorrect", [0]);
    store.reset();
    expect(store.get().leitner).toEqual({});
  });
});

describe("entering the schedule", () => {
  it("a check answered wrong joins at box 1, due tomorrow; right or skipped does not", () => {
    const c = clock(T0);
    const store = createProgressStore(memoryStorage(), c.now);
    store.recordCheck("l1#s-1#1", "correct", [0]);
    store.recordCheck("l1#s-1#2", "skipped");
    expect(store.get().leitner).toEqual({});
    store.recordCheck(K, "incorrect", [0]);
    expect(store.get().leitner[K]).toEqual({ box: 1, due: midnight(17), lapses: 0, at: T0 });
  });

  it("a missed exam question joins at box 1 without touching the lesson's check record", () => {
    const c = clock(T0);
    const store = createProgressStore(memoryStorage(), c.now);
    store.scheduleMiss(K);
    expect(store.get().leitner[K]).toEqual({ box: 1, due: midnight(17), lapses: 0, at: T0 });
    expect(store.get().checks[K]).toBeUndefined();
    c.set(T0 + DAY);
    store.scheduleMiss(K);
    expect(store.get().leitner[K]?.at).toBe(T0);
  });

  it("a retry that turns out right leaves it on the schedule, and a second miss does not reset it", () => {
    const c = clock(T0);
    const store = createProgressStore(memoryStorage(), c.now);
    store.recordCheck(K, "incorrect", [0]);
    c.set(T0 + DAY);
    store.recordReview(K, true);
    const after = store.get().leitner[K];
    c.set(T0 + 2 * DAY);
    store.recordCheck(K, "incorrect", [2]);
    expect(store.get().leitner[K]).toBe(after);
    store.recordCheck(K, "correct", [1]);
    expect(store.get().leitner[K]).toBe(after);
  });

  it("a derivation given up or skipped joins; done, open and review scratch records do not", () => {
    const store = createProgressStore(memoryStorage(), () => T0);
    store.recordDerive("l1#s-2#1", { result: "done" });
    store.recordDerive("l1#s-2#2", { hints: 1 });
    store.recordDerive(reviewDeriveKey(D), { result: "gave-up" });
    expect(store.get().leitner).toEqual({});
    store.recordDerive(D, { result: "gave-up" });
    store.recordDerive("l1#s-2#3", { result: "skipped" });
    expect(Object.keys(store.get().leitner).sort()).toEqual([D, "l1#s-2#3"]);
  });
});

describe("recordReview", () => {
  it("moves up on right, to box 1 with a lapse on wrong, and leaves checks and derives alone", () => {
    const c = clock(T0);
    const store = createProgressStore(memoryStorage(), c.now);
    store.recordCheck(K, "incorrect", [0]);
    const check = store.get().checks[K];
    c.set(midnight(17));
    store.recordReview(K, true);
    expect(store.get().leitner[K]).toMatchObject({ box: 2, due: midnight(20) });
    c.set(midnight(20));
    store.recordReview(K, false);
    expect(store.get().leitner[K]).toMatchObject({ box: 1, due: midnight(21), lapses: 1 });
    expect(store.get().checks[K]).toBe(check);
  });

  it("removes the entry after a right answer in box 4, and ignores items not scheduled", () => {
    const c = clock(T0);
    const store = createProgressStore(memoryStorage(), c.now);
    store.recordReview("nothing#s#0", true);
    expect(store.get().leitner).toEqual({});
    store.recordCheck(K, "incorrect", [0]);
    for (let i = 0; i < 3; i++) store.recordReview(K, true);
    expect(store.get().leitner[K]!.box).toBe(4);
    store.recordReview(K, true);
    expect(store.get().leitner[K]).toBeUndefined();
  });

  it("dropReview and discardDerive remove one record each", () => {
    const store = createProgressStore(memoryStorage(), () => T0);
    store.recordCheck(K, "incorrect", [0]);
    store.recordDerive(reviewDeriveKey(D), { hints: 1 });
    store.dropReview(K);
    store.discardDerive(reviewDeriveKey(D));
    expect(store.get().leitner).toEqual({});
    expect(store.get().derives).toEqual({});
  });
});

describe("confidence and exams", () => {
  it("recordConfidence appends ratings in order", () => {
    const store = createProgressStore(memoryStorage(), () => T0);
    store.recordConfidence(K, 1, false);
    store.recordConfidence(K, 3, true);
    expect(store.get().confidence[K]).toEqual([
      { level: 1, correct: false, at: T0 },
      { level: 3, correct: true, at: T0 },
    ]);
  });

  it("saveExam replaces an exam with the same id and keeps the others", () => {
    const store = createProgressStore(memoryStorage());
    store.saveExam({ id: "a", startedAt: 1, items: [] });
    store.saveExam({ id: "b", startedAt: 2, items: [] });
    store.saveExam({ id: "a", startedAt: 1, finishedAt: 9, items: [{ key: K, kind: "check", correct: true }] });
    expect(store.get().exams.map((e) => [e.id, e.finishedAt])).toEqual([["a", 9], ["b", undefined]]);
  });
});

describe("what the dashboard and the review page see", () => {
  const meta = (slug: string, type: NoteMeta["type"]): NoteMeta =>
    ({ slug, name: slug, title: slug, type, path: `${slug}.md`, summary: "", tags: [], aliases: [], requires: [], lessons: [], courses: [], edges: { out: [], in: [] }, figures: [], interactives: [], checks: 0, words: 0, created: "", updated: "" }) as NoteMeta;
  const model = buildModel({ courses: [], notes: { l1: meta("l1", "lecture"), l2: meta("l2", "lecture") }, widgets: {}, datasets: {} } as unknown as Index);

  it("counts only due items of notes in the index, oldest first, up to the cap, and links to the step", () => {
    const data = emptyProgress();
    data.leitner = {
      "l1#s-1#0": { box: 1, due: midnight(16), lapses: 0, at: 1 },
      "l2#s-1#0": { box: 2, due: midnight(14), lapses: 0, at: 1 },
      "gone#s-1#0": { box: 1, due: midnight(10), lapses: 0, at: 1 },
      "l1#s-9#0": { box: 1, due: midnight(18), lapses: 0, at: 1 },
    };
    const due = dueItems(model, data, T0);
    expect(due.map((d) => d.key)).toEqual(["l2#s-1#0", "l1#s-1#0"]);
    expect(due[1]!.href).toBe("#/lesson/l1?at=s-1");
    expect(dueItems(model, data, T0, 1)).toHaveLength(1);
    expect(buildDashboard(model, data, { now: T0 }).due).toBe(2);
    expect(nextReviewDue(model, data, T0)).toBe(midnight(18));
  });

  it("first-try statistics ignore a retry that turned out right", () => {
    const data = emptyProgress();
    data.checks = {
      "l1#s-1#0": { result: "correct", firstTry: "incorrect", tries: 2, at: 1 },
      "l1#s-1#1": { result: "correct", firstTry: "correct", tries: 1, at: 1 },
    };
    expect(buildDashboard(model, data).totals).toMatchObject({ answered: 2, correct: 1 });
  });
});
