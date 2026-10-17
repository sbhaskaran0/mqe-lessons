// Pure lookups over the exported index: where a note lives in the app, which course owns what, and the
// groupings the home, course and library pages show. No fetching here, so tests can feed it any index.
import type { Course, Edge, Index, NoteMeta, NoteType } from "../ir";
import { href, type Route } from "../app/router";

export type Model = {
  index: Index;
  courseById: Map<string, Course>;
  courseByCode: Map<string, Course>;
  /** Course hub slug -> its course. */
  courseByHub: Map<string, Course>;
  note: (slug: string) => NoteMeta | undefined;
};

export function buildModel(index: Index): Model {
  const courseById = new Map(index.courses.map((c) => [c.id, c]));
  const courseByCode = new Map(index.courses.map((c) => [c.code, c]));
  const courseByHub = new Map(index.courses.map((c) => [c.hub, c]));
  return { index, courseById, courseByCode, courseByHub, note: (slug) => index.notes[slug] };
}

/** Where a note opens: lectures as lessons, course hubs as their course page, everything else as a note. */
export function noteRoute(model: Model, slug: string, at?: string): Route {
  const meta = model.note(slug);
  const course = model.courseByHub.get(slug);
  if (course) return { name: "course", id: course.id };
  if (meta?.type === "lecture") return at ? { name: "lesson", slug, at } : { name: "lesson", slug };
  return at ? { name: "note", slug, at } : { name: "note", slug };
}

export const noteHref = (model: Model, slug: string, at?: string) => href(noteRoute(model, slug, at));

/** "Econ 424 · Inequality", or the code alone while the hub's title is a placeholder. */
export function courseLabel(course: Course): string {
  return course.title ? `${course.code} · ${course.title}` : course.code;
}

export function courseOf(model: Model, meta: NoteMeta): Course | undefined {
  return (meta.course && model.courseByCode.get(meta.course)) || model.courseByHub.get(meta.slug);
}

export function lecturesOf(model: Model, course: Course): NoteMeta[] {
  return course.lectures
    .map((s) => model.note(s))
    .filter((m): m is NoteMeta => m !== undefined)
    .sort((a, b) => (a.lecture ?? Infinity) - (b.lecture ?? Infinity));
}

/** Papers a course's lectures present, each with the lectures that present it, in lecture order. */
export function coursePapers(model: Model, course: Course): { paper: NoteMeta; lectures: NoteMeta[] }[] {
  const out = new Map<string, { paper: NoteMeta; lectures: NoteMeta[] }>();
  for (const lecture of lecturesOf(model, course)) {
    for (const e of lecture.edges.out) {
      const paper = model.note(e.note);
      if (e.kind !== "presents" || paper?.type !== "paper") continue;
      const entry = out.get(paper.slug) ?? { paper, lectures: [] };
      entry.lectures.push(lecture);
      out.set(paper.slug, entry);
    }
  }
  return [...out.values()];
}

export const TYPE_LABEL: Record<NoteType, string> = {
  concept: "Concept",
  fact: "Fact",
  source: "Data source",
  paper: "Paper",
  lecture: "Lecture",
  practice: "Practice",
  course: "Course",
  interactive: "Interactive",
  guide: "Guide",
};

export const TYPE_PLURAL: Record<NoteType, string> = {
  concept: "Concepts",
  fact: "Facts",
  source: "Data sources",
  paper: "Papers",
  lecture: "Lectures",
  practice: "Practice",
  course: "Courses",
  interactive: "Interactives",
  guide: "Guides",
};

export type FooterGroups = {
  buildsOn: NoteMeta[];
  usedIn: NoteMeta[];
  related: NoteMeta[];
  papers: NoteMeta[];
  interactives: NoteMeta[];
};

const RELATED_KINDS = new Set<Edge["kind"]>(["related", "uses", "cites", "applies"]);
const PAPER_KINDS = new Set<Edge["kind"]>(["presents", "cites", "uses", "related"]);
const INTERACTIVE_KINDS = new Set<Edge["kind"]>(["shows", "illustrates"]);

/** The note footer: each linked note appears once, in the most specific group that fits it. */
export function footerGroups(model: Model, meta: NoteMeta): FooterGroups {
  const seen = new Set<string>([meta.slug]);
  const take = (slugs: Iterable<string>, keep: (m: NoteMeta) => boolean = () => true) => {
    const out: NoteMeta[] = [];
    for (const s of slugs) {
      const m = model.note(s);
      if (!m || seen.has(s) || !keep(m)) continue;
      seen.add(s);
      out.push(m);
    }
    return out;
  };
  const edges = [...meta.edges.out, ...meta.edges.in];
  const ofKinds = (kinds: Set<Edge["kind"]>) => edges.filter((e) => kinds.has(e.kind)).map((e) => e.note);
  const interactives = take([...meta.interactives, ...ofKinds(INTERACTIVE_KINDS)], (m) => m.type === "interactive");
  const papers = take(ofKinds(PAPER_KINDS), (m) => m.type === "paper");
  const buildsOn = take(meta.requires);
  const usedIn = take(meta.lessons);
  const related = take(ofKinds(RELATED_KINDS), (m) => m.type !== "course");
  return { buildsOn, usedIn, related, papers, interactives };
}

/** Newest notes first, by the vault file's creation time; course hubs are not news. */
export function recentNotes(model: Model, limit: number): NoteMeta[] {
  return Object.values(model.index.notes)
    .filter((m) => m.type !== "course")
    .sort((a, b) => b.created.localeCompare(a.created) || a.title.localeCompare(b.title))
    .slice(0, limit);
}

export function obsidianUrl(path: string): string {
  return `obsidian://open?vault=${encodeURIComponent("MQE materials")}&file=${encodeURIComponent(path)}`;
}
