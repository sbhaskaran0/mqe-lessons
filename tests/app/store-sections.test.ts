import { describe, expect, it } from "vitest";
import { blockKey, createProgressStore, emptyProgress, PROGRESS_KEY, type StorageLike } from "../../src/progress/store";

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe("widgetsSeen", () => {
  it("starts empty and is part of an empty progress", () => {
    expect(emptyProgress().widgetsSeen).toEqual({});
    expect(createProgressStore(memoryStorage()).get().widgetsSeen).toEqual({});
  });

  it("markWidgetsSeen is an idempotent union per note", () => {
    const storage = memoryStorage();
    const store = createProgressStore(storage);
    let emitted = 0;
    store.subscribe(() => emitted++);
    const a = blockKey("lec-1", "s1", 2);
    const b = blockKey("lec-1", "s2", 0);
    store.markWidgetsSeen("lec-1", [a]);
    store.markWidgetsSeen("lec-1", [a, b, b]);
    store.markWidgetsSeen("lec-1", [b]);
    store.markWidgetsSeen("lec-2", [a]);
    store.markWidgetsSeen("lec-2", []);
    expect(store.get().widgetsSeen).toEqual({ "lec-1": [a, b], "lec-2": [a] });
    expect(emitted).toBe(3);
    expect(createProgressStore(storage).get().widgetsSeen["lec-1"]).toEqual([a, b]);
  });

  it("an older file without the section reads as having none; a bad section is salvaged", () => {
    const storage = memoryStorage();
    const { widgetsSeen: _w, ...old } = emptyProgress();
    storage.setItem(PROGRESS_KEY, JSON.stringify(old));
    expect(createProgressStore(storage).get().widgetsSeen).toEqual({});
    storage.setItem(PROGRESS_KEY, JSON.stringify({ ...old, widgetsSeen: { good: ["k"], bad: "nope" } }));
    expect(createProgressStore(storage).get().widgetsSeen).toEqual({ good: ["k"] });
  });

  it("survives export and import, and a progress reset clears it", () => {
    const store = createProgressStore(memoryStorage());
    store.markWidgetsSeen("n", ["n#s#1"]);
    const text = store.exportJson();
    const other = createProgressStore(memoryStorage());
    expect(other.importJson(text)).toBeNull();
    expect(other.get().widgetsSeen).toEqual({ n: ["n#s#1"] });
    store.reset();
    expect(store.get().widgetsSeen).toEqual({});
  });
});

describe("predict explanation", () => {
  const key = "n#s#1#predict";
  const record = { kind: "predict", result: "incorrect", answer: { option: 1 }, at: 1 } as const;

  it("is stored on the checkpoint record, trimmed, and survives a reload", () => {
    const storage = memoryStorage();
    const store = createProgressStore(storage);
    store.recordCheckpoint(key, record);
    store.recordExplanation(key, "  because s is higher ");
    expect(store.get().checkpoints[key]).toEqual({ ...record, explanation: "because s is higher" });
    expect(createProgressStore(storage).get().checkpoints[key]?.explanation).toBe("because s is higher");
  });

  it("blank text removes it; a missing record is left alone", () => {
    const store = createProgressStore(memoryStorage());
    store.recordExplanation(key, "orphan");
    expect(store.get().checkpoints[key]).toBeUndefined();
    store.recordCheckpoint(key, record);
    store.recordExplanation(key, "x");
    store.recordExplanation(key, "   ");
    expect(store.get().checkpoints[key]).toEqual(record);
  });

  it("a record without one still validates on reload", () => {
    const storage = memoryStorage();
    const store = createProgressStore(storage);
    store.recordCheckpoint(key, record);
    expect(createProgressStore(storage).get().checkpoints[key]).toEqual(record);
  });
});
