// Mixed exam, the parts that need no React: which checkpoints can be asked, how a seeded draw interleaves them, how an
// answer is graded and how the result splits by lecture objective. Pure, so tests do not need the page.
//
// An exam is stored as an ExamRecord (see progress/store.ts), which has no seed field. The seed travels in the
// exam's id (`exam-<seed in base 36>`), and a varied numeric check's variant seed is derived from the id and the
// item's key, so a reload asks the very same questions with the very same numbers.
import type { Block, NoteBody, NoteMeta } from "../ir";
import { blockKey, type ExamItem, type ExamRecord } from "../progress/store";

type CheckBlock = Extract<Block, { t: "check" }>;

export const EXAM_DEFAULT_COUNT = 10;
export const EXAM_TIMER_CHOICES = [10, 20, 30] as const;

/** One question as the exam shows it. A varied numeric check arrives already instantiated. */
export type Question = {
  key: string;
  slug: string;
  stepId: string;
  /** Index of the block in its step. */
  block: number;
  /** 1-based into the lecture's `NoteMeta.objectives`. */
  objectives: readonly number[];
  prompt: string;
  why: string;
} & (
  | { kind: "mcq"; options: { md: string; correct: boolean; feedback?: string | undefined }[] }
  | { kind: "numeric"; answer: number; tol: number; wrong: { answer: number; tol: number; md: string }[] }
);

export type PoolItem = { key: string; slug: string; stepId: string; block: number };

/** The checks (multiple choice and numeric) of a lecture, in reading order. Derivations, predictions and goals are not asked. */
export function poolOf(slug: string, body: NoteBody): PoolItem[] {
  const out: PoolItem[] = [];
  for (const section of body.sections) {
    for (const step of section.steps) {
      step.blocks.forEach((b, i) => {
        if (b.t === "check") out.push({ key: blockKey(slug, step.id, i), slug, stepId: step.id, block: i });
      });
    }
  }
  return out;
}

/** mulberry32. Local rather than src/derive's `rng`, so the exam does not load the derivation checker for it. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shuffled = <T>(xs: readonly T[], next: () => number): T[] => {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

/** `count` items from the pool, spread over its lectures and ordered so that no two in a row come from the same
 *  lecture unless the draw leaves no choice (one lecture, or one lecture holding more than half of the draw).
 *  Selection takes one item per lecture in turn (lectures and items shuffled by the seed), so a lecture with many
 *  checks does not crowd out the others. Ordering then always takes from the lecture with most items left that
 *  is not the one just used, which avoids neighbours whenever any arrangement can. */
export function drawExam(pool: readonly PoolItem[], count: number, seed: number): PoolItem[] {
  const next = seeded(seed);
  const byLecture = new Map<string, PoolItem[]>();
  for (const item of pool) byLecture.set(item.slug, [...(byLecture.get(item.slug) ?? []), item]);
  const lectures = shuffled([...byLecture.keys()].sort(), next);
  const queues = new Map(lectures.map((l) => [l, shuffled(byLecture.get(l)!, next)]));
  const chosen = new Map<string, PoolItem[]>(lectures.map((l) => [l, []]));
  const want = Math.min(Math.max(0, Math.floor(count)), pool.length);
  let taken = 0;
  while (taken < want) {
    for (const l of lectures) {
      const item = queues.get(l)!.shift();
      if (!item || taken >= want) continue;
      chosen.get(l)!.push(item);
      taken++;
    }
  }
  const out: PoolItem[] = [];
  let last: string | undefined;
  for (let i = 0; i < want; i++) {
    const open = lectures.filter((l) => chosen.get(l)!.length > 0);
    const apart = open.filter((l) => l !== last);
    const from = apart.length ? apart : open;
    // Most left first (ties keep the shuffled lecture order), so no lecture is left over as a run at the end.
    const l = from.reduce((best, cur) => (chosen.get(cur)!.length > chosen.get(best)!.length ? cur : best));
    out.push(chosen.get(l)!.shift()!);
    last = l;
  }
  return out;
}

export const newExamSeed = () => (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0 || 1;
export const examId = (seed: number) => `exam-${(seed >>> 0).toString(36)}`;

/** The seed an exam id carries, 1 when the id is not one of ours. */
export function examSeed(id: string): number {
  const n = parseInt(id.replace(/^exam-/, ""), 36);
  return Number.isFinite(n) && n > 0 ? n >>> 0 : 1;
}

/** Variant seed for an item, from the exam and the item alone. Never 0, which means the base variant. */
export function variantSeed(id: string, key: string): number {
  let h = examSeed(id) ^ 0x9e3779b9;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return (h >>> 0) || 1;
}

type Params = typeof import("../params");

/** The questions of an exam, in its order. An item whose block is no longer a check (the lecture changed) is left
 *  out. `params` is loaded here, and only when a drawn item has `vary`. */
export async function questionsOf(exam: ExamRecord, bodies: ReadonlyMap<string, NoteBody>): Promise<Question[]> {
  const found: { item: ExamItem; slug: string; stepId: string; block: number; check: CheckBlock }[] = [];
  for (const item of exam.items) {
    const m = /^([a-z0-9-]+)#(.+)#(\d+)$/.exec(item.key);
    if (!m) continue;
    const slug = m[1]!;
    const stepId = m[2]!;
    const index = Number(m[3]);
    const step = bodies.get(slug)?.sections.flatMap((s) => s.steps).find((s) => s.id === stepId);
    const block = step?.blocks[index];
    if (block?.t === "check") found.push({ item, slug, stepId, block: index, check: block });
  }
  let params: Params | undefined;
  if (found.some((f) => f.check.kind === "numeric" && f.check.vary?.length)) params = await import("../params");
  return found.map(({ item, slug, stepId, block, check }): Question => {
    const base = { key: item.key, slug, stepId, block, objectives: check.objectives ?? [] };
    if (check.kind === "mcq") return { ...base, kind: "mcq", prompt: check.prompt, why: check.why, options: check.options };
    if (params && params.isVaried(check)) {
      const v = params.instantiate(check, variantSeed(exam.id, item.key));
      return { ...base, kind: "numeric", prompt: v.prompt, why: v.why, answer: v.answer, tol: v.tol, wrong: v.wrong };
    }
    return { ...base, kind: "numeric", prompt: check.prompt, why: check.why, answer: check.answer, tol: check.tol, wrong: check.wrong ?? [] };
  });
}

/** Accepts 25, 25.0, −3 (Unicode minus), 1,000, 1e-3 and simple fractions like 1/3. The lesson's check reads numbers the
 *  same way; this copy exists because the exam does not import Check.tsx. */
export function parseNumber(raw: string): number | undefined {
  const s = raw.trim().replace(/[−–]/g, "-").replace(/,/g, "").replace(/\s+/g, "");
  if (!s) return undefined;
  const frac = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s);
  if (frac) {
    const d = Number(frac[2]);
    return d === 0 ? undefined : Number(frac[1]) / d;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export const withinTolerance = (value: number, answer: number, tol: number) => Math.abs(value - answer) <= tol + 1e-9 * Math.max(1, Math.abs(answer));

export const formatNumber = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(10))));

/** Stored answer: chosen option indexes, a number, "" for a skipped item, undefined for one not reached. */
export type StoredAnswer = ExamItem["answer"];

/** An unanswered or skipped item is wrong. */
export function isCorrect(q: Question, answer: StoredAnswer): boolean {
  if (q.kind === "mcq") return Array.isArray(answer) && answer.length > 0 && q.options.every((o, i) => o.correct === answer.includes(i));
  return typeof answer === "number" && withinTolerance(answer, q.answer, q.tol);
}

export const isAnswered = (answer: StoredAnswer) => answer !== undefined && answer !== "";

export type ObjectiveRow = {
  slug: string;
  lecture: string;
  /** Null for the items without an objective tag. */
  n: number | null;
  md: string;
  asked: number;
  right: number;
};

/** Result by objective: one row per lecture objective that an asked item is tagged with (an item tagged with two
 *  counts in both), then one "untagged" row per lecture for the items with no tag. */
export function breakdownByObjective(questions: readonly Question[], correct: (key: string) => boolean, metaOf: (slug: string) => NoteMeta | undefined): ObjectiveRow[] {
  const rows = new Map<string, ObjectiveRow>();
  for (const q of questions) {
    const meta = metaOf(q.slug);
    const lecture = meta?.title ?? q.slug;
    const tags: (number | null)[] = q.objectives.length ? [...q.objectives] : [null];
    for (const n of tags) {
      const id = `${q.slug}#${n ?? "untagged"}`;
      const md = n === null ? "Untagged" : (meta?.objectives?.find((o) => o.n === n)?.md ?? `Objective ${n}`);
      const row = rows.get(id) ?? { slug: q.slug, lecture, n, md, asked: 0, right: 0 };
      row.asked++;
      if (correct(q.key)) row.right++;
      rows.set(id, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.lecture.localeCompare(b.lecture) || (a.n ?? Infinity) - (b.n ?? Infinity));
}

export function scoreOf(exam: ExamRecord) {
  const total = exam.items.length;
  const right = exam.items.filter((i) => i.correct).length;
  return { right, total, pct: total ? Math.round((right / total) * 100) : 0 };
}

export const remainingMs = (exam: ExamRecord, now: number) => (exam.timerMin ? exam.startedAt + exam.timerMin * 60_000 - now : Infinity);

export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
