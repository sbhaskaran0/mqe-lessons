// Spaced review as a four-box Leitner schedule. Pure: every function takes the clock as an argument, so tests do not
// depend on today's date. An item enters at box 1 when it is missed; a correct review moves it up a box, a wrong one
// sends it back to box 1, and a correct review in the last box retires it (the entry is deleted).
// `due` is the start of a local day, so an item is due from the morning of its day, not from the hour it was missed.

export type Box = 1 | 2 | 3 | 4;
export type LeitnerEntry = { box: Box; due: number; lapses: number; at: number };
export type Leitner = Record<string, LeitnerEntry>;

/** Days until an item comes back, by the box it was placed in. */
export const INTERVAL_DAYS: Record<Box, number> = { 1: 1, 2: 3, 3: 7, 4: 21 };
/** One session shows at most this many items. */
export const SESSION_CAP = 20;

/** Local midnight at or before `ms`, `plusDays` calendar days on (calendar days, not 24 h, so DST does not shift it). */
export function startOfDay(ms: number, plusDays = 0): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + plusDays);
  return d.getTime();
}

const placed = (box: Box, lapses: number, now: number): LeitnerEntry => ({ box, due: startOfDay(now, INTERVAL_DAYS[box]), lapses, at: now });

/** A missed item joins the schedule at box 1. One already on it is left as it is: a second miss in the lesson is
 *  not a review, and a retry that turns out right must not take it off. */
export function enter(prev: LeitnerEntry | undefined, now: number): LeitnerEntry {
  return prev ?? placed(1, 0, now);
}

/** The entry after a review, or undefined when the item has been retired. */
export function review(prev: LeitnerEntry, correct: boolean, now: number): LeitnerEntry | undefined {
  if (!correct) return placed(1, prev.lapses + 1, now);
  if (prev.box === 4) return undefined;
  return placed((prev.box + 1) as Box, prev.lapses, now);
}

export const isDue = (entry: LeitnerEntry, now: number) => entry.due <= now;

/** Entries due now, the longest overdue first (ties by key, so the order is stable). */
export function dueEntries(leitner: Leitner, now: number, keep: (key: string) => boolean = () => true): [string, LeitnerEntry][] {
  return Object.entries(leitner)
    .filter(([key, e]) => isDue(e, now) && keep(key))
    .sort((a, b) => a[1].due - b[1].due || a[0].localeCompare(b[0]));
}

/** The soonest due date among entries not yet due, for "Nothing due" to say when something is. */
export function nextDue(leitner: Leitner, now: number, keep: (key: string) => boolean = () => true): number | undefined {
  let best: number | undefined;
  for (const [key, e] of Object.entries(leitner)) if (!isDue(e, now) && keep(key) && (best === undefined || e.due < best)) best = e.due;
  return best;
}
