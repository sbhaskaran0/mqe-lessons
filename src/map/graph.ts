// The prerequisite graph behind #/map and the library's "study order" sort. Pure functions over the exported
// index: no layout, no DOM, so the filters and the closure rules are unit-testable.
//
// An edge runs from a prerequisite to the note that needs it (`NoteMeta.requires` points the other way), so
// reading the graph left to right is reading it in study order.
import type { Index, NoteMeta, NoteType } from "../ir";

export type MapNode = { slug: string; title: string; type: NoteType; domain?: string; courses: string[] };
export type MapEdge = { from: string; to: string };
export type MapGraph = { nodes: MapNode[]; edges: MapEdge[] };

export type MapFilter = {
  /** Course code ("Econ 402A"): what the course covers plus every prerequisite of it. */
  course?: string;
  domain?: string;
  /** Also place facts and papers that hang off a visible concept. */
  extra?: boolean;
};

const isConcept = (m: NoteMeta | undefined): m is NoteMeta => m?.type === "concept";
const inDomain = (m: NoteMeta, domain: string) => m.domain === domain || (m.domains ?? []).includes(domain);

/** `seeds` plus everything they transitively require, following concept-to-concept `requires` only. */
export function prerequisiteClosure(index: Index, seeds: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const stack = [...seeds];
  while (stack.length > 0) {
    const slug = stack.pop()!;
    if (out.has(slug) || !isConcept(index.notes[slug])) continue;
    out.add(slug);
    stack.push(...index.notes[slug]!.requires);
  }
  return out;
}

/** The concepts a course covers, plus the closure of their prerequisites: the Concept Index's study-order set. */
export function courseScope(index: Index, course: string): Set<string> {
  const covered = Object.values(index.notes).filter((m) => isConcept(m) && m.courses.includes(course));
  return prerequisiteClosure(index, covered.map((m) => m.slug));
}

const nodeOf = (m: NoteMeta): MapNode => ({ slug: m.slug, title: m.title, type: m.type, domain: m.domain, courses: m.courses });
const edgeKey = (e: MapEdge) => `${e.from}\u0000${e.to}`;

export function buildGraph(index: Index, filter: MapFilter = {}): MapGraph {
  const concepts = Object.values(index.notes).filter(isConcept);
  const scope = filter.course ? courseScope(index, filter.course) : undefined;
  const kept = concepts.filter((m) => (!scope || scope.has(m.slug)) && (!filter.domain || inDomain(m, filter.domain)));
  const visible = new Set(kept.map((m) => m.slug));

  const nodes = kept.map(nodeOf);
  const edges = new Map<string, MapEdge>();
  const add = (from: string, to: string) => edges.set(edgeKey({ from, to }), { from, to });
  for (const m of kept) for (const r of m.requires) if (visible.has(r)) add(r, m.slug);

  if (filter.extra) {
    // Facts require concepts; papers use them. Other kinds (cites, related) can point back at facts and papers
    // and would make the graph cyclic, so they are left out.
    for (const m of Object.values(index.notes)) {
      if (m.type !== "fact" && m.type !== "paper") continue;
      const needs = m.type === "fact" ? m.requires : m.edges.out.filter((e) => e.kind === "uses").map((e) => e.note);
      const used = needs.filter((s) => visible.has(s));
      if (used.length === 0) continue;
      nodes.push(nodeOf(m));
      for (const s of used) add(s, m.slug);
    }
  }
  return { nodes, edges: [...edges.values()] };
}

export type Adjacency = { preds: Map<string, string[]>; succs: Map<string, string[]> };

export function adjacency(graph: MapGraph): Adjacency {
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const n of graph.nodes) {
    preds.set(n.slug, []);
    succs.set(n.slug, []);
  }
  for (const e of graph.edges) {
    preds.get(e.to)?.push(e.from);
    succs.get(e.from)?.push(e.to);
  }
  return { preds, succs };
}

/** Everything reachable from `slug` along `next` (prerequisites, or dependents), excluding `slug` itself. */
export function reach(next: Map<string, string[]>, slug: string): Set<string> {
  const out = new Set<string>();
  const stack = [...(next.get(slug) ?? [])];
  while (stack.length > 0) {
    const s = stack.pop()!;
    if (out.has(s) || s === slug) continue;
    out.add(s);
    stack.push(...(next.get(s) ?? []));
  }
  return out;
}

/** Longest-path layer of every node: 0 for notes with no prerequisite in the graph, else one past the deepest
 *  prerequisite. A back edge (a cycle the vault should not contain) is ignored rather than looping. */
export function layerOf(graph: MapGraph): Map<string, number> {
  const { preds } = adjacency(graph);
  const layer = new Map<string, number>();
  const active = new Set<string>();
  const visit = (slug: string): number => {
    const known = layer.get(slug);
    if (known !== undefined) return known;
    if (active.has(slug)) return -1;
    active.add(slug);
    let depth = 0;
    for (const p of preds.get(slug) ?? []) depth = Math.max(depth, visit(p) + 1);
    active.delete(slug);
    layer.set(slug, depth);
    return depth;
  };
  for (const n of graph.nodes) visit(n.slug);
  return layer;
}

export type StudyLayer = { layer: number; nodes: MapNode[] };

/** The graph as a vertical study order: layer by layer, each layer alphabetical. Every note comes after all of
 *  its prerequisites, which is what the phone fallback shows. */
export function studyLayers(graph: MapGraph): StudyLayer[] {
  const layer = layerOf(graph);
  const byLayer = new Map<number, MapNode[]>();
  for (const n of graph.nodes) {
    const l = layer.get(n.slug) ?? 0;
    byLayer.set(l, [...(byLayer.get(l) ?? []), n]);
  }
  return [...byLayer.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([l, nodes]) => ({ layer: l, nodes: nodes.sort((a, b) => a.title.localeCompare(b.title)) }));
}

/** A rank for every note, for "sort by study order". Concepts rank by their depth in the whole prerequisite
 *  graph; any other note ranks just after the latest concept it requires, uses or covers, and notes that
 *  point at no concept come last. */
export function studyRanks(index: Index): Map<string, number> {
  const all = buildGraph(index);
  const layer = layerOf(all);
  const ranks = new Map<string, number>(layer);
  const deepest = Math.max(0, ...layer.values());
  for (const m of Object.values(index.notes)) {
    if (ranks.has(m.slug)) continue;
    const refs = [...m.requires, ...m.edges.out.filter((e) => e.kind === "covers" || e.kind === "uses" || e.kind === "applies").map((e) => e.note)];
    const concepts = refs.map((s) => layer.get(s)).filter((l): l is number => l !== undefined);
    ranks.set(m.slug, concepts.length > 0 ? Math.max(...concepts) + 0.5 : deepest + 2);
  }
  return ranks;
}

/** Stable colour keys: the most frequent value gets the first colour, so the big groups stay distinct. */
export function colorKeys(graph: MapGraph, by: "domain" | "course"): string[] {
  const counts = new Map<string, number>();
  for (const n of graph.nodes) {
    const keys = by === "domain" ? [n.domain ?? ""] : n.courses.slice(0, 1);
    for (const k of keys) if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
}
