// The progress dashboard's numbers, computed from the progress store and the index alone (no note bodies): per course
// the lectures' share of steps seen, checkpoint and goal results, practice grades; the review queue (checks answered
// wrong or skipped, skipped goals, derivations skipped or given up, interactives that arrived in a lecture the learner
// has read, practice marked "Not yet"); the spaced-review items due today; and recent activity per note.
import { href } from "../app/router";
import { courseOf, lecturesOf, noteHref, type Model } from "../content/model";
import type { Course, NoteBody, NoteMeta } from "../ir";
import { flattenSteps } from "../lesson/steps";
import { dueEntries, nextDue, type LeitnerEntry } from "../review/leitner";
import { blockKey, noteFraction, type ConfidenceLevel, type ProgressData } from "./store";

export type CheckTally = { correct: number; wrong: number; skipped: number; /** Checks in the course's notes not yet answered or skipped. */ open: number };

export type CourseSummary = {
  course: Course;
  lectures: { meta: NoteMeta; fraction: number; seen: number; total: number }[];
  /** Mean of the lectures' fractions seen. */
  fraction: number;
  checks: CheckTally;
  goals: { met: number; skipped: number };
  predictions: { right: number; wrong: number };
  practice: { got: number; notYet: number; sets: NoteMeta[] };
  /** Anything recorded at all for this course. */
  started: boolean;
};

type ReviewBase = { key: string; slug: string; meta: NoteMeta; at: number; href: string };
export type ReviewItem =
  | (ReviewBase & { kind: "check"; stepId: string; block: number; result: "incorrect" | "skipped" })
  | (ReviewBase & { kind: "goal"; stepId: string; block: number; result: "skipped" })
  | (ReviewBase & { kind: "derive"; stepId: string; block: number; result: "skipped" | "gave-up" })
  /** A live interactive at or before the learner's furthest step that they have not seen run. */
  | (ReviewBase & { kind: "interactive"; stepId: string; block: number; result: "new" })
  | (ReviewBase & { kind: "practice"; id: string });

export type Activity = { meta: NoteMeta; at: number; seen: number; total: number; checks: number; practice: number };

/** Calibration shows from this many rated answers on; with fewer, a percentage per level says nothing. */
export const CALIBRATION_MIN = 5;
export type CalibrationRow = { level: ConfidenceLevel; label: string; answers: number; right: number; /** Percent right, rounded; undefined when the level has no answers. */ pct: number | undefined };
export type Calibration = { rows: CalibrationRow[]; total: number; ready: boolean; /** One sentence for the most confident level that has answers. */ reading: string | undefined };

const LEVEL_LABEL: Record<ConfidenceLevel, string> = { 1: "Guessing", 2: "Fairly sure", 3: "Sure" };

/** How often the learner was right at each confidence level, over every rating given (spaced review and exams). */
export function calibration(data: ProgressData): Calibration {
  const rows: CalibrationRow[] = ([1, 2, 3] as const).map((level) => ({ level, label: LEVEL_LABEL[level], answers: 0, right: 0, pct: undefined }));
  for (const ratings of Object.values(data.confidence)) {
    for (const r of ratings) {
      const row = rows[r.level - 1]!;
      row.answers++;
      if (r.correct) row.right++;
    }
  }
  for (const row of rows) row.pct = row.answers ? Math.round((row.right / row.answers) * 100) : undefined;
  const total = rows.reduce((n, r) => n + r.answers, 0);
  const top = [...rows].reverse().find((r) => r.answers > 0);
  return { rows, total, ready: total >= CALIBRATION_MIN, reading: top ? `When you say ${top.label} you are right ${top.pct}% of the time.` : undefined };
}

export type Dashboard = {
  courses: CourseSummary[];
  /** Notes outside any course (concepts, papers, facts) that have progress. */
  other: { notes: NoteMeta[]; checks: CheckTally };
  review: ReviewItem[];
  /** Scheduled reviews due now (see `dueItems`), before the session cap. */
  due: number;
  recent: Activity[];
  calibration: Calibration;
  totals: { steps: number; answered: number; correct: number; practiced: number };
};

const BLOCK_KEY = /^([a-z0-9-]+)#(.+)#(\d+)(#predict)?$/;
const PRACTICE_KEY = /^([a-z0-9-]+)#practice-(.+)$/;

export function parseBlockKey(key: string): { slug: string; stepId: string; block: number; predict: boolean } | undefined {
  const m = BLOCK_KEY.exec(key);
  return m ? { slug: m[1]!, stepId: m[2]!, block: Number(m[3]), predict: m[4] !== undefined } : undefined;
}

export function parsePracticeKey(key: string): { slug: string; id: string } | undefined {
  const m = PRACTICE_KEY.exec(key);
  return m ? { slug: m[1]!, id: m[2]! } : undefined;
}

/** The `widgetsSeen` entry that records a block's placeholder having been shown. */
export const plannedSeenKey = (key: string) => `planned:${key}`;

/** The interactives of a lecture that are live now, were seen as a placeholder (`planned:<key>` in `widgetsSeen`) and
 *  have not been drawn live since. So "new" means activated after the learner passed it; a lecture read before
 *  placeholders were tracked, or one that never had any, lists nothing. A placeholder still planned does not show up.
 *  Needs the lecture's body, so it is a separate pass from `buildDashboard`'s index-only counts. */
export function newInteractives(model: Model, data: ProgressData, meta: NoteMeta, body: NoteBody): ReviewItem[] {
  const progress = data.notes[meta.slug];
  if (!progress) return [];
  const seen = new Set(data.widgetsSeen[meta.slug] ?? []);
  const out: ReviewItem[] = [];
  for (const flat of flattenSteps(body)) {
    if (flat.index > progress.furthest) break;
    flat.step.blocks.forEach((b, i) => {
      if (b.t !== "interactive" || b.status === "planned" || !model.index.widgets[b.widget]) return;
      const key = blockKey(meta.slug, flat.step.id, i);
      if (seen.has(key) || !seen.has(plannedSeenKey(key))) return;
      out.push({ kind: "interactive", key, slug: meta.slug, meta, stepId: flat.step.id, block: i, result: "new", at: progress.at, href: noteHref(model, meta.slug, flat.step.id) });
    });
  }
  return out;
}

const emptyTally = (): CheckTally => ({ correct: 0, wrong: 0, skipped: 0, open: 0 });

export type DueItem = { key: string; slug: string; stepId: string; block: number; meta: NoteMeta; entry: LeitnerEntry; href: string };

const scheduled = (model: Model) => (key: string) => {
  const k = parseBlockKey(key);
  return k !== undefined && !k.predict && model.note(k.slug) !== undefined;
};

/** The scheduled reviews due at `now`, the longest overdue first. Items of notes the index no longer holds are left
 *  out, so the count the header and dashboard show is what the review page lists. `cap` limits one session. */
export function dueItems(model: Model, data: ProgressData, now: number, cap = Infinity): DueItem[] {
  const out: DueItem[] = [];
  for (const [key, entry] of dueEntries(data.leitner, now, scheduled(model))) {
    const k = parseBlockKey(key)!;
    out.push({ key, slug: k.slug, stepId: k.stepId, block: k.block, meta: model.note(k.slug)!, entry, href: noteHref(model, k.slug, k.stepId) });
    if (out.length >= cap) break;
  }
  return out;
}

/** When the next scheduled review falls due, for the empty state of the review page. */
export const nextReviewDue = (model: Model, data: ProgressData, now: number) => nextDue(data.leitner, now, scheduled(model));

export type DashboardOptions = {
  now?: number;
  recent?: number;
  /** Bodies of the lectures loaded so far; "new interactive" items need them. */
  bodies?: ReadonlyMap<string, NoteBody>;
};

export function buildDashboard(model: Model, data: ProgressData, { recent = 8, bodies, now = Date.now() }: DashboardOptions = {}): Dashboard {
  const owner = (meta: NoteMeta) => courseOf(model, meta)?.id;
  const perCourse = new Map<string, CourseSummary>();
  for (const course of model.index.courses) {
    const lectures = lecturesOf(model, course).map((meta) => {
      const n = data.notes[meta.slug];
      return { meta, fraction: noteFraction(data, meta.slug), seen: n?.seen ?? 0, total: n?.total ?? 0 };
    });
    perCourse.set(course.id, {
      course,
      lectures,
      fraction: lectures.length ? lectures.reduce((s, l) => s + l.fraction, 0) / lectures.length : 0,
      checks: emptyTally(),
      goals: { met: 0, skipped: 0 },
      predictions: { right: 0, wrong: 0 },
      practice: { got: 0, notYet: 0, sets: course.practice.map((s) => model.note(s)).filter((m): m is NoteMeta => m !== undefined) },
      started: lectures.some((l) => data.notes[l.meta.slug] !== undefined),
    });
  }
  const other = { notes: [] as NoteMeta[], checks: emptyTally() };
  const tallyFor = (meta: NoteMeta) => {
    const c = owner(meta);
    return c ? perCourse.get(c)!.checks : other.checks;
  };
  const touch = (meta: NoteMeta) => {
    const c = owner(meta);
    if (c) perCourse.get(c)!.started = true;
  };

  // Checks a course's notes hold, so "open" counts what is left even before a note is opened.
  for (const meta of Object.values(model.index.notes)) {
    if (meta.checks > 0) {
      const c = owner(meta);
      if (c) perCourse.get(c)!.checks.open += meta.checks;
    }
  }

  const review: ReviewItem[] = [];
  const activity = new Map<string, Activity>();
  const act = (meta: NoteMeta, at: number) => {
    let a = activity.get(meta.slug);
    if (!a) {
      const n = data.notes[meta.slug];
      a = { meta, at: 0, seen: n?.seen ?? 0, total: n?.total ?? 0, checks: 0, practice: 0 };
      activity.set(meta.slug, a);
    }
    a.at = Math.max(a.at, at);
    return a;
  };
  for (const [slug, n] of Object.entries(data.notes)) {
    const meta = model.note(slug);
    if (meta) act(meta, n.at);
  }

  let answered = 0;
  let correct = 0;
  for (const [key, r] of Object.entries(data.checks)) {
    const k = parseBlockKey(key);
    const meta = k && model.note(k.slug);
    if (!k || !meta) continue;
    const tally = tallyFor(meta);
    if (owner(meta)) tally.open = Math.max(0, tally.open - 1);
    touch(meta);
    if (r.result === "correct") tally.correct++;
    else if (r.result === "incorrect") tally.wrong++;
    else tally.skipped++;
    if (r.result !== "skipped") {
      answered++;
      // Statistics count the first submitted answer; a retry that turns out right does not make the first one right.
      if ((r.firstTry ?? r.result) === "correct") correct++;
      act(meta, r.at).checks++;
    } else act(meta, r.at);
    if (r.result !== "correct") {
      review.push({ kind: "check", key, slug: k.slug, meta, stepId: k.stepId, block: k.block, result: r.result, at: r.at, href: noteHref(model, k.slug, k.stepId) });
    }
  }

  for (const [key, r] of Object.entries(data.checkpoints)) {
    const k = parseBlockKey(key);
    const meta = k && model.note(k.slug);
    if (!k || !meta) continue;
    touch(meta);
    act(meta, r.at);
    const c = owner(meta) ? perCourse.get(owner(meta)!) : undefined;
    if (r.kind === "goal") {
      if (c) c.goals[r.result === "met" ? "met" : "skipped"]++;
      if (r.result === "skipped") review.push({ kind: "goal", key, slug: k.slug, meta, stepId: k.stepId, block: k.block, result: "skipped", at: r.at, href: noteHref(model, k.slug, k.stepId) });
    } else if (c && (r.result === "correct" || r.result === "incorrect")) {
      c.predictions[r.result === "correct" ? "right" : "wrong"]++;
    }
  }

  for (const [key, r] of Object.entries(data.derives)) {
    const k = parseBlockKey(key);
    const meta = k && model.note(k.slug);
    if (!k || !meta) continue;
    touch(meta);
    act(meta, r.at);
    if (r.result === "skipped" || r.result === "gave-up") {
      review.push({ kind: "derive", key, slug: k.slug, meta, stepId: k.stepId, block: k.block, result: r.result, at: r.at, href: noteHref(model, k.slug, k.stepId) });
    }
  }

  if (bodies) {
    for (const [slug, body] of bodies) {
      const meta = model.note(slug);
      if (meta?.type === "lecture") review.push(...newInteractives(model, data, meta, body));
    }
  }

  let practiced = 0;
  for (const [key, r] of Object.entries(data.practice)) {
    const k = parsePracticeKey(key);
    const meta = k && model.note(k.slug);
    if (!k || !meta) continue;
    practiced++;
    touch(meta);
    act(meta, r.at).practice++;
    const c = owner(meta) ? perCourse.get(owner(meta)!) : undefined;
    if (c) c.practice[r.grade === "got" ? "got" : "notYet"]++;
    if (r.grade === "notyet") review.push({ kind: "practice", key, slug: k.slug, meta, id: k.id, at: r.at, href: href({ name: "practice", slug: k.slug, at: k.id }) });
  }

  for (const a of activity.values()) if (!owner(a.meta) && a.meta.type !== "course") other.notes.push(a.meta);

  return {
    courses: [...perCourse.values()],
    other,
    review: review.sort((a, b) => b.at - a.at),
    due: dueItems(model, data, now).length,
    recent: [...activity.values()].sort((a, b) => b.at - a.at).slice(0, recent),
    calibration: calibration(data),
    totals: { steps: Object.keys(data.steps).length, answered, correct, practiced },
  };
}
