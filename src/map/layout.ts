// Layered left-to-right layout with dagre. Prerequisites land in the columns on the left. A layout is computed
// once per distinct graph and kept: filter changes back and forth cost nothing the second time.
import dagre from "@dagrejs/dagre";
import type { Index } from "../ir";
import { buildGraph, layerOf, type MapFilter, type MapGraph } from "./graph";

export const NODE_W = 200;
export const NODE_H = 56;
const MARGIN = 24;

export type Placed = { slug: string; x: number; y: number };
export type Routed = { from: string; to: string; points: { x: number; y: number }[] };
export type Layout = {
  /** Node centres, by slug. */
  nodes: Map<string, Placed>;
  edges: Routed[];
  width: number;
  height: number;
  /** Nodes of each column, top to bottom: the keyboard's up/down order. */
  columns: string[][];
};

export function layoutGraph(graph: MapGraph): Layout {
  const g = new dagre.graphlib.Graph({ multigraph: false });
  g.setGraph({ rankdir: "LR", nodesep: 14, ranksep: 78, marginx: MARGIN, marginy: MARGIN, acyclicer: "greedy" });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of graph.nodes) g.setNode(n.slug, { width: NODE_W, height: NODE_H });
  for (const e of graph.edges) g.setEdge(e.from, e.to);
  dagre.layout(g);

  const nodes = new Map<string, Placed>();
  for (const n of graph.nodes) {
    const p = g.node(n.slug);
    nodes.set(n.slug, { slug: n.slug, x: p.x, y: p.y });
  }
  const edges = graph.edges.map((e) => ({ from: e.from, to: e.to, points: g.edge(e.from, e.to).points }));

  // Columns come from dagre's own ranks (equal x), falling back to the longest-path layer for safety.
  const layer = layerOf(graph);
  const byX = new Map<number, string[]>();
  for (const p of nodes.values()) {
    const key = Math.round(p.x);
    byX.set(key, [...(byX.get(key) ?? []), p.slug]);
  }
  const columns = [...byX.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, slugs]) => slugs.sort((a, b) => nodes.get(a)!.y - nodes.get(b)!.y || (layer.get(a) ?? 0) - (layer.get(b) ?? 0)));

  const info = g.graph();
  return { nodes, edges, width: info.width ?? 0, height: info.height ?? 0, columns };
}

export type MapView = { graph: MapGraph; layout: Layout };

const views = new WeakMap<Index, Map<string, MapView>>();

/** The graph and layout for a filter, memoized per index and filter. */
export function mapView(index: Index, filter: MapFilter): MapView {
  let perIndex = views.get(index);
  if (!perIndex) views.set(index, (perIndex = new Map()));
  const key = `${filter.course ?? ""}|${filter.domain ?? ""}|${filter.extra ? "x" : ""}`;
  let view = perIndex.get(key);
  if (!view) {
    const graph = buildGraph(index, filter);
    view = { graph, layout: layoutGraph(graph) };
    perIndex.set(key, view);
  }
  return view;
}

/** An edge as a smooth path through dagre's route points (quadratic curves between segment midpoints). */
export function edgePath(points: { x: number; y: number }[]): string {
  const [first, ...rest] = points;
  if (!first) return "";
  if (rest.length === 0) return `M${first.x},${first.y}`;
  let d = `M${first.x},${first.y}`;
  for (let i = 0; i < rest.length - 1; i++) {
    const p = rest[i]!;
    const next = rest[i + 1]!;
    d += ` Q${p.x},${p.y} ${(p.x + next.x) / 2},${(p.y + next.y) / 2}`;
  }
  const last = rest[rest.length - 1]!;
  return `${d} L${last.x},${last.y}`;
}

export type Direction = "left" | "right" | "up" | "down";

/** Where an arrow key goes from `slug`: left to the nearest prerequisite, right to the nearest dependent
 *  (nearest by height, so the eye keeps its row), up and down along the column. */
export function neighbour(layout: Layout, adj: { preds: Map<string, string[]>; succs: Map<string, string[]> }, slug: string, dir: Direction): string | undefined {
  const here = layout.nodes.get(slug);
  if (!here) return undefined;
  if (dir === "left" || dir === "right") {
    const options = (dir === "left" ? adj.preds : adj.succs).get(slug) ?? [];
    return options.slice().sort((a, b) => Math.abs(layout.nodes.get(a)!.y - here.y) - Math.abs(layout.nodes.get(b)!.y - here.y))[0];
  }
  const column = layout.columns.find((c) => c.includes(slug));
  if (!column) return undefined;
  return column[column.indexOf(slug) + (dir === "up" ? -1 : 1)];
}
