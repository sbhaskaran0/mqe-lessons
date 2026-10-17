import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Index, NoteMeta } from "../../src/ir";
import { adjacency, buildGraph, colorKeys, courseScope, layerOf, prerequisiteClosure, reach, studyLayers, studyRanks } from "../../src/map/graph";
import { layoutGraph, neighbour } from "../../src/map/layout";
import { centerOn, fit, reveal, zoomAt } from "../../src/map/viewport";
import { REPO } from "../helpers";

function note(slug: string, over: Partial<NoteMeta> = {}): NoteMeta {
  return {
    slug, name: slug, title: slug.toUpperCase(), type: "concept", path: `${slug}.md`, summary: "", tags: [], aliases: [], requires: [], lessons: [],
    courses: [], edges: { out: [], in: [] }, figures: [], interactives: [], checks: 0, words: 0, created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z", ...over,
  };
}

/** calc <- a <- b <- c, d needs a and c, e is unrelated; "calc" is a prerequisite from another course. */
function toy(): Index {
  const notes = [
    note("calc", { courses: ["Math"], domain: "math" }),
    note("a", { requires: ["calc"], courses: ["Econ"], domain: "macro" }),
    note("b", { requires: ["a"], courses: ["Econ"], domain: "macro" }),
    note("c", { requires: ["b"], courses: ["Econ"], domain: "micro" }),
    note("d", { requires: ["a", "c"], courses: ["Other"], domain: "macro" }),
    note("e", { courses: ["Math"], domain: "math" }),
    note("fact-1", { type: "fact", requires: ["b"], edges: { out: [{ kind: "requires", note: "b" }], in: [] } }),
    note("paper-1", { type: "paper", edges: { out: [{ kind: "uses", note: "c" }, { kind: "uses", note: "fact-1" }], in: [] } }),
    note("loner-fact", { type: "fact", requires: ["e"] }),
  ];
  return { notes: Object.fromEntries(notes.map((n) => [n.slug, n])), courses: [], domains: [], tags: {}, widgets: {}, datasets: {} } as unknown as Index;
}

const slugs = (set: Iterable<string>) => [...set].sort();

describe("prerequisite closure and the course filter", () => {
  it("follows requires transitively and ignores non-concepts", () => {
    expect(slugs(prerequisiteClosure(toy(), ["c"]))).toEqual(["a", "b", "c", "calc"]);
    expect(slugs(prerequisiteClosure(toy(), ["fact-1"]))).toEqual([]);
  });

  it("a course is what it covers plus the closure of their prerequisites, from other courses too", () => {
    // Econ covers a, b, c; calc comes along because a needs it. d (Other) and e are not needed.
    expect(slugs(courseScope(toy(), "Econ"))).toEqual(["a", "b", "c", "calc"]);
    expect(slugs(courseScope(toy(), "Other"))).toEqual(["a", "b", "c", "calc", "d"]);
    expect(slugs(courseScope(toy(), "Math"))).toEqual(["calc", "e"]);
    expect(courseScope(toy(), "Nope").size).toBe(0);
  });

  it("buildGraph keeps only edges inside the filtered set, prerequisite first", () => {
    const g = buildGraph(toy(), { course: "Econ" });
    expect(slugs(g.nodes.map((n) => n.slug))).toEqual(["a", "b", "c", "calc"]);
    expect(g.edges).toContainEqual({ from: "calc", to: "a" });
    expect(g.edges).toHaveLength(3);
  });

  it("a domain filter drops nodes and the edges that touch them", () => {
    const g = buildGraph(toy(), { domain: "macro" });
    expect(slugs(g.nodes.map((n) => n.slug))).toEqual(["a", "b", "d"]);
    expect(g.edges).toEqual(expect.arrayContaining([{ from: "a", to: "b" }, { from: "a", to: "d" }]));
    expect(g.edges).toHaveLength(2);
  });

  it("extra adds facts and papers that hang off a visible concept, and nothing cyclic", () => {
    const g = buildGraph(toy(), { extra: true });
    const ids = g.nodes.map((n) => n.slug);
    expect(ids).toContain("fact-1");
    expect(ids).toContain("paper-1");
    expect(g.edges).toContainEqual({ from: "b", to: "fact-1" });
    expect(g.edges).toContainEqual({ from: "c", to: "paper-1" });
    // paper-1 "uses" fact-1 would point back from a fact; only concept -> paper edges are drawn.
    expect(g.edges).not.toContainEqual({ from: "fact-1", to: "paper-1" });
    expect(layerOf(g).size).toBe(g.nodes.length);
    // Notes hanging off concepts that the filters hide are hidden too.
    expect(buildGraph(toy(), { course: "Math", extra: true }).nodes.map((n) => n.slug)).toContain("loner-fact");
    expect(buildGraph(toy(), { course: "Econ", extra: true }).nodes.map((n) => n.slug)).not.toContain("loner-fact");
  });
});

describe("layers, reach and study order", () => {
  it("layers are longest-path depth", () => {
    const l = layerOf(buildGraph(toy()));
    expect([l.get("calc"), l.get("a"), l.get("b"), l.get("c"), l.get("d"), l.get("e")]).toEqual([0, 1, 2, 3, 4, 0]);
  });

  it("survives a cycle instead of looping", () => {
    const nodes = ["x", "y"].map((slug) => ({ slug, title: slug, type: "concept" as const, courses: [] }));
    expect(layerOf({ nodes, edges: [{ from: "x", to: "y" }, { from: "y", to: "x" }] }).size).toBe(2);
  });

  it("every note comes after all of its prerequisites in the study layers", () => {
    const g = buildGraph(toy());
    const at = new Map(studyLayers(g).flatMap((l) => l.nodes.map((n) => [n.slug, l.layer] as const)));
    for (const e of g.edges) expect(at.get(e.from)!).toBeLessThan(at.get(e.to)!);
  });

  it("reach gives ancestors and descendants, excluding the node", () => {
    const adj = adjacency(buildGraph(toy()));
    expect(slugs(reach(adj.preds, "c"))).toEqual(["a", "b", "calc"]);
    expect(slugs(reach(adj.succs, "a"))).toEqual(["b", "c", "d"]);
  });

  it("studyRanks puts prerequisites first and other notes after the concepts they point at", () => {
    const ranks = studyRanks(toy());
    expect(ranks.get("calc")!).toBeLessThan(ranks.get("a")!);
    expect(ranks.get("fact-1")!).toBeGreaterThan(ranks.get("b")!);
    expect(ranks.get("fact-1")!).toBeLessThan(ranks.get("c")!);
  });

  it("colorKeys orders by frequency so the big groups get the first colours", () => {
    expect(colorKeys(buildGraph(toy()), "domain")).toEqual(["macro", "math", "micro"]);
  });
});

describe("layout", () => {
  it("places prerequisites to the left and orders columns top to bottom", () => {
    const g = buildGraph(toy());
    const layout = layoutGraph(g);
    for (const e of g.edges) expect(layout.nodes.get(e.from)!.x).toBeLessThan(layout.nodes.get(e.to)!.x);
    expect(layout.edges).toHaveLength(g.edges.length);
    for (const col of layout.columns) for (let i = 1; i < col.length; i++) expect(layout.nodes.get(col[i]!)!.y).toBeGreaterThan(layout.nodes.get(col[i - 1]!)!.y);
  });

  it("arrow keys go left to a prerequisite, right to a dependent, up and down the column", () => {
    const g = buildGraph(toy());
    const layout = layoutGraph(g);
    const adj = adjacency(g);
    expect(neighbour(layout, adj, "b", "left")).toBe("a");
    expect(neighbour(layout, adj, "calc", "right")).toBe("a");
    expect(neighbour(layout, adj, "b", "right")).toBe("c");
    expect(neighbour(layout, adj, "calc", "left")).toBeUndefined();
    const col = layout.columns.find((c) => c.length > 1)!;
    expect(neighbour(layout, adj, col[0]!, "down")).toBe(col[1]);
    expect(neighbour(layout, adj, col[0]!, "up")).toBeUndefined();
  });
});

describe("viewport math", () => {
  it("fit never magnifies and centres the world", () => {
    const t = fit({ w: 400, h: 200 }, { w: 1000, h: 800 });
    expect(t.k).toBe(1);
    expect(t.x).toBeCloseTo(300);
    expect(t.y).toBeCloseTo(300);
    expect(fit({ w: 4000, h: 2000 }, { w: 1000, h: 800 }).k).toBeLessThan(0.3);
  });

  it("zoomAt keeps the point under the cursor still", () => {
    const t0 = { x: 40, y: 20, k: 0.5 };
    const world = { x: (300 - t0.x) / t0.k, y: (200 - t0.y) / t0.k };
    const t1 = zoomAt(t0, 300, 200, 1.5);
    expect(world.x * t1.k + t1.x).toBeCloseTo(300);
    expect(world.y * t1.k + t1.y).toBeCloseTo(200);
  });

  it("centerOn puts the point mid-view, left of any overlay", () => {
    const t = centerOn({ x: 0, y: 0, k: 2 }, 100, 50, { w: 1000, h: 600 }, { right: 400 });
    expect(100 * t.k + t.x).toBeCloseTo(300);
    expect(50 * t.k + t.y).toBeCloseTo(300);
  });

  it("reveal leaves a visible box alone and pans a hidden one into view", () => {
    const t = { x: 0, y: 0, k: 1 };
    const view = { w: 1000, h: 600 };
    expect(reveal(t, { x: 100, y: 100, w: 200, h: 56 }, view)).toBe(t);
    const moved = reveal(t, { x: 900, y: 100, w: 200, h: 56 }, view, { right: 360 });
    expect((900 + 200) * moved.k + moved.x).toBeLessThanOrEqual(1000 - 360);
  });
});

describe("against the real export", () => {
  const file = path.join(REPO, "content", "index.json");
  it.skipIf(!existsSync(file))("the Econ 402A scope holds Solow, its prerequisites, and is closed under requires", () => {
    const index = JSON.parse(readFileSync(file, "utf8")) as Index;
    const scope = courseScope(index, "Econ 402A");
    expect(scope.has("solow-growth-model")).toBe(true);
    expect(scope.has("cobb-douglas-production-function")).toBe(true);
    for (const s of scope) for (const r of index.notes[s]!.requires) expect(scope.has(r), `${s} needs ${r}`).toBe(true);
    for (const m of Object.values(index.notes)) if (m.type === "concept" && m.courses.includes("Econ 402A")) expect(scope.has(m.slug)).toBe(true);
    // The whole graph is acyclic: the longest-path layers respect every edge.
    const g = buildGraph(index);
    const l = layerOf(g);
    for (const e of g.edges) expect(l.get(e.from)!).toBeLessThan(l.get(e.to)!);
  });
});
