// Pure helpers for a practice set: its questions grouped under their headings, the learner's grades, and the
// filters ("Not yet" to review, "Not tried"). No React here, so tests can drive it with plain data.
import type { PracticeItem } from "../ir";
import type { PracticeShow } from "../app/router";
import { practiceKey, type PracticeResult, type ProgressData } from "../progress/store";

export type PracticeGroup = { title: string | undefined; items: PracticeItem[] };

/** Questions under their group headings, groups in the order they first appear, questions in set order. */
export function groupItems(items: readonly PracticeItem[]): PracticeGroup[] {
  const groups = new Map<string | undefined, PracticeGroup>();
  for (const item of items) {
    let g = groups.get(item.group);
    if (!g) {
      g = { title: item.group, items: [] };
      groups.set(item.group, g);
    }
    g.items.push(item);
  }
  return [...groups.values()];
}

export const gradeOf = (data: ProgressData, slug: string, id: string): PracticeResult | undefined => data.practice[practiceKey(slug, id)];

/** `partly` (rubric only) is tallied apart from `notYet`; the "Not yet" filter lists both, since a partly-right question still needs review. */
export type SetSummary = { total: number; got: number; partly: number; notYet: number; untried: number };

export function setSummary(data: ProgressData, slug: string, items: readonly PracticeItem[]): SetSummary {
  let got = 0;
  let partly = 0;
  let notYet = 0;
  for (const item of items) {
    const g = gradeOf(data, slug, item.id)?.grade;
    if (g === "got") got++;
    else if (g === "partly") partly++;
    else if (g === "notyet") notYet++;
  }
  return { total: items.length, got, partly, notYet, untried: items.length - got - partly - notYet };
}

export function shows(show: PracticeShow | undefined, result: PracticeResult | undefined): boolean {
  if (show === "review") return result?.grade === "notyet" || result?.grade === "partly";
  if (show === "new") return result === undefined;
  return true;
}

/** The ids a filter lists right now. The page takes this snapshot when the filter changes, so a question graded
 *  "Got it" while reviewing stays on screen until the learner moves on. */
export function filterIds(data: ProgressData, slug: string, items: readonly PracticeItem[], show: PracticeShow | undefined): Set<string> {
  return new Set(items.filter((it) => shows(show, gradeOf(data, slug, it.id))).map((it) => it.id));
}
