// A data-chart's series built from a dataset table: which rows each series takes, where they sit on the x axis, and
// the numbers tests can ask about (`rich@2008`, `rich.max`). Pure, so `npm run validate` and the widget agree.
import type { DataChartSpec } from "../core/types";
import type { Cell, Table } from "../data/table";

export type XKind = "number" | "band";
export type ChartPoint = {
  x: number;
  y: number;
  /** The x value as the dataset gives it (a band's name, a date's text, a number's text). */
  label: string;
  /** The row is flagged as read off a chart: show it with ≈. */
  approx: boolean;
};
export type SeriesData = { id: string; label?: string; tex?: string; color?: string; column: string; points: ChartPoint[] };
export type ChartData = {
  kind: XKind;
  /** Band names in plot order (bands sit at 0, 1, 2 …). Empty for a numeric x. */
  bands: string[];
  series: SeriesData[];
  /** Whether x is a date column, converted to fractional years. */
  dates: boolean;
};

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

/** Builds the series of `spec` from `table`. Throws a readable Error for a column or filter the dataset lacks. */
export function chartData(spec: DataChartSpec, table: Table): ChartData {
  const xs = column(table, spec.x.column, "x");
  const textual = xs.some((c) => typeof c === "string");
  const dates = spec.x.kind !== "band" && textual && xs.every((c) => c === null || (typeof c === "string" && isDate(c)));
  const kind: XKind = spec.x.kind === "band" || (textual && !dates) ? "band" : "number";
  const bands = kind === "band" ? [...new Set(xs.filter((c): c is string | number => c !== null).map(String))] : [];
  const bandIndex = new Map(bands.map((b, i) => [b, i]));
  const xOf = (c: Cell): number =>
    c === null ? NaN : kind === "band" ? (bandIndex.get(String(c)) ?? NaN) : dates ? dateToYear(String(c)) : typeof c === "number" ? c : NaN;
  const approxCol = APPROX_COLUMNS.map((n) => table.col[n]).find(Boolean);

  const defs = spec.series ?? [{ id: spec.y.column, label: spec.y.label, tex: spec.y.tex }];
  const series = defs.map((def): SeriesData => {
    const ycol = def.column ?? spec.y.column;
    const ys = column(table, ycol, `series '${def.id}'`);
    const filters = Object.entries(def.where ?? {}).map(([k, want]) => [column(table, k, `series '${def.id}' filter`), want] as const);
    const points: ChartPoint[] = [];
    for (let i = 0; i < table.n; i++) {
      if (!filters.every(([cells, want]) => matches(cells[i]!, want))) continue;
      const y = ys[i];
      const x = xOf(xs[i]!);
      if (typeof y !== "number" || !Number.isFinite(y) || !Number.isFinite(x)) continue;
      points.push({ x, y, label: String(xs[i]), approx: approxCol ? TRUTHY.has(String(approxCol[i]).toLowerCase()) : false });
    }
    points.sort((a, b) => a.x - b.x);
    return { id: def.id, label: def.label, tex: def.tex, color: def.color, column: ycol, points };
  });
  return { kind, bands, series, dates };
}

/** Where an annotation's or test's x (a number, a date or a band name) sits on the axis; undefined if it matches nothing. */
export function locate(data: ChartData, raw: string | number): number | undefined {
  if (data.kind === "band") return data.bands.includes(String(raw)) ? data.bands.indexOf(String(raw)) : undefined;
  const x = typeof raw === "number" ? raw : data.dates ? dateToYear(raw) : Number(raw);
  return Number.isFinite(x) ? x : undefined;
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
 *  `<series>.first|last|min|max|mean|n` summarizes its points. undefined when the key is not one of these. */
export function chartValue(data: ChartData, key: string): number | undefined {
  const byId = (id: string) => data.series.find((s) => s.id === id);
  const at = key.lastIndexOf("@");
  if (at > 0) {
    const s = byId(key.slice(0, at));
    if (!s) return undefined;
    const x = locate(data, key.slice(at + 1));
    return s.points.find((p) => x !== undefined && Math.abs(p.x - x) < 1e-9)?.y ?? NaN;
  }
  const dot = key.lastIndexOf(".");
  if (dot > 0 && (STATS as readonly string[]).includes(key.slice(dot + 1))) {
    const s = byId(key.slice(0, dot));
    return s ? stat(s.points, key.slice(dot + 1) as Stat) : undefined;
  }
  return undefined;
}
