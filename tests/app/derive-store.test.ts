// The progress store's derive section and the rubric grade: defaults and salvage for older files, what recordDerive
// keeps and refuses to overwrite, the approved rubric rule (all = got it, at least half = partly, else not yet), and
// that the dashboard still reads practice grades with "partly" among them.
import { describe, expect, it } from "vitest";
import { buildModel } from "../../src/content/model";
import type { Index, NoteMeta } from "../../src/ir";
import { buildDashboard } from "../../src/progress/dashboard";
import { blockKey, createProgressStore, emptyProgress, PROGRESS_BACKUP_KEY, PROGRESS_KEY, practiceKey, type StorageLike } from "../../src/progress/store";

function memoryStorage(seed?: Record<string, string>): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

const KEY = blockKey("toy", "5-deriving-2", 0);
const lines = (...l: string[]) => ({ lines: l, reached: l.length, done: false });

describe("derives section", () => {
  it("is empty by default, in emptyProgress and when reading a file saved before it existed", () => {
    expect(emptyProgress().derives).toEqual({});
    const old = { version: 1, steps: {}, notes: {}, checks: {}, checkpoints: {}, practice: {}, flags: {} };
    const store = createProgressStore(memoryStorage({ [PROGRESS_KEY]: JSON.stringify(old) }));
    expect(store.get().derives).toEqual({});
    expect(store.importJson(JSON.stringify({ format: "mqe-lessons-progress", exported: "x", progress: old }))).toBeNull();
    expect(store.get().derives).toEqual({});
  });

  it("stores a record under slug#stepId#n and round-trips it through storage and an export", () => {
    let t = 10;
    const storage = memoryStorage();
    const store = createProgressStore(storage, () => t++);
    expect(KEY).toBe("toy#5-deriving-2#0");
    store.recordDerive(KEY, { state: lines("a = b"), attempts: 2, hints: 1 });
    expect(store.get().derives[KEY]).toEqual({ state: { lines: ["a = b"], reached: 1, done: false }, result: "open", hints: 1, attempts: 2, at: 10 });
    expect(JSON.parse(storage.map.get(PROGRESS_KEY)!).derives[KEY].state.lines).toEqual(["a = b"]);

    const reread = createProgressStore(storage);
    expect(reread.get().derives).toEqual(store.get().derives);
    const imported = createProgressStore(memoryStorage());
    expect(imported.importJson(store.exportJson())).toBeNull();
    expect(imported.get().derives[KEY]).toEqual(store.get().derives[KEY]);
  });

  it("keeps fields a later write does not mention, and records justified questions", () => {
    const store = createProgressStore(memoryStorage(), () => 5);
    store.recordDerive(KEY, { state: lines("a = b"), attempts: 1 });
    store.recordDerive(KEY, { hints: 3 });
    store.recordDerive(KEY, { justified: [1], result: "done", state: { lines: ["a = b", "c = d"], reached: 2, done: true } });
    expect(store.get().derives[KEY]).toEqual({ state: { lines: ["a = b", "c = d"], reached: 2, done: true }, result: "done", justified: [1], hints: 3, attempts: 1, at: 5 });
  });

  it("never lets 'open' or a skip replace a result, and a finished exercise stays finished", () => {
    const store = createProgressStore(memoryStorage(), () => 1);
    store.recordDerive(KEY, { result: "skipped" });
    store.recordDerive(KEY, { state: lines("x = y"), result: "open" });
    expect(store.get().derives[KEY]).toMatchObject({ result: "skipped", state: { lines: ["x = y"] } });
    store.recordDerive(KEY, { result: "gave-up" });
    store.recordDerive(KEY, { result: "done" });
    store.recordDerive(KEY, { state: lines("changed") });
    expect(store.get().derives[KEY]).toMatchObject({ result: "gave-up", state: { lines: ["x = y"] } });
  });

  it("salvages: one bad record is dropped and backed up, the rest are kept", () => {
    const good = { state: { lines: [], reached: 0, done: false }, result: "skipped", hints: 0, attempts: 0, at: 1 };
    const file = { version: 1, steps: {}, notes: {}, checks: {}, checkpoints: {}, practice: {}, flags: {}, derives: { "a#s#0": good, "b#s#0": { result: "bogus" } } };
    const storage = memoryStorage({ [PROGRESS_KEY]: JSON.stringify(file) });
    const store = createProgressStore(storage);
    expect(Object.keys(store.get().derives)).toEqual(["a#s#0"]);
    expect(storage.map.get(PROGRESS_BACKUP_KEY)).toBe(JSON.stringify(file));
  });

  it("reset clears derives with the rest of the progress", () => {
    const store = createProgressStore(memoryStorage());
    store.recordDerive(KEY, { result: "skipped" });
    store.reset();
    expect(store.get().derives).toEqual({});
  });
});

describe("rubric grading", () => {
  const key = practiceKey("set", "q1");

  it("grades by the approved rule: all steps = got it, at least half = partly, fewer = not yet", () => {
    const store = createProgressStore(memoryStorage(), () => 7);
    const grade = (ticked: number[], total: number) => {
      store.gradePracticeRubric(key, ticked, total);
      return store.get().practice[key]!.grade;
    };
    expect(grade([0, 1, 2], 3)).toBe("got");
    expect(grade([0, 1], 3)).toBe("partly");
    expect(grade([2], 3)).toBe("notyet");
    expect(grade([], 3)).toBe("notyet");
    expect(grade([0], 2)).toBe("partly"); // exactly half
    expect(grade([1], 4)).toBe("notyet");
    expect(grade([1, 3], 4)).toBe("partly");
    expect(grade([0, 1, 2, 3], 4)).toBe("got");
  });

  it("keeps the ticked steps (sorted, unique, in range), the first grade, and the time", () => {
    let t = 1;
    const store = createProgressStore(memoryStorage(), () => t++);
    store.gradePracticeRubric(key, [2, 0, 0, 9, -1], 3);
    expect(store.get().practice[key]).toEqual({ grade: "partly", first: "partly", ticked: [0, 2], at: 1 });
    store.gradePracticeRubric(key, [0, 1, 2], 3);
    expect(store.get().practice[key]).toEqual({ grade: "got", first: "partly", ticked: [0, 1, 2], at: 2 });
  });

  it("round-trips through storage, and a plain self-grade drops the ticks", () => {
    const storage = memoryStorage();
    const store = createProgressStore(storage, () => 3);
    store.gradePracticeRubric(key, [1], 2);
    expect(createProgressStore(storage).get().practice[key]).toEqual({ grade: "partly", first: "partly", ticked: [1], at: 3 });
    store.gradePractice(key, "notyet");
    expect(store.get().practice[key]).toEqual({ grade: "notyet", first: "partly", at: 3 });
  });

  it("keeps old practice data valid: no ticks, two-valued grades", () => {
    const old = { version: 1, steps: {}, notes: {}, checks: {}, checkpoints: {}, practice: { "set#practice-q1": { grade: "notyet", first: "got", at: 4 } } };
    const store = createProgressStore(memoryStorage({ [PROGRESS_KEY]: JSON.stringify(old) }));
    expect(store.get().practice["set#practice-q1"]).toEqual({ grade: "notyet", first: "got", at: 4 });
  });
});

const meta = (slug: string, type: NoteMeta["type"], extra: Partial<NoteMeta> = {}): NoteMeta => ({
  slug, name: slug, title: slug, type, path: `${slug}.md`, summary: "", tags: [], aliases: [], requires: [], lessons: [], courses: [],
  edges: { out: [], in: [] }, figures: [], interactives: [], checks: 0, words: 0, created: "2026-10-01T00:00:00Z", updated: "2026-10-01T00:00:00Z", ...extra,
});
const index = {
  courses: [{ code: "Toy 101", id: "toy-101", hub: "toy-101", lectures: ["l1"], practice: ["set"], guides: [] }],
  notes: { "toy-101": meta("toy-101", "course"), l1: meta("l1", "lecture", { course: "Toy 101", lecture: 1 }), set: meta("set", "practice", { course: "Toy 101", lecture: 1 }) },
} as unknown as Index;

describe("dashboard with rubric grades", () => {
  it("lists a 'not yet' practice item for review, and a 'partly' one does not break it", () => {
    const data = emptyProgress();
    data.practice = {
      "set#practice-q1": { grade: "notyet", first: "notyet", ticked: [], at: 3 },
      "set#practice-q2": { grade: "partly", first: "partly", ticked: [0], at: 2 },
      "set#practice-q3": { grade: "got", first: "got", ticked: [0, 1], at: 1 },
    };
    data.derives = { "l1#s#0": { state: { lines: [], reached: 0, done: false }, result: "skipped", hints: 0, attempts: 0, at: 9 } };
    const d = buildDashboard(buildModel(index), data);
    // the skipped derivation is a review item too (see dashboard.test.ts), alongside the "Not yet" practice item
    expect(d.review.map((r) => r.key).sort()).toEqual(["l1#s#0", "set#practice-q1"]);
    expect(d.totals.practiced).toBe(3);
    expect(d.courses[0]!.practice.got).toBe(1);
  });
});
