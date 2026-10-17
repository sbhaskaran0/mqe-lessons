import { describe, expect, it } from "vitest";
import { blockKey, createProgressStore, noteFraction, PROGRESS_BACKUP_KEY, PROGRESS_KEY, safeStorage, SETTINGS_KEY, type StorageLike } from "../../src/progress/store";

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const IDS = ["intro-1", "definition-1", "depth-1", "depth-2"];

describe("progress store", () => {
  it("keys steps by slug#stepId and tracks per-note totals", () => {
    let t = 1000;
    const storage = memoryStorage();
    const store = createProgressStore(storage, () => t++);
    store.markSeen("solow-diagram", IDS, "intro-1");
    store.markSeen("solow-diagram", IDS, "definition-1");
    store.markSeen("solow-diagram", IDS, "definition-1");
    const data = store.get();
    expect(Object.keys(data.steps)).toEqual(["solow-diagram#intro-1", "solow-diagram#definition-1"]);
    expect(data.notes["solow-diagram"]).toMatchObject({ total: 4, seen: 2, furthest: 1 });
    expect(data.last).toMatchObject({ slug: "solow-diagram", stepId: "definition-1" });
    expect(noteFraction(data, "solow-diagram")).toBe(0.5);
    expect(noteFraction(data, "never-opened")).toBe(0);
    expect(JSON.parse(storage.map.get(PROGRESS_KEY)!)).toEqual(data);
  });

  it("remembers the furthest revealed step without lowering it", () => {
    const store = createProgressStore(memoryStorage());
    store.reveal("n", IDS, 2);
    store.reveal("n", IDS, 1);
    expect(store.get().notes.n!.furthest).toBe(2);
    store.markSeen("n", IDS, "intro-1");
    expect(store.get().notes.n!.furthest).toBe(2);
  });

  it("records check results, keeping the first attempt and counting tries", () => {
    const store = createProgressStore(memoryStorage());
    const key = blockKey("toy", "s-4", 0);
    expect(key).toBe("toy#s-4#0");
    store.recordCheck(key, "skipped");
    expect(store.get().checks[key]).toMatchObject({ result: "skipped", tries: 0 });
    expect(store.get().checks[key]!.firstTry).toBeUndefined();
    store.recordCheck(key, "incorrect", [0]);
    store.recordCheck(key, "correct", [1]);
    expect(store.get().checks[key]).toMatchObject({ result: "correct", firstTry: "incorrect", tries: 2, answer: [1] });
  });

  it("never lets a skip overwrite a met goal", () => {
    const store = createProgressStore(memoryStorage());
    store.recordCheckpoint("toy#s-3#1", { kind: "goal", result: "met", at: 1 });
    store.recordCheckpoint("toy#s-3#1", { kind: "goal", result: "skipped", at: 2 });
    expect(store.get().checkpoints["toy#s-3#1"]!.result).toBe("met");
  });

  it("round-trips export and import, and rejects foreign files", () => {
    const a = createProgressStore(memoryStorage());
    a.markSeen("n", IDS, "depth-1");
    a.recordCheck("n#depth-1#0", "correct", 25);
    const file = a.exportJson();
    const b = createProgressStore(memoryStorage());
    expect(b.importJson(file)).toBeNull();
    expect(b.get()).toEqual(a.get());
    expect(b.importJson("not json")).toBe("That file is not JSON.");
    expect(b.importJson(JSON.stringify({ format: "something-else" }))).toMatch(/not an MQE Lessons progress export/);
    expect(b.get()).toEqual(a.get());
  });

  it("resets progress but keeps settings", () => {
    const store = createProgressStore(memoryStorage());
    store.setSettings({ theme: "dark" });
    store.markSeen("n", IDS, "intro-1");
    store.reset();
    expect(store.get().steps).toEqual({});
    expect(store.settings().theme).toBe("dark");
  });

  it("starts one note over and leaves other notes and the learner's history alone", () => {
    const store = createProgressStore(memoryStorage());
    store.markSeen("other", IDS, "intro-1");
    store.recordCheck(blockKey("other", "intro-1", 0), "correct", [1]);
    store.markSeen("n", IDS, "intro-1");
    store.markSeen("n", IDS, "depth-1");
    const check = blockKey("n", "depth-1", 0);
    store.recordCheck(check, "incorrect", [0]);
    store.recordConfidence(check, 3, false);
    store.recordCheckpoint(blockKey("n", "depth-1", 1), { kind: "goal", result: "met", at: 1 });
    store.recordDerive(blockKey("n", "depth-2", 0), { result: "done" });
    store.recordDerive(`${blockKey("n", "depth-2", 0)}#review`, { result: "open" });
    store.markWidgetsSeen("n", [blockKey("n", "depth-1", 1)]);
    store.gradePractice("n#practice-q1", "got");
    store.setFlag({ slug: "n", stepId: "depth-1", block: 0, kind: "check", reason: "Typo", note: "", excerpt: "x" });

    store.resetNote("n");
    const data = store.get();
    expect(Object.keys(data.steps)).toEqual(["other#intro-1"]);
    expect(Object.keys(data.notes)).toEqual(["other"]);
    expect(Object.keys(data.checks)).toEqual([blockKey("other", "intro-1", 0)]);
    expect(data.checkpoints).toEqual({});
    expect(Object.keys(data.derives)).toEqual([`${blockKey("n", "depth-2", 0)}#review`]);
    expect(data.widgetsSeen).toEqual({});
    expect(data.last).toEqual({ slug: "n", at: expect.any(Number) });
    expect(noteFraction(data, "n")).toBe(0);
    // Kept: the review schedule, confidence, practice and flags.
    expect(Object.keys(data.leitner)).toEqual([check]);
    expect(data.confidence[check]).toHaveLength(1);
    expect(data.practice["n#practice-q1"]).toBeDefined();
    expect(Object.keys(data.flags)).toEqual([blockKey("n", "depth-1", 0)]);
  });

  it("notifies subscribers", () => {
    const store = createProgressStore(memoryStorage());
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.markSeen("n", IDS, "intro-1");
    store.setSettings({ review: true });
    off();
    store.markSeen("n", IDS, "depth-1");
    expect(calls).toBe(2);
  });

  it("starts empty from corrupt or mismatched storage, and keeps a copy of what it could not read", () => {
    const storage = memoryStorage();
    storage.map.set(PROGRESS_KEY, "{broken");
    storage.map.set(SETTINGS_KEY, JSON.stringify({ theme: "neon", review: true }));
    const store = createProgressStore(storage);
    expect(store.get().steps).toEqual({});
    expect(store.settings()).toEqual({ theme: "system", review: true, railOpen: true });
    // The next write replaces the progress key; the unreadable text must already be somewhere else.
    store.markSeen("n", IDS, "intro-1");
    expect(storage.map.get(PROGRESS_BACKUP_KEY)).toBe("{broken");
    expect(JSON.parse(storage.map.get(PROGRESS_KEY)!).steps).toHaveProperty(["n#intro-1"]);
  });

  it("drops only the invalid records, backs the file up, and keeps the rest", () => {
    const storage = memoryStorage();
    const good = { result: "correct", tries: 1, at: 5 };
    const raw = JSON.stringify({
      version: 1,
      steps: { "n#a": 10, "n#b": "yesterday" },
      notes: { n: { total: 4, seen: 1, furthest: 2, at: 9 }, m: { total: "many" } },
      checks: { "n#a#0": good, "n#b#0": { result: "maybe", tries: 1, at: 5 } },
      checkpoints: { "n#c#0": { kind: "goal", result: "met", at: 7 }, "n#d#0": { kind: "nope" } },
      practice: { "n#practice-1": { grade: "got", first: "got", at: 3 }, "n#practice-2": { grade: "meh" } },
      last: { slug: "n", stepId: "a", at: 11 },
    });
    storage.map.set(PROGRESS_KEY, raw);
    const data = createProgressStore(storage).get();
    expect(Object.keys(data.steps)).toEqual(["n#a"]);
    expect(Object.keys(data.notes)).toEqual(["n"]);
    expect(Object.keys(data.checks)).toEqual(["n#a#0"]);
    expect(Object.keys(data.checkpoints)).toEqual(["n#c#0"]);
    expect(Object.keys(data.practice)).toEqual(["n#practice-1"]);
    expect(data.last).toEqual({ slug: "n", stepId: "a", at: 11 });
    expect(storage.map.get(PROGRESS_BACKUP_KEY)).toBe(raw);
  });

  it("drops a malformed section or `last` without touching the other sections", () => {
    const storage = memoryStorage();
    storage.map.set(PROGRESS_KEY, JSON.stringify({ version: 1, steps: { "n#a": 1 }, notes: [], checks: {}, checkpoints: {}, last: { slug: 3 } }));
    const data = createProgressStore(storage).get();
    expect(data.steps).toEqual({ "n#a": 1 });
    expect(data.notes).toEqual({});
    expect(data.last).toBeUndefined();
    expect(storage.map.has(PROGRESS_BACKUP_KEY)).toBe(true);
  });

  it("treats another version's file as unreadable, but keeps it", () => {
    const storage = memoryStorage();
    const raw = JSON.stringify({ version: 2, steps: { "n#a": 1 } });
    storage.map.set(PROGRESS_KEY, raw);
    expect(createProgressStore(storage).get().steps).toEqual({});
    expect(storage.map.get(PROGRESS_BACKUP_KEY)).toBe(raw);
  });

  it("writes no backup when everything is valid, and none for an older file without `practice`", () => {
    const storage = memoryStorage();
    const first = createProgressStore(storage);
    first.markSeen("n", IDS, "intro-1");
    first.gradePractice("n#practice-1", "got");
    const older = JSON.parse(storage.map.get(PROGRESS_KEY)!);
    delete older.practice;
    storage.map.set(PROGRESS_KEY, JSON.stringify(older));
    const store = createProgressStore(storage);
    expect(store.get().steps).toHaveProperty(["n#intro-1"]);
    expect(store.get().practice).toEqual({});
    expect(storage.map.has(PROGRESS_BACKUP_KEY)).toBe(false);
  });

  it("another tab's partly bad write is salvaged on reload", () => {
    const storage = memoryStorage();
    const store = createProgressStore(storage);
    storage.map.set(PROGRESS_KEY, JSON.stringify({ version: 1, steps: { "n#a": 1, "n#b": null }, notes: {}, checks: {}, checkpoints: {} }));
    store.reload();
    expect(store.get().steps).toEqual({ "n#a": 1 });
    expect(storage.map.has(PROGRESS_BACKUP_KEY)).toBe(true);
  });

  it("keepLast records a step as seen without making the note where you left off", () => {
    const store = createProgressStore(memoryStorage());
    store.markSeen("lesson", IDS, "depth-1");
    store.markSeen("dive", ["d-1", "d-2"], "d-2", { keepLast: true });
    expect(store.get().steps).toHaveProperty(["dive#d-2"]);
    expect(store.get().notes.dive).toMatchObject({ total: 2, seen: 1, furthest: 1 });
    expect(store.get().last).toMatchObject({ slug: "lesson", stepId: "depth-1" });
    // Repeating it is a no-op, as it is for a normal markSeen.
    let calls = 0;
    store.subscribe(() => calls++);
    store.markSeen("dive", ["d-1", "d-2"], "d-2", { keepLast: true });
    expect(calls).toBe(0);
  });
});

describe("safeStorage", () => {
  it("falls back to memory when storage throws", () => {
    const storage = safeStorage(() => throwing);
    expect(storage.getItem("k")).toBeNull();
    storage.setItem("k", "v");
    expect(storage.getItem("k")).toBe("v");
    storage.removeItem("k");
    expect(storage.getItem("k")).toBeNull();
  });

  it("falls back when storage cannot even be reached", () => {
    const storage = safeStorage(() => {
      throw new Error("no localStorage here");
    });
    storage.setItem("k", "v");
    expect(storage.getItem("k")).toBe("v");
  });

  it("keeps a working store on top of failing storage", () => {
    const store = createProgressStore(safeStorage(() => throwing));
    store.markSeen("n", IDS, "intro-1");
    expect(store.get().notes.n!.seen).toBe(1);
  });

  it("writes through to real storage while it works", () => {
    const real = memoryStorage();
    const storage = safeStorage(() => real);
    storage.setItem("k", "v");
    expect(real.map.get("k")).toBe("v");
  });
});
