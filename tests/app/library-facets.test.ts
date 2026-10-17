import { describe, expect, it } from "vitest";
import type { NoteMeta } from "../../src/ir";
import { href, parseHash } from "../../src/app/router";
import {
  facetCounts, filterNotes, isFiltered, noteStatus, parseFilters, sortNotes, toggle, toQuery, withSearch, type FacetContext, type Filters,
} from "../../src/app/libraryFacets";
import { emptyProgress } from "../../src/progress/store";

function note(slug: string, over: Partial<NoteMeta> = {}): NoteMeta {
  return {
    slug, name: slug, title: slug, type: "concept", path: `${slug}.md`, summary: "", tags: [], aliases: [], requires: [], lessons: [],
    courses: [], edges: { out: [], in: [] }, figures: [], interactives: [], checks: 0, words: 0, created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z", ...over,
  };
}

const notes = [
  note("ols", { domain: "econometrics", courses: ["Econ 430"], tags: ["estimation"], checks: 2 }),
  note("gauss-markov", { domain: "econometrics", courses: ["Econ 430"], tags: ["estimation", "theory"] }),
  note("solow", { domain: "macroeconomics", domains: ["macroeconomics", "growth"], courses: ["Econ 402A"], interactives: ["solow-explorer"], checks: 1 }),
  note("matrix", { domain: "mathematics", courses: ["Math Prep", "Econ 430"], tags: ["matrix"] }),
  note("skill-premium", { type: "fact", domain: "labor", courses: ["Econ 424"], created: "2026-03-01T00:00:00Z" }),
  note("katz-murphy", { type: "paper", domain: "labor", courses: ["Econ 424"], tags: ["theory"], created: "2026-02-01T00:00:00Z" }),
];

const status: Record<string, "not-started" | "in-progress" | "done"> = { ols: "done", solow: "in-progress" };
const ctx: FacetContext = { status: (slug) => status[slug] ?? "not-started" };
const base: Filters = { q: "", types: [], domains: [], tags: [], courses: [], has: [], status: [] };
const slugs = (ns: NoteMeta[]) => ns.map((n) => n.slug);

describe("URL state", () => {
  it("round-trips every facet through the hash", () => {
    const f: Filters = {
      q: "solow model", types: ["concept", "fact"], domains: ["labor", "econometrics"], tags: ["theory"], courses: ["Econ 430", "Math Prep"],
      has: ["interactive", "checkpoints"], status: ["in-progress", "done"], sort: "study",
    };
    const route = parseHash(href({ name: "library", query: toQuery(f) }));
    expect(route.name).toBe("library");
    if (route.name !== "library") return;
    expect(parseFilters(route.query)).toEqual(f);
  });

  it("a plain library link stays plain, and the default type is concepts until there is a search", () => {
    expect(toQuery(parseFilters({}))).toEqual({});
    expect(parseFilters({}).types).toEqual(["concept"]);
    expect(parseFilters({ q: "ols" }).types).toEqual([]);
    expect(toQuery(parseFilters({ q: "ols" }))).toEqual({ q: "ols" });
  });

  it("type=all means no type filter, and survives the round trip", () => {
    const f = parseFilters({ type: "all" });
    expect(f.types).toEqual([]);
    expect(toQuery(f)).toEqual({ type: "all" });
  });

  it("reads the documented example and drops junk values", () => {
    expect(parseHash("#/library?type=concept&domain=labor")).toEqual({ name: "library", query: { type: "concept", domain: "labor" } });
    expect(parseFilters({ type: "concept,nonsense", has: "interactive,bogus", status: "done,x", sort: "random" })).toMatchObject({
      types: ["concept"], has: ["interactive"], status: ["done"],
    });
    expect(parseFilters({ sort: "random" }).sort).toBeUndefined();
  });

  it("withSearch follows the default type, but a chosen type stays", () => {
    expect(withSearch(parseFilters({}), "solow").types).toEqual([]);
    expect(withSearch(parseFilters({ q: "solow" }), "").types).toEqual(["concept"]);
    expect(withSearch(parseFilters({ type: "fact" }), "solow").types).toEqual(["fact"]);
  });

  it("isFiltered ignores sort and the default type", () => {
    expect(isFiltered(parseFilters({}))).toBe(false);
    expect(isFiltered(parseFilters({ sort: "recent" }))).toBe(false);
    expect(isFiltered(parseFilters({ domain: "labor" }))).toBe(true);
    expect(isFiltered(parseFilters({ type: "all" }))).toBe(true);
  });

  it("toggle keeps the canonical order", () => {
    expect(toggle(["fact"], "concept", ["concept", "fact", "paper"])).toEqual(["concept", "fact"]);
    expect(toggle(["concept", "fact"], "concept")).toEqual(["fact"]);
  });
});

describe("filtering", () => {
  it("ORs within a facet and ANDs across facets", () => {
    expect(slugs(filterNotes(notes, { ...base, domains: ["econometrics", "labor"] }, ctx))).toEqual(["ols", "gauss-markov", "skill-premium", "katz-murphy"]);
    expect(slugs(filterNotes(notes, { ...base, domains: ["econometrics", "labor"], types: ["paper"] }, ctx))).toEqual(["katz-murphy"]);
  });

  it("matches a secondary domain and a note's other courses", () => {
    expect(slugs(filterNotes(notes, { ...base, domains: ["growth"] }, ctx))).toEqual(["solow"]);
    expect(slugs(filterNotes(notes, { ...base, courses: ["Econ 430"] }, ctx))).toEqual(["ols", "gauss-markov", "matrix"]);
  });

  it("has-flags are both required; status comes from the progress callback", () => {
    expect(slugs(filterNotes(notes, { ...base, has: ["interactive"] }, ctx))).toEqual(["solow"]);
    expect(slugs(filterNotes(notes, { ...base, has: ["checkpoints"] }, ctx))).toEqual(["ols", "solow"]);
    expect(slugs(filterNotes(notes, { ...base, has: ["interactive", "checkpoints"] }, ctx))).toEqual(["solow"]);
    expect(slugs(filterNotes(notes, { ...base, status: ["done", "in-progress"] }, ctx))).toEqual(["ols", "solow"]);
  });
});

describe("facet counts", () => {
  it("count each value against every OTHER filter, not its own", () => {
    const f: Filters = { ...base, types: ["concept"], domains: ["econometrics"] };
    // Domain counts ignore the domain filter itself: choosing another domain is still possible, with its count.
    const domain = facetCounts(notes, f, ctx, "domain");
    expect(domain.get("econometrics")).toBe(2);
    expect(domain.get("macroeconomics")).toBe(1);
    expect(domain.get("labor")).toBeUndefined();
    // Type counts see the domain filter: only econometrics notes, both concepts.
    expect(facetCounts(notes, f, ctx, "type").get("concept")).toBe(2);
    expect(facetCounts(notes, f, ctx, "type").get("fact")).toBeUndefined();
  });

  it("update as filters combine", () => {
    const course = (f: Filters) => facetCounts(notes, f, ctx, "course").get("Econ 430");
    expect(course(base)).toBe(3);
    expect(course({ ...base, domains: ["mathematics"] })).toBe(1);
    expect(course({ ...base, tags: ["theory"] })).toBe(1);
    expect(course({ ...base, status: ["done"] })).toBe(1);
  });

  it("counts tags, status and the has-flags", () => {
    expect(facetCounts(notes, base, ctx, "tag").get("estimation")).toBe(2);
    expect(facetCounts(notes, base, ctx, "tag").get("theory")).toBe(2);
    expect(Object.fromEntries(facetCounts(notes, base, ctx, "status"))).toEqual({ done: 1, "in-progress": 1, "not-started": 4 });
    expect(facetCounts(notes, base, ctx, "interactive").get("yes")).toBe(1);
    expect(facetCounts(notes, { ...base, has: ["interactive"] }, ctx, "checkpoints").get("yes")).toBe(1);
  });

  it("the count of a value equals the result count after choosing it alone", () => {
    for (const [value, count] of facetCounts(notes, base, ctx, "domain")) expect(filterNotes(notes, { ...base, domains: [value] }, ctx)).toHaveLength(count);
  });
});

describe("progress status", () => {
  it("is not started, in progress or done from the store's per-note totals", () => {
    const data = emptyProgress();
    expect(noteStatus(data, "a")).toBe("not-started");
    data.notes["a"] = { total: 10, seen: 4, furthest: 3, at: 0 };
    data.notes["b"] = { total: 10, seen: 10, furthest: 9, at: 0 };
    data.notes["c"] = { total: 10, seen: 0, furthest: 0, at: 0 };
    expect([noteStatus(data, "a"), noteStatus(data, "b"), noteStatus(data, "c")]).toEqual(["in-progress", "done", "not-started"]);
  });
});

describe("sorting", () => {
  it("sorts by title, recently added and study order", () => {
    expect(slugs(sortNotes(notes, "title", new Map()))).toEqual(["gauss-markov", "katz-murphy", "matrix", "ols", "skill-premium", "solow"]);
    expect(slugs(sortNotes(notes, "recent", new Map())).slice(0, 2)).toEqual(["skill-premium", "katz-murphy"]);
    const ranks = new Map([["solow", 0], ["ols", 1], ["matrix", 2]]);
    expect(slugs(sortNotes(notes, "study", ranks)).slice(0, 3)).toEqual(["solow", "ols", "matrix"]);
  });
});
