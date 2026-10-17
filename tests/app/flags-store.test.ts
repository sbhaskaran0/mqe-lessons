import { describe, expect, it } from "vitest";
import { blockKey, createProgressStore, PROGRESS_BACKUP_KEY, PROGRESS_KEY, type StorageLike } from "../../src/progress/store";

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

const flag = { slug: "solow", stepId: "def-1", block: 2, kind: "math", reason: "Wrong maths", note: "sign?", excerpt: "k_{t+1} = ..." } as const;
const KEY = blockKey("solow", "def-1", 2);

describe("flags in the progress store", () => {
  it("adds a flag under slug#stepId#block, stamps the time, and replaces it on a second flag", () => {
    let t = 500;
    const store = createProgressStore(memoryStorage(), () => t++);
    expect(store.get().flags).toEqual({});
    store.setFlag(flag);
    expect(Object.keys(store.get().flags)).toEqual(["solow#def-1#2"]);
    expect(store.get().flags[KEY]).toEqual({ ...flag, at: 500 });
    store.setFlag({ ...flag, reason: "Typo", note: "" });
    expect(Object.keys(store.get().flags)).toHaveLength(1);
    expect(store.get().flags[KEY]).toMatchObject({ reason: "Typo", note: "", at: 501 });
  });

  it("removes a flag, notifies, and ignores a key it does not have", () => {
    const store = createProgressStore(memoryStorage());
    let calls = 0;
    store.subscribe(() => calls++);
    store.setFlag(flag);
    store.removeFlag(KEY);
    store.removeFlag(KEY);
    expect(store.get().flags).toEqual({});
    expect(calls).toBe(2);
  });

  it("persists, and reads progress saved before flags existed as having none", () => {
    const storage = memoryStorage();
    createProgressStore(storage).setFlag(flag);
    expect(createProgressStore(storage).get().flags[KEY]).toMatchObject(flag);

    const old = { version: 1, steps: { "n#a": 1 }, notes: {}, checks: {}, checkpoints: {} };
    const legacy = memoryStorage();
    legacy.setItem(PROGRESS_KEY, JSON.stringify(old));
    const store = createProgressStore(legacy);
    expect(store.get().flags).toEqual({});
    expect(store.get().steps).toEqual({ "n#a": 1 });
    expect(legacy.map.has(PROGRESS_BACKUP_KEY)).toBe(false);
  });

  it("salvages valid flags from a damaged file and backs the original up", () => {
    const storage = memoryStorage();
    const raw = JSON.stringify({
      version: 1, steps: {}, notes: {}, checks: {}, checkpoints: {},
      flags: { [KEY]: { ...flag, at: 7 }, bad: { slug: "x" }, worse: { ...flag, at: 1, reason: "Not a reason" } },
    });
    storage.setItem(PROGRESS_KEY, raw);
    const store = createProgressStore(storage);
    expect(Object.keys(store.get().flags)).toEqual([KEY]);
    expect(storage.map.get(PROGRESS_BACKUP_KEY)).toBe(raw);
  });

  it("travels in the export and import", () => {
    const a = createProgressStore(memoryStorage());
    a.setFlag(flag);
    const file = a.exportJson();
    expect(JSON.parse(file).progress.flags[KEY]).toMatchObject(flag);
    const b = createProgressStore(memoryStorage());
    expect(b.importJson(file)).toBeNull();
    expect(b.get().flags).toEqual(a.get().flags);
    // An export from before flags existed imports with none.
    const { flags: _flags, ...bare } = JSON.parse(file).progress;
    expect(b.importJson(JSON.stringify({ format: "mqe-lessons-progress", exported: "x", progress: bare }))).toBeNull();
    expect(b.get().flags).toEqual({});
  });

  it("keeps flags when progress is reset: they are notes to the author, not progress", () => {
    const store = createProgressStore(memoryStorage());
    store.markSeen("solow", ["def-1"], "def-1");
    store.setFlag(flag);
    store.reset();
    expect(store.get().steps).toEqual({});
    expect(store.get().flags[KEY]).toMatchObject(flag);
  });
});
