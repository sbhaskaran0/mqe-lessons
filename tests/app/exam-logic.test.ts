// The mixed exam's pure parts: the draw (interleaving, seeding), grading, the breakdown by objective.
import { describe, expect, it } from "vitest";
import type { NoteBody, NoteMeta } from "../../src/ir";
import { breakdownByObjective, clock, drawExam, examId, examSeed, isCorrect, parseNumber, poolOf, questionsOf, remainingMs, scoreOf, variantSeed, type PoolItem, type Question } from "../../src/exam/logic";

const items = (slug: string, n: number): PoolItem[] => Array.from({ length: n }, (_, i) => ({ key: `${slug}#s-1#${i}`, slug, stepId: "s-1", block: i }));
const adjacent = (xs: PoolItem[]) => xs.filter((x, i) => i > 0 && xs[i - 1]!.slug === x.slug).length;

describe("drawExam", () => {
  it("never puts two items of one lecture side by side when it can avoid it", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const pool = [...items("a", 6), ...items("b", 4), ...items("c", 2)];
      for (const count of [3, 6, 8, 12]) expect(adjacent(drawExam(pool, count, seed)), `seed ${seed}, ${count}`).toBe(0);
    }
  });

  it("is as interleaved as the draw allows when one lecture dominates, and plain with a single lecture", () => {
    const lopsided = drawExam([...items("a", 8), ...items("b", 2)], 10, 7);
    // 8 of 10 from one lecture cannot be fully apart: the minimum is 8 - 3 = 5 neighbours.
    expect(adjacent(lopsided)).toBe(5);
    expect(drawExam(items("a", 3), 3, 1).map((x) => x.slug)).toEqual(["a", "a", "a"]);
  });

  it("is reproducible from the seed, and a different seed gives a different exam", () => {
    const pool = [...items("a", 6), ...items("b", 6), ...items("c", 6)];
    const key = (seed: number) => drawExam(pool, 9, seed).map((x) => x.key).join();
    expect(key(42)).toBe(key(42));
    expect(new Set([1, 2, 3, 4, 5, 6].map(key)).size).toBeGreaterThan(1);
  });

  it("draws without repeats, spreads across lectures, and caps at the pool size", () => {
    const pool = [...items("a", 10), ...items("b", 2)];
    const drawn = drawExam(pool, 4, 3);
    expect(new Set(drawn.map((x) => x.key)).size).toBe(4);
    expect(drawn.filter((x) => x.slug === "b")).toHaveLength(2);
    expect(drawExam(pool, 99, 3)).toHaveLength(12);
    expect(drawExam(pool, 0, 3)).toEqual([]);
  });
});

describe("exam ids and variant seeds", () => {
  it("carries the seed in the id", () => {
    expect(examSeed(examId(123456789))).toBe(123456789);
    expect(examSeed("!!")).toBe(1);
  });
  it("derives a stable nonzero variant seed per exam and item", () => {
    const a = variantSeed("exam-abc", "l1#s-1#0");
    expect(a).toBe(variantSeed("exam-abc", "l1#s-1#0"));
    expect(a).not.toBe(variantSeed("exam-abc", "l1#s-1#1"));
    expect(a).not.toBe(variantSeed("exam-abd", "l1#s-1#0"));
    expect(a).toBeGreaterThan(0);
  });
});

const body = {
  slug: "l1",
  notation: [],
  sections: [{ id: "s", heading: "H", steps: [{ id: "s-1", blocks: [
    { t: "prose", md: "x" },
    { t: "check", kind: "mcq", prompt: "q", options: [{ md: "a", correct: true }, { md: "b", correct: false }], why: "w", objectives: [1] },
    { t: "derive", title: "d", steps: [] },
    { t: "check", kind: "numeric", prompt: "n", answer: 10, tol: 0.5, why: "w" },
  ] }] }],
} as unknown as NoteBody;

describe("poolOf and questionsOf", () => {
  it("takes only the checks, with block indexes", () => {
    expect(poolOf("l1", body).map((p) => p.key)).toEqual(["l1#s-1#1", "l1#s-1#3"]);
  });
  it("drops an item whose block is gone and keeps the order", async () => {
    const exam = { id: "exam-1", startedAt: 0, items: [{ key: "l1#s-1#3", kind: "check" as const }, { key: "l1#s-1#2", kind: "check" as const }, { key: "l1#s-1#1", kind: "check" as const }] };
    const qs = await questionsOf(exam, new Map([["l1", body]]));
    expect(qs.map((q) => [q.key, q.objectives])).toEqual([["l1#s-1#3", []], ["l1#s-1#1", [1]]]);
  });
});

describe("varied checks", () => {
  const varied = {
    t: "check", kind: "numeric", prompt: "With $s = 0.3$ and $A = 1$, what is $x$?", answer: 0.3, tol: 0.003, why: "w",
    vary: [{ sym: "s", lo: 0.1, hi: 0.9, step: 0.1 }], compute: "sA",
    bindings: [{ sym: "s", value: 0.3, span: "$s = 0.3$" }, { sym: "A", value: 1, span: "$A = 1$" }],
  };
  const vbody = { slug: "l1", notation: [], sections: [{ id: "s", heading: "", steps: [{ id: "s-1", blocks: [varied] }] }] } as unknown as NoteBody;
  const exam = (id: string) => ({ id, startedAt: 0, items: [{ key: "l1#s-1#0", kind: "check" as const }] });

  it("draws a variant from the exam id, the same one every time, and a different one for another exam", async () => {
    const prompts = async (id: string) => (await questionsOf(exam(id), new Map([["l1", vbody]])))[0]!.prompt;
    expect(await prompts("exam-aaa")).toBe(await prompts("exam-aaa"));
    const all = new Set(await Promise.all(["exam-a", "exam-b", "exam-c", "exam-d", "exam-e", "exam-f"].map(prompts)));
    expect(all.size).toBeGreaterThan(1);
  });
  it("grades against the variant's answer", async () => {
    const [q] = await questionsOf(exam("exam-b"), new Map([["l1", vbody]]));
    expect(q!.kind === "numeric" && isCorrect(q!, q!.answer)).toBe(true);
  });
});

describe("grading", () => {
  const mcq: Question = { key: "k", slug: "l1", stepId: "s", block: 0, objectives: [], prompt: "", why: "", kind: "mcq", options: [{ md: "a", correct: true }, { md: "b", correct: false }, { md: "c", correct: true }] };
  const num: Question = { key: "k", slug: "l1", stepId: "s", block: 0, objectives: [], prompt: "", why: "", kind: "numeric", answer: 25, tol: 0.5, wrong: [] };
  it("needs every right option and no other", () => {
    expect(isCorrect(mcq, [0, 2])).toBe(true);
    expect(isCorrect(mcq, [0])).toBe(false);
    expect(isCorrect(mcq, [0, 1, 2])).toBe(false);
  });
  it("accepts a number within tolerance; skipped and unreached are wrong", () => {
    expect(isCorrect(num, 25.4)).toBe(true);
    expect(isCorrect(num, 26)).toBe(false);
    expect(isCorrect(num, "")).toBe(false);
    expect(isCorrect(num, undefined)).toBe(false);
    expect(isCorrect(mcq, "")).toBe(false);
  });
  it("reads numbers like the lesson does", () => {
    expect(parseNumber("1,000")).toBe(1000);
    expect(parseNumber("1/4")).toBe(0.25);
    expect(parseNumber("−3")).toBe(-3);
    expect(parseNumber("abc")).toBeUndefined();
  });
  it("scores the stored items", () => {
    const exam = { id: "e", startedAt: 0, items: [{ key: "a", kind: "check" as const, correct: true }, { key: "b", kind: "check" as const, correct: false }, { key: "c", kind: "check" as const, correct: true }] };
    expect(scoreOf(exam)).toEqual({ right: 2, total: 3, pct: 67 });
  });
});

describe("breakdownByObjective", () => {
  const meta = (slug: string, title: string, objectives?: NoteMeta["objectives"]) => ({ slug, title, objectives }) as NoteMeta;
  const metas: Record<string, NoteMeta> = {
    a: meta("a", "Alpha", [{ n: 1, md: "Derive the steady state", tested: 2 }, { n: 2, md: "Read the plot", tested: 1 }]),
    b: meta("b", "Beta"),
  };
  const q = (key: string, slug: string, objectives: number[]): Question => ({ key, slug, stepId: "s", block: 0, objectives, prompt: "", why: "", kind: "numeric", answer: 0, tol: 0, wrong: [] });
  const questions = [q("a1", "a", [1]), q("a2", "a", [1]), q("a3", "a", [1, 2]), q("a4", "a", []), q("b1", "b", []), q("b2", "b", [3])];
  const rows = breakdownByObjective(questions, (k) => ["a1", "a3", "b2"].includes(k), (s) => metas[s]);

  it("counts per lecture objective, an item with two tags in both, and names the objective from the lecture", () => {
    expect(rows.filter((r) => r.slug === "a" && r.n !== null).map((r) => [r.n, r.md, r.asked, r.right])).toEqual([[1, "Derive the steady state", 3, 2], [2, "Read the plot", 1, 1]]);
  });
  it("puts items without a tag under untagged, per lecture, after the tagged rows", () => {
    expect(rows.filter((r) => r.n === null).map((r) => [r.lecture, r.md, r.asked, r.right])).toEqual([["Alpha", "Untagged", 1, 0], ["Beta", "Untagged", 1, 0]]);
    expect(rows.map((r) => `${r.lecture}:${r.n}`)).toEqual(["Alpha:1", "Alpha:2", "Alpha:null", "Beta:3", "Beta:null"]);
  });
  it("falls back to a plain label when the lecture lists no such objective", () => {
    expect(rows.find((r) => r.slug === "b" && r.n === 3)!.md).toBe("Objective 3");
  });
});

describe("timer helpers", () => {
  it("counts down to the deadline, and never for an untimed exam", () => {
    const exam = { id: "e", startedAt: 1000, timerMin: 10, items: [] };
    expect(remainingMs(exam, 1000 + 60_000)).toBe(9 * 60_000);
    expect(remainingMs({ ...exam, timerMin: undefined }, 1e12)).toBe(Infinity);
    expect(clock(9 * 60_000 + 1)).toBe("9:01");
    expect(clock(-5)).toBe("0:00");
  });
});
