// A data-chart's series built from a dataset table: which rows each series takes, where they sit on the x axis, and
// the numbers tests can ask about (`rich@2008`, `rich.max`). Pure, so `npm run validate` and the widget agree.
//
// A precomputed chart (docs/PLAN.md, "Interface note: data-chart lookups") filters a tidy table by the sliders:
// `where: {h: {param: h}}` takes the rows whose h cell is the slider position h is at, or blank. The rows are indexed
// once per (spec, table) by the positions their bound cells hold, so a slider move looks a group up instead of
// scanning the table; each position's points are kept once built.
import type { DataChartSpec, ParamSpec } from "../core/types";
import { cellPosition, lastPosition, nearestPosition, positionValue } from "../core/grid";
import type { Cell, Table } from "../data/table";
import type { CHART_MARKS } from "../spec";

export type XKind = "number" | "band";
export type Mark = (typeof CHART_MARKS)[number];
export type ChartPoint = {
  x: number;
  y: number;
  /** The x value as the dataset gives it (a band's name, a date's text, a number's text). */
  label: string;
  /** The row is flagged as read off a chart: show it with ≈. */
  approx: boolean;
};
export type SeriesData = {
  id: string;
  label?: string;
  tex?: string;
  color?: string;
  column: string;
  mark: Mark;
  /** A draggable point: the params it sets. */
  drag?: { x: string; y: string };
  points: ChartPoint[];
};
export type ChartData = {
  kind: XKind;
  /** Band names in plot order (bands sit at 0, 1, 2 …). Empty for a numeric x. */
  bands: string[];
  series: SeriesData[];
  /** Whether x is a date column, converted to fractional years. */
  dates: boolean;
};

type Series = NonNullable<DataChartSpec["series"]>[number];
type Annotation = NonNullable<DataChartSpec["annotations"]>[number];
/** One chart: the spec itself (id "") or one of its panels. */
export type Plot = {
  id: string;
  title?: string;
  mark: Mark;
  x: NonNullable<DataChartSpec["x"]>;
  y: NonNullable<DataChartSpec["y"]>;
  series: Series[];
  annotations: Annotation[];
};
export type PlotData = ChartData & { plot: Plot };

/** The charts a spec draws: its panels, or itself as one chart. */
export function plotsOf(spec: DataChartSpec): Plot[] {
  if (spec.panels) {
    return spec.panels.map((p) => ({ id: p.id, title: p.title, mark: p.mark ?? spec.mark ?? "line", x: p.x, y: p.y, series: p.series ?? [], annotations: p.annotations ?? [] }));
  }
  const y = spec.y!;
  return [{ id: "", mark: spec.mark ?? "line", x: spec.x!, y, series: spec.series ?? [{ id: y.column, label: y.label, tex: y.tex }], annotations: spec.annotations ?? [] }];
}

/** A series' mark: its own, else a dragged point's, else its chart's. */
export const markOf = (plot: Plot, s: Series): Mark => s.mark ?? (s.drag ? "point" : plot.mark);

const APPROX_COLUMNS = ["approx", "approximate", "is_approx"];
const TRUTHY = new Set(["1", "true", "yes", "y", "≈"]);

/** "2008-07-01" as 2008.5: calendar dates become fractional years so the axis stays numeric. */
export function dateToYear(text: string): number {
  const t = Date.parse(text);
  if (Number.isNaN(t)) return NaN;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  return y + (t - start) / (Date.UTC(y + 1, 0, 1) - start);
}

const isDate = (s: string) => /^\d{4}-\d{2}(-\d{2})?/.test(s) && !Number.isNaN(Date.parse(s));

function matches(cell: Cell, want: string | number | boolean): boolean {
  if (cell === null) return false;
  if (typeof want === "number") return typeof cell === "number" ? cell === want : Number(cell) === want;
  if (typeof want === "boolean") return String(cell).toLowerCase() === String(want);
  return String(cell) === want;
}

function column(table: Table, name: string, what: string): Cell[] {
  const c = table.col[name];
  if (!c) throw new Error(`${what} column '${name}' is not in the dataset (columns: ${table.columns.join(", ")})`);
  return c;
}

// ---------------------------------------------------------------- the index

/** A filter bound to a slider: column, param id and the param's range and step. */
type Bound = { column: string; param: string; p: ParamSpec };
type SeriesIndex = {
  def: Series;
  plot: PlotIndex;
  mark: Mark;
  column: string;
  ys: Cell[];
  bound: Bound[];
  /** Row numbers by the positions of their bound cells, "*" for a blank cell ("2,*"); "" without bound filters. */
  groups: Map<string, number[]>;
  /** Grid cells that sit on no slider position: [column, value]. */
  off: [string, number][];
  /** Points by query key, built on first use. */
  built: Map<string, ChartPoint[]>;
};
type PlotIndex = {
  plot: Plot;
  kind: XKind;
  bands: string[];
  dates: boolean;
  /** x of every row on the axis (NaN where it has none). */
  xs: Float64Array;
  xText: Cell[];
  approx: (i: number) => boolean;
  series: SeriesIndex[];
};
export type ChartIndex = { spec: DataChartSpec; plots: PlotIndex[]; byId: Map<string, SeriesIndex> };

const indexes = new WeakMap<Table, WeakMap<DataChartSpec, ChartIndex>>();

/** The spec's charts indexed over `table`, built once per pair. Throws a readable Error for a column, filter or param
 *  the dataset or spec lacks. */
export function chartIndex(spec: DataChartSpec, table: Table): ChartIndex {
  let bySpec = indexes.get(table);
  if (!bySpec) indexes.set(table, (bySpec = new WeakMap()));
  let idx = bySpec.get(spec);
  if (!idx) bySpec.set(spec, (idx = buildIndex(spec, table)));
  return idx;
}

function buildIndex(spec: DataChartSpec, table: Table): ChartIndex {
  const approxCol = APPROX_COLUMNS.map((n) => table.col[n]).find(Boolean);
  const approx = (i: number) => (approxCol ? TRUTHY.has(String(approxCol[i]).toLowerCase()) : false);
  const byId = new Map<string, SeriesIndex>();
  const plots = plotsOf(spec).map((plot): PlotIndex => {
    const xcells = column(table, plot.x.column, `${plot.id ? `panel '${plot.id}' ` : ""}x`);
    const textual = xcells.some((c) => typeof c === "string");
    const dates = plot.x.kind !== "band" && textual && xcells.every((c) => c === null || (typeof c === "string" && isDate(c)));
    const kind: XKind = plot.x.kind === "band" || (textual && !dates) ? "band" : "number";
    const bands = kind === "band" ? [...new Set(xcells.filter((c): c is string | number => c !== null).map(String))] : [];
    const bandIndex = new Map(bands.map((b, i) => [b, i]));
    const xOf = (c: Cell): number =>
      c === null ? NaN : kind === "band" ? (bandIndex.get(String(c)) ?? NaN) : dates ? dateToYear(String(c)) : typeof c === "number" ? c : NaN;
    const pi: PlotIndex = { plot, kind, bands, dates, xs: Float64Array.from(xcells, xOf), xText: xcells, approx, series: [] };
    pi.series = plot.series.map((def) => {
      const si = indexSeries(spec, table, pi, def);
      byId.set(def.id, si);
      return si;
    });
    return pi;
  });
  return { spec, plots, byId };
}

function indexSeries(spec: DataChartSpec, table: Table, pi: PlotIndex, def: Series): SeriesIndex {
  const ycol = def.column ?? pi.plot.y.column;
  const si: SeriesIndex = { def, plot: pi, mark: markOf(pi.plot, def), column: ycol, ys: [], bound: [], groups: new Map(), off: [], built: new Map() };
  if (def.drag) return si;
  si.ys = column(table, ycol, `series '${def.id}'`);
  const literal: [Cell[], string | number | boolean][] = [];
  const cellsOf: Cell[][] = [];
  for (const [k, want] of Object.entries(def.where ?? {})) {
    const cells = column(table, k, `series '${def.id}' filter`);
    if (typeof want !== "object") {
      literal.push([cells, want]);
      continue;
    }
    const p = spec.params?.[want.param];
    if (!p) throw new Error(`series '${def.id}': where.${k} is bound to '${want.param}', which is not a parameter`);
    si.bound.push({ column: k, param: want.param, p });
    cellsOf.push(cells);
  }
  const { xs } = pi;
  rows: for (let i = 0; i < table.n; i++) {
    if (!literal.every(([cells, want]) => matches(cells[i]!, want))) continue;
    const y = si.ys[i];
    // A rug draws x alone, so its rows may leave y blank.
    if ((si.mark !== "rug" && (typeof y !== "number" || !Number.isFinite(y))) || !Number.isFinite(xs[i]!)) continue;
    let key = "";
    for (let j = 0; j < si.bound.length; j++) {
      const c = cellsOf[j]![i]!;
      let part = "*";
      if (c !== null) {
        const v = typeof c === "number" ? c : Number(c);
        const at = Number.isFinite(v) ? cellPosition(si.bound[j]!.p, v) : undefined;
        if (at === undefined) {
          si.off.push([si.bound[j]!.column, v]);
          continue rows;
        }
        part = String(at);
      }
      key += j ? `,${part}` : part;
    }
    const g = si.groups.get(key);
    if (g) g.push(i);
    else si.groups.set(key, [i]);
  }
  return si;
}

const yAt = (si: SeriesIndex, i: number): number => (typeof si.ys[i] === "number" && Number.isFinite(si.ys[i]) ? (si.ys[i] as number) : 0);

const valueOf = (spec: DataChartSpec, params: Record<string, number>, id: string): number => params[id] ?? spec.params?.[id]?.default ?? NaN;

/** The keys of every group a query position matches: its own positions and each blank-cell pattern over them. */
function keysAt(at: number[]): string[] {
  const out: string[] = [];
  for (let mask = 0; mask < 1 << at.length; mask++) out.push(at.map((k, j) => (mask & (1 << j) ? "*" : String(k))).join(","));
  return out;
}

/** A series' points at `params` (snapped to their slider positions): the matching rows sorted by x, or the dragged point. */
function seriesPoints(idx: ChartIndex, si: SeriesIndex, params: Record<string, number>): ChartPoint[] {
  const drag = si.def.drag;
  if (drag) {
    const x = valueOf(idx.spec, params, drag.x);
    const y = valueOf(idx.spec, params, drag.y);
    return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y, label: String(x), approx: false }] : [];
  }
  const at = si.bound.map((b) => nearestPosition(b.p, valueOf(idx.spec, params, b.param)));
  const key = at.join(",");
  let pts = si.built.get(key);
  if (!pts) {
    const pi = si.plot;
    pts = [];
    for (const k of keysAt(at)) for (const i of si.groups.get(k) ?? []) pts.push({ x: pi.xs[i]!, y: yAt(si, i), label: String(pi.xText[i]), approx: pi.approx(i) });
    pts.sort((a, b) => a.x - b.x);
    si.built.set(key, pts);
  }
  return pts;
}

/** Builds the series of every chart of `spec` from `table` at `params` (the defaults for any not given). */
export function chartSet(spec: DataChartSpec, table: Table, params: Record<string, number> = {}): PlotData[] {
  const idx = chartIndex(spec, table);
  return idx.plots.map((pi) => ({
    plot: pi.plot,
    kind: pi.kind,
    bands: pi.bands,
    dates: pi.dates,
    series: pi.series.map((si) => ({ id: si.def.id, label: si.def.label, tex: si.def.tex, color: si.def.color, column: si.column, mark: si.mark, drag: si.def.drag, points: seriesPoints(idx, si, params) })),
  }));
}

/** The first chart's series (the only one without panels). */
export function chartData(spec: DataChartSpec, table: Table, params: Record<string, number> = {}): ChartData {
  return chartSet(spec, table, params)[0]!;
}

/** Where an annotation's or test's x (a number, a date or a band name) sits on the axis; undefined if it matches nothing. */
export function locate(data: ChartData, raw: string | number): number | undefined {
  if (data.kind === "band") return data.bands.includes(String(raw)) ? data.bands.indexOf(String(raw)) : undefined;
  const x = typeof raw === "number" ? raw : data.dates ? dateToYear(raw) : Number(raw);
  return Number.isFinite(x) ? x : undefined;
}

export type Extent = { x: [number, number]; y: [number, number] };

/** Every point a series could draw at any slider position (a dragged point: its params' ranges), so axes follow all
 *  of them and never rescale under a slider. undefined for an empty series. */
export function seriesExtent(spec: DataChartSpec, table: Table, id: string): Extent | undefined {
  const si = chartIndex(spec, table).byId.get(id);
  if (!si) return undefined;
  if (si.def.drag) {
    const px = spec.params?.[si.def.drag.x];
    const py = spec.params?.[si.def.drag.y];
    return px && py ? { x: [px.min, px.max], y: [py.min, py.max] } : undefined;
  }
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const g of si.groups.values()) {
    for (const i of g) {
      const x = si.plot.xs[i]!;
      const y = yAt(si, i);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x0 <= x1 ? { x: [x0, x1], y: [y0, y1] } : undefined;
}

// ---------------------------------------------------------------- at(), tests and validate

const describeAt = (si: SeriesIndex, spec: DataChartSpec, params: Record<string, number>) =>
  si.bound.length ? ` at ${si.bound.map((b) => `${b.param} = ${positionValue(b.p, nearestPosition(b.p, valueOf(spec, params, b.param)))}`).join(", ")}` : "";

const round = (x: number) => Number(x.toPrecision(6));

/** `at("id", x)`: the series' y at x at `params`, linear between its points. Throws on an unknown or empty series and
 *  outside its x range. */
export function seriesAt(spec: DataChartSpec, table: Table, params: Record<string, number>, id: string, x: number): number {
  const idx = chartIndex(spec, table);
  const si = idx.byId.get(String(id));
  if (!si) throw new Error(`at(): there is no series '${id}'`);
  const pts = seriesPoints(idx, si, params);
  if (!pts.length) throw new Error(`at("${id}", …): the series has no rows${describeAt(si, spec, params)}`);
  const first = pts[0]!.x;
  const last = pts[pts.length - 1]!.x;
  const eps = 1e-9 * Math.max(1, Math.abs(first), Math.abs(last));
  if (!(x >= first - eps && x <= last + eps)) {
    throw new Error(`at("${id}", ${round(x)}): x is outside the series' range [${round(first)}, ${round(last)}]${describeAt(si, spec, params)}`);
  }
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.x <= x) lo = mid;
    else hi = mid;
  }
  const a = pts[lo]!;
  const b = pts[hi]!;
  if (Math.abs(x - a.x) <= eps || b.x === a.x) return a.y;
  if (Math.abs(x - b.x) <= eps) return b.y;
  return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

/** Most grid combinations validate walks for one series before it gives up (a sign the grid is far too fine). */
const GRID_LIMIT = 1_000_000;

/** Problems only the table shows for a precomputed chart: grid cells on no slider position, and slider positions
 *  (combinations of the params a series binds) with no rows, which would draw an empty chart. */
export function gridProblems(spec: DataChartSpec, table: Table): string[] {
  const errors: string[] = [];
  for (const si of chartIndex(spec, table).byId.values()) {
    if (!si.bound.length) continue;
    const id = si.def.id;
    if (si.off.length) {
      const [col, v] = si.off[0]!;
      const param = si.bound.find((b) => b.column === col)!.param;
      errors.push(`series '${id}': ${si.off.length} row(s) have a ${col} value on no slider position of '${param}' (first: ${v})`);
    }
    const sizes = si.bound.map((b) => lastPosition(b.p) + 1);
    const total = sizes.reduce((a, b) => a * b, 1);
    if (total > GRID_LIMIT) {
      errors.push(`series '${id}': its params have ${total.toLocaleString("en-US")} slider combinations, more than validate checks (${GRID_LIMIT.toLocaleString("en-US")})`);
      continue;
    }
    const missing: string[] = [];
    let count = 0;
    const at = sizes.map(() => 0);
    for (let n = 0; n < total; n++) {
      let r = n;
      for (let j = at.length - 1; j >= 0; j--) {
        at[j] = r % sizes[j]!;
        r = Math.floor(r / sizes[j]!);
      }
      if (keysAt(at).some((k) => si.groups.has(k))) continue;
      count++;
      if (missing.length < 3) missing.push(si.bound.map((b, j) => `${b.param} = ${positionValue(b.p, at[j]!)}`).join(", "));
    }
    if (count) errors.push(`series '${id}' has no rows at ${count} slider position(s): ${missing.join("; ")}${count > missing.length ? "; …" : ""}`);
  }
  return errors;
}

export const STATS = ["first", "last", "min", "max", "mean", "n"] as const;
export type Stat = (typeof STATS)[number];

function stat(points: ChartPoint[], s: Stat): number {
  if (!points.length) return s === "n" ? 0 : NaN;
  const ys = points.map((p) => p.y);
  switch (s) {
    case "first":
      return ys[0]!;
    case "last":
      return ys[ys.length - 1]!;
    case "min":
      return Math.min(...ys);
    case "max":
      return Math.max(...ys);
    case "mean":
      return ys.reduce((a, b) => a + b, 0) / ys.length;
    case "n":
      return ys.length;
  }
}

/** The value a test key names: `<series>@<x>` is the series' y at that x (NaN if it has no point there), and
 *  `<series>.first|last|min|max|mean|n` summarizes its points. undefined when the key is not one of these. Series are
 *  looked up in every chart. */
export function chartValue(data: ChartData | ChartData[], key: string): number | undefined {
  const plots = Array.isArray(data) ? data : [data];
  const byId = (id: string) => {
    for (const d of plots) {
      const s = d.series.find((x) => x.id === id);
      if (s) return { d, s };
    }
    return undefined;
  };
  const at = key.lastIndexOf("@");
  if (at > 0) {
    const hit = byId(key.slice(0, at));
    if (!hit) return undefined;
    const x = locate(hit.d, key.slice(at + 1));
    return hit.s.points.find((p) => x !== undefined && Math.abs(p.x - x) < 1e-9)?.y ?? NaN;
  }
  const dot = key.lastIndexOf(".");
  if (dot > 0 && (STATS as readonly string[]).includes(key.slice(dot + 1))) {
    const hit = byId(key.slice(0, dot));
    return hit ? stat(hit.s.points, key.slice(dot + 1) as Stat) : undefined;
  }
  return undefined;
}
