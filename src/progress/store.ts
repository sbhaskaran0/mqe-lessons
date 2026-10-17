// Progress and settings, kept in localStorage. Every storage access is wrapped: private windows, full quotas
// and disabled storage fall back to memory, so the player still works for the session.
//
// Keys: steps are `slug#stepId`; check and checkpoint results are `slug#stepId#n`, n being the block's index in
// the step; practice grades are `slug#practice-<id>`. `notes` caches per-note totals so course and library pages
// show progress without loading bodies. `practice`, `flags`, `derives`, `leitner`, `confidence` and `exams` arrived
// after version 1 shipped: they are optional on disk and in exports (older files read as having none), so the version
// stays 1. Derivation exercises, Leitner entries and confidence ratings are keyed like checks (`slug#stepId#n`).
// A review of a derivation runs on a scratch record under `<key>#review` (see `reviewDeriveKey`), so the lesson's
// own record is not touched. Flags are keyed like checks
// (`slug#stepId#n`) and are the learner's notes to the author, not progress: `reset` and `resetNote` leave them alone.
import { z } from "zod";
import { enter, review, type Leitner } from "../review/leitner";

export type { Box, Leitner, LeitnerEntry } from "../review/leitner";

export type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

export type CheckResult = {
  result: "correct" | "incorrect" | "skipped";
  /** Chosen option indexes (mcq) or the number entered (numeric). */
  answer?: number[] | number;
  /** The first submitted attempt, kept when the learner tries again. */
  firstTry?: "correct" | "incorrect";
  /** The seed of the parameterized variant the learner answered (a `vary` check; absent on a plain check and
   *  on the base variant's first try), so a reload shows the same numbers. */
  seed?: number;
  tries: number;
  at: number;
};

export type CheckpointResult = {
  kind: "goal" | "predict";
  result: "met" | "correct" | "incorrect" | "committed" | "skipped";
  answer?: { option?: number; value?: number };
  /** The learner's own one-line reason for a prediction ("Why do you think so?"). Never graded. */
  explanation?: string;
  at: number;
};

/** The learner's own verdict on a practice question after seeing the worked answer. "partly" comes only from a rubric
 *  (at least half of the key steps ticked, not all). */
export type PracticeGrade = "got" | "partly" | "notyet";
export type PracticeResult = {
  grade: PracticeGrade;
  /** The first verdict, kept when the learner grades again: "not yet, then got it" is still worth knowing. */
  first: PracticeGrade;
  /** Rubric key steps the learner ticked (indexes into the item's `rubric`). Absent for a self-grade without a rubric. */
  ticked?: number[];
  at: number;
};

/** The learner's progress through one derivation exercise. `state` is the checker's plain-JSON state (the lines it
 *  accepted, the furthest milestone, done). `open` means the exercise is under way and does not open the gate. */
export type DeriveRecord = {
  state: { lines: string[]; reached: number; done: boolean };
  result: "open" | "done" | "gave-up" | "skipped";
  /** Indexes (into the block's steps) of the justify questions answered correctly. */
  justified?: number[];
  hints: number;
  attempts: number;
  at: number;
};

/** How sure the learner was before seeing the verdict: 1 guessing, 2 fairly sure, 3 certain. */
export type ConfidenceLevel = 1 | 2 | 3;
export type ConfidenceRating = { level: ConfidenceLevel; correct: boolean; at: number };

/** A mixed exam: the items asked, answers held back until the end, and the learner's confidence in each. */
export type ExamItem = { key: string; kind: "check" | "derive"; answer?: number[] | number | string; correct?: boolean; confidence?: ConfidenceLevel };
export type ExamRecord = { id: string; startedAt: number; finishedAt?: number; timerMin?: number; items: ExamItem[] };

/** Why a block was flagged. The labels are what the flag control shows and what an agent reading flags.json sees. */
export const FLAG_REASONS = ["Wrong maths", "Unclear", "Typo", "Other"] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

/** A learner's mark on one block. `excerpt` is a short plain-text snippet of the block, so the block can still be
 *  found when step ids shift after a re-export; `kind` is the block's type (prose, math, check, ...). */
export type Flag = {
  slug: string;
  stepId: string;
  block: number;
  kind: string;
  reason: FlagReason;
  note: string;
  at: number;
  excerpt: string;
};

export type NoteProgress = { total: number; seen: number; furthest: number; at: number };

export type ProgressData = {
  version: 1;
  steps: Record<string, number>;
  notes: Record<string, NoteProgress>;
  checks: Record<string, CheckResult>;
  checkpoints: Record<string, CheckpointResult>;
  practice: Record<string, PracticeResult>;
  flags: Record<string, Flag>;
  derives: Record<string, DeriveRecord>;
  /** Missed items scheduled to come back (spaced review), by block key. */
  leitner: Leitner;
  /** Every confidence rating given before a verdict, by block key, oldest first. */
  confidence: Record<string, ConfidenceRating[]>;
  exams: ExamRecord[];
  /** Per note slug, the interactive block keys (`blockKey`) whose widget the learner has seen live, not as a planned placeholder. */
  widgetsSeen: Record<string, string[]>;
  last?: { slug: string; stepId?: string; at: number };
};

export type Theme = "system" | "light" | "dark";
export type Settings = { theme: Theme; review: boolean; railOpen: boolean };

export const PROGRESS_KEY = "mqe-lessons/progress/1";
export const SETTINGS_KEY = "mqe-lessons/settings/1";
/** Where stored progress that could not be read in full is copied before anything overwrites it. */
export const PROGRESS_BACKUP_KEY = `${PROGRESS_KEY}.backup`;
const EXPORT_FORMAT = "mqe-lessons-progress";

const CheckResultSchema = z.object({
  result: z.enum(["correct", "incorrect", "skipped"]),
  answer: z.union([z.array(z.number().int()), z.number()]).optional(),
  firstTry: z.enum(["correct", "incorrect"]).optional(),
  seed: z.number().int().nonnegative().optional(),
  tries: z.number().int().nonnegative(),
  at: z.number(),
});
const CheckpointSchema = z.object({
  kind: z.enum(["goal", "predict"]),
  result: z.enum(["met", "correct", "incorrect", "committed", "skipped"]),
  answer: z.object({ option: z.number().optional(), value: z.number().optional() }).optional(),
  explanation: z.string().optional(),
  at: z.number(),
});
const PracticeSchema = z.object({
  grade: z.enum(["got", "partly", "notyet"]),
  first: z.enum(["got", "partly", "notyet"]),
  ticked: z.array(z.number().int().nonnegative()).optional(),
  at: z.number(),
});
const DeriveSchema = z.object({
  state: z.object({ lines: z.array(z.string()), reached: z.number().int().nonnegative(), done: z.boolean() }),
  result: z.enum(["open", "done", "gave-up", "skipped"]),
  justified: z.array(z.number().int().nonnegative()).optional(),
  hints: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  at: z.number(),
});
const LeitnerSchema = z.object({
  box: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  due: z.number(),
  lapses: z.number().int().nonnegative(),
  at: z.number(),
});
const ConfidenceLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const ConfidenceSchema = z.array(z.object({ level: ConfidenceLevelSchema, correct: z.boolean(), at: z.number() }));
const ExamSchema = z.object({
  id: z.string(),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  timerMin: z.number().optional(),
  items: z.array(
    z.object({
      key: z.string(),
      kind: z.enum(["check", "derive"]),
      answer: z.union([z.array(z.number().int()), z.number(), z.string()]).optional(),
      correct: z.boolean().optional(),
      confidence: ConfidenceLevelSchema.optional(),
    }),
  ),
});
const FlagSchema = z.object({
  slug: z.string(),
  stepId: z.string(),
  block: z.number().int().nonnegative(),
  kind: z.string(),
  reason: z.enum(FLAG_REASONS),
  note: z.string(),
  at: z.number(),
  excerpt: z.string(),
});
const NoteProgressSchema = z.object({ total: z.number().int(), seen: z.number().int(), furthest: z.number().int(), at: z.number() });
const LastSchema = z.object({ slug: z.string(), stepId: z.string().optional(), at: z.number() });
const ProgressSchema = z.object({
  version: z.literal(1),
  steps: z.record(z.string(), z.number()),
  notes: z.record(z.string(), NoteProgressSchema),
  checks: z.record(z.string(), CheckResultSchema),
  checkpoints: z.record(z.string(), CheckpointSchema),
  practice: z.record(z.string(), PracticeSchema).default({}),
  flags: z.record(z.string(), FlagSchema).default({}),
  derives: z.record(z.string(), DeriveSchema).default({}),
  leitner: z.record(z.string(), LeitnerSchema).default({}),
  confidence: z.record(z.string(), ConfidenceSchema).default({}),
  exams: z.array(ExamSchema).default([]),
  widgetsSeen: z.record(z.string(), z.array(z.string())).default({}),
  last: LastSchema.optional(),
});
const SettingsSchema = z.object({
  theme: z.enum(["system", "light", "dark"]).catch("system"),
  review: z.boolean().catch(false),
  railOpen: z.boolean().catch(true),
});
const ExportFile = z.object({ format: z.literal(EXPORT_FORMAT), exported: z.string(), progress: ProgressSchema });

export const emptyProgress = (): ProgressData => ({ version: 1, steps: {}, notes: {}, checks: {}, checkpoints: {}, practice: {}, flags: {}, derives: {}, leitner: {}, confidence: {}, exams: [], widgetsSeen: {} });
export const defaultSettings = (): Settings => ({ theme: "system", review: false, railOpen: true });

export const stepKey = (slug: string, stepId: string) => `${slug}#${stepId}`;
export const blockKey = (slug: string, stepId: string, block: number) => `${slug}#${stepId}#${block}`;
export const practiceKey = (slug: string, id: string) => `${slug}#practice-${id}`;
/** Where a review of a derivation keeps its work, apart from the lesson's own record of that block. */
export const REVIEW_SUFFIX = "#review";
export const reviewDeriveKey = (key: string) => `${key}${REVIEW_SUFFIX}`;

/** Wraps a Storage so no call can throw; after the first failure everything lives in memory. */
export function safeStorage(get: () => StorageLike | undefined): StorageLike {
  const memory = new Map<string, string>();
  let real: StorageLike | undefined;
  try {
    real = get();
  } catch {
    real = undefined;
  }
  const fallback = (key: string, value: string | null) => {
    real = undefined;
    if (value === null) memory.delete(key);
    else memory.set(key, value);
  };
  return {
    getItem(key) {
      if (real) {
        try {
          return real.getItem(key);
        } catch {
          real = undefined;
        }
      }
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      memory.set(key, value);
      if (!real) return;
      try {
        real.setItem(key, value);
      } catch {
        fallback(key, value);
      }
    },
    removeItem(key) {
      memory.delete(key);
      if (!real) return;
      try {
        real.removeItem(key);
      } catch {
        fallback(key, null);
      }
    },
  };
}

function read<T>(storage: StorageLike, key: string, schema: z.ZodType<T>, empty: () => T): T {
  const raw = storage.getItem(key);
  if (!raw) return empty();
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : empty();
  } catch {
    return empty();
  }
}

/** Keeps each record that validates and drops the rest, so one bad record costs one record, not the whole file.
 *  Returns null when the file is not progress at all (not an object, or another version). */
function salvageProgress(json: unknown): { data: ProgressData; dropped: number } | null {
  if (typeof json !== "object" || json === null || (json as { version?: unknown }).version !== 1) return null;
  const src = json as Record<string, unknown>;
  let dropped = 0;
  const keep = <T>(section: unknown, schema: z.ZodType<T>): Record<string, T> => {
    if (section === undefined) return {};
    if (typeof section !== "object" || section === null || Array.isArray(section)) {
      dropped++;
      return {};
    }
    const out: Record<string, T> = {};
    for (const [key, value] of Object.entries(section)) {
      const parsed = schema.safeParse(value);
      if (parsed.success) out[key] = parsed.data;
      else dropped++;
    }
    return out;
  };
  const keepList = <T>(section: unknown, schema: z.ZodType<T>): T[] => {
    if (section === undefined) return [];
    if (!Array.isArray(section)) {
      dropped++;
      return [];
    }
    return section.flatMap((value) => {
      const parsed = schema.safeParse(value);
      if (parsed.success) return [parsed.data];
      dropped++;
      return [];
    });
  };
  const data: ProgressData = {
    version: 1,
    steps: keep(src.steps, z.number()),
    notes: keep(src.notes, NoteProgressSchema),
    checks: keep(src.checks, CheckResultSchema),
    checkpoints: keep(src.checkpoints, CheckpointSchema),
    practice: keep(src.practice, PracticeSchema),
    flags: keep(src.flags, FlagSchema),
    derives: keep(src.derives, DeriveSchema),
    leitner: keep(src.leitner, LeitnerSchema),
    confidence: keep(src.confidence, ConfidenceSchema),
    exams: keepList(src.exams, ExamSchema),
    widgetsSeen: keep(src.widgetsSeen, z.array(z.string())),
  };
  if (src.last !== undefined) {
    const last = LastSchema.safeParse(src.last);
    if (last.success) data.last = last.data;
    else dropped++;
  }
  return { data, dropped };
}

/** Stored progress, as much of it as can be read. Whatever could not be read in full is first copied to the backup
 *  key, because the next commit writes the cleaned data over it; a later unreadable file replaces that copy. */
function loadProgress(storage: StorageLike): ProgressData {
  const raw = storage.getItem(PROGRESS_KEY);
  if (!raw) return emptyProgress();
  let salvaged: ReturnType<typeof salvageProgress> = null;
  try {
    salvaged = salvageProgress(JSON.parse(raw));
  } catch {
    // Not JSON: nothing to salvage, but still worth keeping.
  }
  if ((!salvaged || salvaged.dropped > 0) && storage.getItem(PROGRESS_BACKUP_KEY) !== raw) storage.setItem(PROGRESS_BACKUP_KEY, raw);
  return salvaged?.data ?? emptyProgress();
}

export type ProgressStore = ReturnType<typeof createProgressStore>;

export function createProgressStore(storage: StorageLike, now: () => number = () => Date.now()) {
  let data = loadProgress(storage);
  let settings = read(storage, SETTINGS_KEY, SettingsSchema, defaultSettings) as Settings;
  const listeners = new Set<() => void>();

  const emit = () => listeners.forEach((l) => l());
  const commit = (next: ProgressData) => {
    data = next;
    storage.setItem(PROGRESS_KEY, JSON.stringify(data));
    emit();
  };
  /** The schedule with `key` on it: added at box 1 if it was not, otherwise unchanged. */
  const schedule = (key: string): Leitner => {
    const prev = data.leitner[key];
    return prev ? data.leitner : { ...data.leitner, [key]: enter(prev, now()) };
  };
  const noteProgress = (steps: ProgressData["steps"], slug: string, stepIds: readonly string[], furthest: number): NoteProgress => ({
    total: stepIds.length,
    seen: stepIds.filter((id) => steps[stepKey(slug, id)] !== undefined).length,
    furthest,
    at: now(),
  });

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    get: () => data,
    settings: () => settings,

    /** A step became the active one. `stepIds` is every step of the note, in order. `keepLast` records the step as
     *  seen without making this note "where you left off" (a deep dive opened over another lesson). */
    markSeen(slug: string, stepIds: readonly string[], stepId: string, { keepLast = false } = {}) {
      const key = stepKey(slug, stepId);
      const isNew = data.steps[key] === undefined;
      const index = stepIds.indexOf(stepId);
      const prev = data.notes[slug];
      const furthest = Math.max(prev?.furthest ?? 0, index);
      const unchanged = !isNew && prev && prev.total === stepIds.length && prev.furthest === furthest;
      if (unchanged && (keepLast || (data.last?.slug === slug && data.last.stepId === stepId))) return;
      const steps = isNew ? { ...data.steps, [key]: now() } : data.steps;
      const notes = { ...data.notes, [slug]: noteProgress(steps, slug, stepIds, furthest) };
      commit(keepLast ? { ...data, steps, notes } : { ...data, steps, notes, last: { slug, stepId, at: now() } });
    },

    /** Progressive reveal reached step `index` (0-based). */
    reveal(slug: string, stepIds: readonly string[], index: number) {
      const prev = data.notes[slug];
      if (prev && prev.furthest >= index && prev.total === stepIds.length) return;
      commit({ ...data, notes: { ...data.notes, [slug]: noteProgress(data.steps, slug, stepIds, Math.max(prev?.furthest ?? 0, index)) } });
    },

    /** Opened a note without (yet) seeing a step: still "where you left off". */
    visit(slug: string) {
      if (data.last?.slug === slug) return;
      commit({ ...data, last: { slug, at: now() } });
    },

    recordCheck(key: string, result: "correct" | "incorrect" | "skipped", answer?: number[] | number, seed?: number) {
      const prev = data.checks[key];
      const next: CheckResult = { result, tries: (prev?.tries ?? 0) + (result === "skipped" ? 0 : 1), at: now() };
      if (answer !== undefined) next.answer = answer;
      if (seed !== undefined) next.seed = seed;
      const firstTry = prev?.firstTry ?? (result === "skipped" ? undefined : result);
      if (firstTry) next.firstTry = firstTry;
      commit({ ...data, checks: { ...data.checks, [key]: next }, ...(result === "incorrect" ? { leitner: schedule(key) } : {}) });
    },

    recordCheckpoint(key: string, result: CheckpointResult) {
      const prev = data.checkpoints[key];
      // A met goal stays met; a later skip of the same gate must not overwrite it.
      if (prev && prev.result !== "skipped" && result.result === "skipped") return;
      commit({ ...data, checkpoints: { ...data.checkpoints, [key]: result } });
    },

    /** Saves the learner's own reason for a prediction on the checkpoint record; ignored if there is no record yet or the
     *  text is unchanged. Blank text removes it. */
    recordExplanation(key: string, text: string) {
      const prev = data.checkpoints[key];
      if (!prev) return;
      const value = text.trim();
      if ((prev.explanation ?? "") === value) return;
      const { explanation: _old, ...rest } = prev;
      commit({ ...data, checkpoints: { ...data.checkpoints, [key]: value ? { ...rest, explanation: value } : rest } });
    },

    /** Records that these interactive blocks of a note showed their widget live. Idempotent union. */
    markWidgetsSeen(slug: string, keys: readonly string[]) {
      const prev = data.widgetsSeen[slug] ?? [];
      const add = keys.filter((k, i) => !prev.includes(k) && keys.indexOf(k) === i);
      if (!add.length) return;
      commit({ ...data, widgetsSeen: { ...data.widgetsSeen, [slug]: [...prev, ...add] } });
    },

    gradePractice(key: string, grade: PracticeGrade) {
      const prev = data.practice[key];
      // A plain self-grade replaces any rubric ticks: they described a different verdict.
      commit({ ...data, practice: { ...data.practice, [key]: { grade, first: prev?.first ?? grade, at: now() } } });
    },

    /** Grades a practice question from its rubric: every key step ticked is "got it", at least half "partly", fewer "not
     *  yet". `ticked` is kept so the checklist reopens as the learner left it. */
    gradePracticeRubric(key: string, ticked: readonly number[], total: number) {
      const steps = [...new Set(ticked)].filter((i) => Number.isInteger(i) && i >= 0 && i < total).sort((a, b) => a - b);
      const grade: PracticeGrade = total > 0 && steps.length === total ? "got" : total > 0 && steps.length * 2 >= total ? "partly" : "notyet";
      const prev = data.practice[key];
      commit({ ...data, practice: { ...data.practice, [key]: { grade, first: prev?.first ?? grade, ticked: steps, at: now() } } });
    },

    /** Forget a grade, so the question counts as untried again. */
    clearPractice(key: string) {
      if (!data.practice[key]) return;
      const { [key]: _gone, ...rest } = data.practice;
      commit({ ...data, practice: rest });
    },

    /** Saves a derivation exercise's progress. Fields not given keep their stored value; `hints` and `attempts` are
     *  totals the caller counts. "open" never replaces a result already stored (a skipped exercise stays skipped, so
     *  its gate stays open, until it is finished), and a finished exercise ("done" or "gave-up") is not changed. */
    recordDerive(key: string, patch: Partial<Omit<DeriveRecord, "at">>) {
      const prev = data.derives[key];
      if (prev && (prev.result === "done" || prev.result === "gave-up")) return;
      const result = !patch.result || patch.result === "open" ? (prev?.result ?? "open") : patch.result;
      const next: DeriveRecord = {
        state: patch.state ?? prev?.state ?? { lines: [], reached: 0, done: false },
        result,
        hints: patch.hints ?? prev?.hints ?? 0,
        attempts: patch.attempts ?? prev?.attempts ?? 0,
        at: now(),
      };
      const justified = patch.justified ?? prev?.justified;
      if (justified) next.justified = justified;
      const missed = (result === "gave-up" || result === "skipped") && !key.endsWith(REVIEW_SUFFIX);
      commit({ ...data, derives: { ...data.derives, [key]: next }, ...(missed ? { leitner: schedule(key) } : {}) });
    },

    /** A scheduled review of `key` was answered. Moves the item up a box, or back to box 1 with a lapse, or off the
     *  schedule after a correct answer in the last box. It never touches `checks` or `derives`: the lesson keeps what
     *  the learner first did there. Ignored for an item that is not scheduled. */
    recordReview(key: string, correct: boolean) {
      const prev = data.leitner[key];
      if (!prev) return;
      const next = review(prev, correct, now());
      const { [key]: _old, ...rest } = data.leitner;
      commit({ ...data, leitner: next ? { ...rest, [key]: next } : rest });
    },

    /** Puts a missed item on the schedule from outside a lesson (a mixed exam), leaving `checks` alone. Unchanged if
     *  it is already scheduled. */
    scheduleMiss(key: string) {
      if (data.leitner[key]) return;
      commit({ ...data, leitner: schedule(key) });
    },

    /** Takes an item off the schedule without a review (its block no longer exists in the lecture). */
    dropReview(key: string) {
      if (!data.leitner[key]) return;
      const { [key]: _gone, ...rest } = data.leitner;
      commit({ ...data, leitner: rest });
    },

    /** Forgets a derivation's scratch record (a review starts every derivation from nothing). */
    discardDerive(key: string) {
      if (!data.derives[key]) return;
      const { [key]: _gone, ...rest } = data.derives;
      commit({ ...data, derives: rest });
    },

    /** Appends how sure the learner was about `key` just before its verdict. */
    recordConfidence(key: string, level: ConfidenceLevel, correct: boolean) {
      commit({ ...data, confidence: { ...data.confidence, [key]: [...(data.confidence[key] ?? []), { level, correct, at: now() }] } });
    },

    /** Saves an exam, replacing the one with the same id. */
    saveExam(exam: ExamRecord) {
      const at = data.exams.findIndex((e) => e.id === exam.id);
      commit({ ...data, exams: at < 0 ? [...data.exams, exam] : data.exams.map((e, i) => (i === at ? exam : e)) });
    },

    /** Adds a flag, or replaces the one already on that block. `at` is stamped here. */
    setFlag(flag: Omit<Flag, "at">) {
      const key = blockKey(flag.slug, flag.stepId, flag.block);
      commit({ ...data, flags: { ...data.flags, [key]: { ...flag, at: now() } } });
    },

    removeFlag(key: string) {
      if (!data.flags[key]) return;
      const { [key]: _gone, ...rest } = data.flags;
      commit({ ...data, flags: rest });
    },

    setSettings(patch: Partial<Settings>) {
      settings = { ...settings, ...patch };
      storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      emit();
    },

    exportJson(): string {
      return JSON.stringify({ format: EXPORT_FORMAT, exported: new Date(now()).toISOString(), progress: data }, null, 2);
    },

    /** Replaces progress with an exported file's. Returns an error message, or null on success. */
    importJson(text: string): string | null {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return "That file is not JSON.";
      }
      const parsed = ExportFile.safeParse(json);
      if (!parsed.success) return "That file is not an MQE Lessons progress export.";
      commit(parsed.data.progress as ProgressData);
      return null;
    },

    reset() {
      commit({ ...emptyProgress(), flags: data.flags });
    },

    /** Starts one note over: forgets the steps seen and every check, checkpoint, derivation and live widget recorded
     *  in it, so it opens at step 1 with its gates closed. The spaced-review schedule, confidence ratings, exams,
     *  practice grades and flags are kept: they are history about the learner, not the lesson's state. A derivation's
     *  review scratch record (`#review`) belongs to the review page and is left alone too. */
    resetNote(slug: string) {
      const prefix = `${slug}#`;
      const inNote = (key: string) => key.startsWith(prefix) && !key.endsWith(REVIEW_SUFFIX);
      const drop = <T>(section: Record<string, T>) => Object.fromEntries(Object.entries(section).filter(([key]) => !inNote(key)));
      const { [slug]: _note, ...notes } = data.notes;
      const { [slug]: _seen, ...widgetsSeen } = data.widgetsSeen;
      commit({
        ...data,
        steps: drop(data.steps),
        notes,
        checks: drop(data.checks),
        checkpoints: drop(data.checkpoints),
        derives: drop(data.derives),
        widgetsSeen,
        ...(data.last?.slug === slug ? { last: { slug, at: now() } } : {}),
      });
    },

    /** Another tab wrote storage: pick its state up. */
    reload() {
      data = loadProgress(storage);
      settings = read(storage, SETTINGS_KEY, SettingsSchema, defaultSettings) as Settings;
      emit();
    },
  };
}

/** Fraction of a note's steps seen, 0 when it was never opened. */
export function noteFraction(data: ProgressData, slug: string): number {
  const n = data.notes[slug];
  return n && n.total > 0 ? Math.min(1, n.seen / n.total) : 0;
}
