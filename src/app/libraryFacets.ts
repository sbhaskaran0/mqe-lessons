// The library's filters as plain data: what the URL says, which notes pass, and how many each facet value would
// leave. Pure, so the counting and the URL round trip are unit-tested without a page.
//
// Within one facet (two domains, say) a note passes if it matches ANY chosen value; across facets it must match
// ALL of them. "Has interactive" and "Has checkpoints" are separate yes/no facets, so choosing both means both.
import { NOTE_TYPES, type NoteMeta, type NoteType } from "../ir";
import type { ProgressData } from "../progress/store";
import type { LibraryQuery } from "./router";

export const STATUSES = ["not-started", "in-progress", "done"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = { "not-started": "Not started", "in-progress": "In progress", done: "Done" };

export const HAS = ["interactive", "checkpoints"] as const;
export type Has = (typeof HAS)[number];
export const HAS_LABEL: Record<Has, string> = { interactive: "Has interactive", checkpoints: "Has checkpoints" };

export const SORTS = ["title", "recent", "study"] as const;
export type Sort = (typeof SORTS)[number];
export const SORT_LABEL: Record<Sort, string> = { title: "Title", recent: "Recently added", study: "Study order" };

export type Filters = {
  q: string;
  types: NoteType[];
  domains: string[];
  tags: string[];
  courses: string[];
  has: Has[];
  status: Status[];
  /** Unset means relevance while searching and title otherwise. */
  sort?: Sort;
};

export type FacetKey = "type" | "domain" | "tag" | "course" | "status" | Has;

const list = (v: string | undefined) => (v ? [...new Set(v.split(",").map((s) => s.trim()).filter(Boolean))] : []);
const only = <T extends string>(all: readonly T[], values: string[]) => all.filter((a) => values.includes(a));

/** The type filter nobody asked for: concepts, until there is a search (which looks across everything). */
const defaultTypes = (q: string): NoteType[] => (q ? [] : ["concept"]);
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** `type=all` is the explicit "no type filter"; no `type` at all means the default. */
export function parseFilters(query: LibraryQuery): Filters {
  const q = (query.q ?? "").trim();
  const types = query.type === undefined ? defaultTypes(q) : only(NOTE_TYPES, list(query.type));
  const sort = SORTS.find((s) => s === query.sort);
  return {
    q,
    types,
    domains: list(query.domain),
    tags: list(query.tag),
    courses: list(query.course),
    has: only(HAS, list(query.has)),
    status: only(STATUSES, list(query.status)),
    ...(sort ? { sort } : {}),
  };
}

/** The shortest query that parses back to `f`: defaults are left out, so a plain library link stays plain. */
export function toQuery(f: Filters): LibraryQuery {
  const out: LibraryQuery = {};
  if (f.q) out.q = f.q;
  if (!sameSet(f.types, defaultTypes(f.q))) out.type = f.types.length ? f.types.join(",") : "all";
  if (f.domains.length) out.domain = f.domains.join(",");
  if (f.tags.length) out.tag = f.tags.join(",");
  if (f.courses.length) out.course = f.courses.join(",");
  if (f.has.length) out.has = f.has.join(",");
  if (f.status.length) out.status = f.status.join(",");
  if (f.sort) out.sort = f.sort;
  return out;
}

/** The type filter is something other than what the page picks on its own. */
export const hasCustomTypes = (f: Filters): boolean => !sameSet(f.types, defaultTypes(f.q));

/** Anything that narrows the list beyond the defaults. Sorting does not narrow it. */
export function isFiltered(f: Filters): boolean {
  return !!f.q || !sameSet(f.types, defaultTypes(f.q)) || f.domains.length + f.tags.length + f.courses.length + f.has.length + f.status.length > 0;
}

export function noteStatus(data: ProgressData, slug: string): Status {
  const n = data.notes[slug];
  if (!n) return "not-started";
  if (n.total > 0 && n.seen >= n.total) return "done";
  return n.seen > 0 || n.furthest > 0 ? "in-progress" : "not-started";
}

export type FacetContext = { status: (slug: string) => Status };

const inDomain = (m: NoteMeta, d: string) => m.domain === d || (m.domains ?? []).includes(d);

/** The values of `facet` a note has: a yes/no facet has the single value "yes" when it applies. */
export function facetValues(m: NoteMeta, facet: FacetKey, ctx: FacetContext): string[] {
  switch (facet) {
    case "type":
      return [m.type];
    case "domain":
      return [...new Set([...(m.domain ? [m.domain] : []), ...(m.domains ?? [])])];
    case "tag":
      return m.tags;
    case "course":
      return m.courses;
    case "status":
      return [ctx.status(m.slug)];
    case "interactive":
      return m.interactives.length > 0 ? ["yes"] : [];
    case "checkpoints":
      return m.checks > 0 ? ["yes"] : [];
  }
}

function passes(m: NoteMeta, f: Filters, ctx: FacetContext, facet: FacetKey): boolean {
  switch (facet) {
    case "type":
      return f.types.length === 0 || f.types.includes(m.type);
    case "domain":
      return f.domains.length === 0 || f.domains.some((d) => inDomain(m, d));
    case "tag":
      return f.tags.length === 0 || f.tags.some((t) => m.tags.includes(t));
    case "course":
      return f.courses.length === 0 || f.courses.some((c) => m.courses.includes(c));
    case "status":
      return f.status.length === 0 || f.status.includes(ctx.status(m.slug));
    case "interactive":
    case "checkpoints":
      return !f.has.includes(facet) || facetValues(m, facet, ctx).length > 0;
  }
}

const FACETS: readonly FacetKey[] = ["type", "domain", "tag", "course", "status", "interactive", "checkpoints"];

/** Notes that pass every facet, except `skip` when given (what the counts of that facet are measured against). */
export function filterNotes(notes: readonly NoteMeta[], f: Filters, ctx: FacetContext, skip?: FacetKey): NoteMeta[] {
  const active = FACETS.filter((k) => k !== skip);
  return notes.filter((m) => active.every((k) => passes(m, f, ctx, k)));
}

/** How many notes each value of `facet` would show if chosen now, given every other filter. */
export function facetCounts(notes: readonly NoteMeta[], f: Filters, ctx: FacetContext, facet: FacetKey): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of filterNotes(notes, f, ctx, facet)) for (const v of facetValues(m, facet, ctx)) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}

/** Sorted copy. Study order uses `ranks` (see studyRanks); ties and title order fall back to the title. */
export function sortNotes(notes: readonly NoteMeta[], sort: Sort, ranks: ReadonlyMap<string, number>): NoteMeta[] {
  const LAST = Number.MAX_SAFE_INTEGER;
  const byTitle = (a: NoteMeta, b: NoteMeta) => a.title.localeCompare(b.title);
  const compare: Record<Sort, (a: NoteMeta, b: NoteMeta) => number> = {
    title: byTitle,
    recent: (a, b) => b.created.localeCompare(a.created) || byTitle(a, b),
    study: (a, b) => (ranks.get(a.slug) ?? LAST) - (ranks.get(b.slug) ?? LAST) || byTitle(a, b),
  };
  return notes.slice().sort(compare[sort]);
}

/** Change the search text. While the type filter is still the default it follows the default for the new text
 *  (concepts only, then everything once there is a search), as it always has; a type the reader chose stays. */
export function withSearch(f: Filters, q: string): Filters {
  const text = q.trim();
  return { ...f, q: text, types: sameSet(f.types, defaultTypes(f.q)) ? defaultTypes(text) : f.types };
}

/** Toggle `value` in a list, keeping the original order of `all` so URLs are stable. */
export function toggle<T extends string>(current: readonly T[], value: T, all?: readonly T[]): T[] {
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return all ? all.filter((a) => next.includes(a)) : next;
}
