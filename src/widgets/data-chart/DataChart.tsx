// data-chart: a dataset drawn as lines, bars, areas, points or a rug. Series come from filtered rows of a long-format
// dataset (or from separate columns), each with a legend chip that toggles it; hovering reads every shown series at
// the nearest x; annotations mark events. Values are shown with ≈ where the dataset says they were read off a chart.
//
// A precomputed chart filters its table by the sliders (`where: {h: {param: h}}`), may read a series in expressions
// (`at("ise", h)`), may set params by dragging a point, and may show 2-3 charts side by side (`panels`) sharing one set
// of params, readouts and goal. The lookups live in ./series.ts, which `npm run validate` runs too.
//
// It draws on the shared PlotFrame (Mafs canvas, the runtime's axes, labels and hover overlay) rather than Observable
// Plot: the chart then looks and themes exactly like the other widgets, axis titles and labels get KaTeX for free, and
// the learner-facing parts (presets, predictions, goals) already live around that frame. Plot would add a second
// rendering stack and ~200 KB of d3 for marks this file draws in a few lines.
import "../data/data.css";
import { type KeyboardEvent, useMemo, useState } from "react";
import { Tex } from "../../lib/Tex";
import { resolveColor } from "../core/colors";
import { readoutValues } from "../core/evaluate";
import { nearestPosition, positionValue, snap, stepOf } from "../core/grid";
import type { DataChartSpec } from "../core/types";
import { type Runtime, useGoal, useWidgetRuntime } from "../core/useWidgetRuntime";
import { isApproximate } from "../data/approx";
import { DatasetError, DatasetLoading } from "../data/DatasetCards";
import type { Table } from "../data/table";
import { useDataset } from "../data/fetch";
import { PredictMarker } from "../data/PredictMarker";
import { bindTable, withDerived } from "../expr";
import { format } from "../format";
import type { WidgetProps } from "../host";
import type { DatasetMeta } from "../../ir";
import { DragHandle } from "../plot/DragHandle";
import { Area, Clip, Curve, Dot, pathD, type Pt, Segment } from "../plot/marks";
import { type PlotLabel, PlotFrame, type PlotShare, usePlot } from "../plot/PlotFrame";
import { extent, nice, type Range } from "../plot/ticks";
import { GoalFeedback, HintButton, PredictPanel } from "../ui/Feedback";
import { ParamPanel, paramText } from "../ui/ParamPanel";
import { Readouts } from "../ui/Readouts";
import { WidgetFrame } from "../ui/WidgetFrame";
import { type ChartPoint, chartIndex, chartSet, type Extent, locate, type PlotData, type SeriesData, seriesExtent } from "./series";

type SeriesView = SeriesData & {
  color: string;
  /** The step allows this series (listed in `show`, not hidden by a prediction), so its chip can be toggled. */
  allowed: boolean;
  /** Drawn: allowed, and the learner hasn't switched it off. */
  on: boolean;
};

export default function DataChart(props: WidgetProps) {
  const spec = props.entry.spec as DataChartSpec;
  const ds = useDataset(spec.dataset, props.datasets, props.contentBase);
  const table = ds.status === "ready" ? ds.table : null;
  const error = useMemo(() => {
    if (!table) return null;
    try {
      chartIndex(spec, table);
      bindTable(spec, table);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [spec, table]);

  if (ds.status === "loading") return <DatasetLoading entry={props.entry} />;
  if (ds.status === "error") return <DatasetError entry={props.entry} message={ds.message} retry={ds.retry} />;
  if (!table || error) return <DatasetError entry={props.entry} message={error ?? "no data"} />;
  return <Chart {...props} spec={spec} table={table} meta={ds.meta} />;
}

/** Axis extents per chart over every slider position, so a slider move never rescales the axes under the learner. */
function extentsOf(spec: DataChartSpec, table: Table, plots: PlotData[]): { x: number[]; y: number[] }[] {
  return plots.map((pd) => {
    const out = { x: [] as number[], y: [] as number[] };
    for (const s of pd.series) {
      const e: Extent | undefined = seriesExtent(spec, table, s.id);
      if (!e) continue;
      out.x.push(...e.x);
      if (s.mark !== "rug") out.y.push(...e.y);
    }
    return out;
  });
}

function Chart({ entry, view, compact, onGoalMet, onPredict, initial, spec, table, meta }: WidgetProps & { spec: DataChartSpec; table: Table; meta: DatasetMeta }) {
  const rt = useWidgetRuntime(spec, view, onPredict, initial);
  const scope = useMemo(() => withDerived(spec, rt.params), [spec, rt.params]);
  const readouts = useMemo(() => readoutValues(spec, scope), [spec, scope]);
  rt.readouts.current = readouts;
  const goal = useGoal(rt, useMemo(() => ({ ...scope, ...readouts }), [scope, readouts]), onGoalMet);
  const plots = useMemo(() => chartSet(spec, table, rt.params), [spec, table, rt.params]);
  const extents = useMemo(() => extentsOf(spec, table, chartSet(spec, table)), [spec, table]);

  // What a view shows, as the panels widget decides it: if `show` names any series or annotation only those are
  // drawn; otherwise a named panel shows whole; a panel is on screen if it is named or holds a named element.
  const elementIds = plots.flatMap((p) => [...p.series.map((s) => s.id), ...p.plot.annotations.map((a) => a.id)]);
  const anyNamed = elementIds.some((id) => rt.listed(id) === true);
  const named = (id: string, panel: string) => rt.listed(id) !== false || (!anyNamed && !!panel && rt.listed(panel) === true);
  const shown = (id: string, panel: string) => !rt.pending(id) && named(id, panel);
  const many = plots.length > 1;
  const visible = plots
    .map((pd, i) => ({ pd, ext: extents[i]! }))
    .filter(({ pd }) => !many || (!rt.pending(pd.plot.id) && (rt.listed(pd.plot.id) !== false || [...pd.series.map((s) => s.id), ...pd.plot.annotations.map((a) => a.id)].some((id) => named(id, pd.plot.id)))));
  const markerMode = !!rt.predict && !rt.predict.options && rt.predict.readout === undefined;
  const approxAll = isApproximate(meta);
  let colorIndex = 0;

  const charts = visible.map(({ pd, ext }, i) => {
    const series: SeriesView[] = pd.series.map((s) => {
      const allowed = shown(s.id, pd.plot.id);
      return { ...s, color: resolveColor(s.color, colorIndex++), allowed, on: allowed && !rt.flag(`off:${s.id}`) };
    });
    return (
      <ChartPlot
        key={pd.plot.id || "chart"}
        title={many ? pd.plot.title : undefined}
        ariaTitle={`${spec.title ?? entry.name}${pd.plot.title ? ` - ${pd.plot.title}` : ""}`}
        spec={spec}
        data={pd}
        series={series}
        ext={ext}
        rt={rt}
        meta={meta}
        approxAll={approxAll}
        shownNote={(id) => shown(id, pd.plot.id)}
        height={compact ? (many ? 240 : 260) : many ? 260 : 340}
        share={many ? { parts: visible.length, axes: visible.length, axis: true } : undefined}
        marker={markerMode && i === 0}
      />
    );
  });

  return (
    <WidgetFrame
      entry={entry}
      rt={rt}
      compact={compact}
      stage={
        <>
          {many ? <div className="w-panels w-chart-panels">{charts}</div> : charts}
          <Note meta={meta} approx={approxAll} />
        </>
      }
      predict={
        <PredictPanel
          predict={rt.predict}
          howTo="Drag the marker to the level you expect."
          value={rt.predict?.marker?.[1]}
          describe={(v) => format(".3~r", v)}
        />
      }
      readouts={
        <Readouts
          rt={rt}
          notation={entry.notation}
          items={(spec.readouts ?? []).map((r) => ({ id: r.id, tex: r.tex, label: r.label, format: r.format, labels: r.labels, value: readouts[r.id] ?? NaN }))}
        />
      }
      params={<ParamPanel rt={rt} notation={entry.notation} />}
      tools={<HintButton goal={goal} />}
      feedback={<GoalFeedback goal={goal} />}
    />
  );
}

type PlotProps = {
  title?: string;
  ariaTitle: string;
  spec: DataChartSpec;
  data: PlotData;
  series: SeriesView[];
  ext: { x: number[]; y: number[] };
  rt: Runtime;
  meta: DatasetMeta;
  approxAll: boolean;
  shownNote: (id: string) => boolean;
  height: number;
  share?: PlotShare;
  marker: boolean;
};

/** One chart: its axes, marks, labels, hover card and legend. */
function ChartPlot({ title, ariaTitle, spec, data, series, ext, rt, meta, approxAll, shownNote, height, share, marker }: PlotProps) {
  const [hover, setHover] = useState<number | null>(null);
  const { plot } = data;
  const drawn = series.filter((s) => s.on);
  const readable = drawn.filter((s) => s.mark !== "rug" && !s.drag);

  // Annotations sit at an x (a year, a date or a band name); one that matches nothing in the data is skipped.
  const notes = plot.annotations.flatMap((a) => {
    const x = locate(data, a.x);
    return x === undefined ? [] : [{ ...a, at: x }];
  });
  const barred = data.series.some((s) => s.mark === "bar");
  const based = barred || data.series.some((s) => s.mark === "area");
  const xs = useMemo(() => allX(data.series.filter((s) => s.mark === "bar")), [data]);
  const xr = useMemo(() => xRange(plot.x, data, ext.x, xs, barred, notes.map((n) => n.at)), [plot.x, data, ext.x, xs, barred, notes]);
  const yr = useMemo(() => yRange(plot.y, ext.y, based, notes.flatMap((n) => (n.y === undefined ? [] : [n.y]))), [plot.y, ext.y, based, notes]);

  const xTicks = useMemo(() => {
    if (data.kind !== "band") return undefined;
    const every = Math.max(1, Math.ceil(data.bands.length / (height < 300 ? 5 : 9)));
    return data.bands.flatMap((b, i) => (i % every === 0 ? [{ at: i, label: b }] : []));
  }, [data, height]);

  const lookup = useMemo(() => new Map(data.series.map((s) => [s.id, new Map(s.points.map((p) => [p.x, p]))])), [data]);
  const snapTo = (u: number): number | null => {
    const all = allX(readable);
    if (!all.length) return null;
    let lo = 0;
    let hi = all.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (all[mid]! <= u) lo = mid;
      else hi = mid;
    }
    return Math.abs(all[lo]! - u) <= Math.abs(all[hi]! - u) ? all[lo]! : all[hi]!;
  };

  const labels: PlotLabel[] = [];
  for (const s of drawn) {
    if (s.mark !== "line" && s.mark !== "area") continue;
    const last = s.points[s.points.length - 1];
    if (last) labels.push({ id: s.id, x: last.x, y: last.y, content: nameOf(s), color: s.color, anchor: "nw", avoid: true, className: rt.isRevealed(s.id) ? "w-reveal" : undefined });
  }
  const shownNotes = notes.filter((n) => shownNote(n.id));
  for (const n of shownNotes) {
    labels.push({ id: `note-${n.id}`, x: n.at, y: n.y ?? yr[1], content: <span>{n.label}</span>, anchor: n.y === undefined ? "se" : "ne", className: `w-label-shock${rt.isRevealed(n.id) ? " w-reveal" : ""}` });
  }

  const col = (name: string) => {
    const unit = meta.columns[name]?.unit;
    return unit && unit !== name ? `${name} (${unit})` : name;
  };
  const axisTitle = (a: { label?: string; tex?: string; column: string }) => (a.label || a.tex ? { label: a.label, tex: a.tex } : { label: col(a.column) });
  const approx = (p: ChartPoint) => approxAll || p.approx;

  return (
    <div className="w-chart-panel" data-panel={plot.id || undefined}>
      {title ? <div className="w-panel-title">{title}</div> : null}
      <PlotFrame
        x={xr}
        y={yr}
        height={height}
        share={share}
        xTickLabels={xTicks}
        xTitle={axisTitle(plot.x)}
        yTitle={axisTitle(plot.y)}
        labels={labels}
        ariaLabel={`${ariaTitle}: ${data.series.map((s) => s.label ?? s.id).join(", ")}`}
        onHover={(u) => setHover(u === null ? null : snapTo(u))}
        overlay={(px) => (hover === null ? null : <HoverCard x={hover} series={readable} lookup={lookup} approx={approx} at={px(hover, yr[1])} right={hover > (xr[0] + xr[1]) / 2} />)}
      >
        <Marks series={drawn} rt={rt} xs={xs} hover={hover} lookup={lookup} />
        <Notes notes={shownNotes} rt={rt} />
        {drawn.filter((s) => s.drag).map((s) => <DragPoint key={s.id} spec={spec} s={s} rt={rt} />)}
        {marker ? <PredictMarker rt={rt} axis="y" fmt={(v) => format(".3~r", v)} /> : null}
      </PlotFrame>
      <Legend series={series.filter((s) => !s.drag)} rt={rt} />
    </div>
  );
}

const nameOf = (s: { tex?: string; label?: string; id: string }) => (s.tex ? <Tex tex={s.tex} /> : <span>{s.label ?? s.id}</span>);

const allX = (series: { points: ChartPoint[] }[]) => [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);

type AxisSpec = { min?: number; max?: number };

function xRange(axis: AxisSpec, data: PlotData, ext: number[], barXs: number[], barred: boolean, extra: number[]): Range {
  let lo: number;
  let hi: number;
  if (data.kind === "band") [lo, hi] = [-0.5, Math.max(0.5, data.bands.length - 0.5)];
  else {
    const e = extent([...ext, ...extra]) ?? [0, 1];
    const gap = barXs.length > 1 ? Math.min(...barXs.slice(1).map((v, i) => v - barXs[i]!)) : 1;
    const pad = barred ? 0.6 * gap : (e[1] - e[0]) * 0.03 || 1;
    [lo, hi] = [e[0] - pad, e[1] + pad];
  }
  const range: Range = [axis.min ?? lo, axis.max ?? hi];
  return range[1] > range[0] ? range : [range[0], range[0] + 1];
}

function yRange(axis: AxisSpec, ext: number[], based: boolean, extra: number[]): Range {
  const e = extent([...ext, ...extra]) ?? [0, 1];
  let [lo, hi] = e;
  if (based) [lo, hi] = [Math.min(lo, 0), Math.max(hi, 0)];
  else if (lo >= 0 && lo < 0.5 * hi) lo = 0;
  const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.1 || 1;
  const target = nice(lo === 0 ? 0 : lo - pad, hi === 0 ? 0 : hi + pad);
  const range: Range = [axis.min ?? target[0], axis.max ?? target[1]];
  return range[1] > range[0] ? range : [range[0], range[0] + 1];
}

type Lookup = Map<string, Map<number, ChartPoint>>;

function Marks({ series, rt, xs, hover, lookup }: { series: SeriesView[]; rt: Runtime; xs: number[]; hover: number | null; lookup: Lookup }) {
  const plot = usePlot();
  const hl = (id: string) => rt.highlight === id;
  const reveal = (id: string) => (rt.isRevealed(id) ? "w-reveal" : undefined);
  const gap = xs.length > 1 ? Math.min(...xs.slice(1).map((v, i) => v - xs[i]!)) : 1;
  const slot = 0.8 * gap;
  const base = Math.min(plot.y[1], Math.max(plot.y[0], 0));
  const bars = series.filter((s) => s.mark === "bar");
  // A rug's ticks rise from the bottom of the plot, 6% of its height.
  const tick = (plot.y[1] - plot.y[0]) * 0.06;

  return (
    <>
      <Clip>
        {series.map((s) => {
          const key = `${s.id}|${rt.viewKey}`;
          if (s.drag) return null;
          const pts: Pt[] = s.points.map((p) => [p.x, p.y]);
          if (s.mark === "line" || s.mark === "area") {
            const d = pathD(pts, plot);
            const first = s.points[0];
            const last = s.points[s.points.length - 1];
            const fill =
              s.mark === "area" && first && last
                ? `${d}L${plot.sx(last.x).toFixed(2)},${plot.sy(base).toFixed(2)}L${plot.sx(first.x).toFixed(2)},${plot.sy(base).toFixed(2)}Z`
                : "";
            return (
              <g key={key}>
                {fill ? <Area d={fill} color={s.color} highlight={hl(s.id)} className={reveal(s.id)} /> : null}
                <Curve id={s.id} d={d} color={s.color} highlight={hl(s.id)} draw className={reveal(s.id)} />
              </g>
            );
          }
          if (s.mark === "point") {
            return (
              <g key={key} className={`w-mark w-points${reveal(s.id) ? " w-reveal" : ""}`} data-el={s.id}>
                {s.points.map((p, i) => (
                  <circle key={i} cx={plot.sx(p.x)} cy={plot.sy(p.y)} r={hl(s.id) ? 4.75 : 3.75} style={{ fill: s.color }} />
                ))}
              </g>
            );
          }
          if (s.mark === "rug") {
            return (
              <g key={key} className={`w-mark w-rug${hl(s.id) ? " w-rug-hl" : ""}${reveal(s.id) ? " w-reveal" : ""}`} data-el={s.id}>
                {s.points.map((p, i) => (
                  <line key={i} x1={plot.sx(p.x)} x2={plot.sx(p.x)} y1={plot.sy(plot.y[0])} y2={plot.sy(plot.y[0] + tick)} style={{ stroke: s.color }} />
                ))}
              </g>
            );
          }
          // bars: the bar series share each x's slot, side by side
          const k = bars.indexOf(s);
          const bw = slot / bars.length;
          return (
            <g key={key} className={`w-mark w-bars${hl(s.id) ? " w-bars-hl" : ""}${reveal(s.id) ? " w-reveal" : ""}`} data-el={s.id}>
              {s.points.map((p, i) => {
                const left = p.x - slot / 2 + k * bw;
                const x0 = plot.sx(left);
                const w = Math.max(1, plot.sx(left + bw) - x0 - 1);
                const y0 = plot.sy(Math.max(p.y, base));
                const h = Math.abs(plot.sy(p.y) - plot.sy(base));
                return <rect key={i} x={x0} y={y0} width={w} height={h} rx={1.5} style={{ fill: s.color }} />;
              })}
            </g>
          );
        })}
        {hover !== null ? <Segment a={[hover, plot.y[0]]} b={[hover, plot.y[1]]} color="var(--chart-axis)" width={1} className="w-crosshair" /> : null}
      </Clip>
      {hover !== null
        ? series.flatMap((s) => {
            const p = s.mark === "rug" || s.drag ? undefined : lookup.get(s.id)?.get(hover);
            return p ? [<Dot key={`h${s.id}`} at={[p.x, p.y]} color={s.color} r={3.5} />] : [];
          })
        : null}
    </>
  );
}

/** A point that sets two params: dragged, it snaps both to their slider positions; arrow keys step them one position
 *  at a time (Mafs' own keyboard step is a fraction of the plot, which a coarse grid would snap straight back). */
function DragPoint({ spec, s, rt }: { spec: DataChartSpec; s: SeriesView; rt: Runtime }) {
  const { x: px, y: py } = s.drag!;
  const ps = { x: spec.params![px]!, y: spec.params![py]! };
  const at = s.points[0];
  const free = { x: !rt.isLocked(px), y: !rt.isLocked(py) };
  if (!at) return null;
  const name = s.label ?? s.id;
  const valueText = `${ps.x.label ?? px} ${paramText(ps.x, at.x)}, ${ps.y.label ?? py} ${paramText(ps.y, at.y)}`;
  if (!free.x && !free.y) return <Dot id={s.id} at={[at.x, at.y]} color={s.color} r={5} highlight={rt.highlight === s.id} />;
  const move = ([x, y]: [number, number]) => rt.set({ ...(free.x ? { [px]: snap(ps.x, x) } : {}), ...(free.y ? { [py]: snap(ps.y, y) } : {}) });
  const keys = (e: KeyboardEvent) => {
    const dir = { ArrowRight: ["x", 1], ArrowLeft: ["x", -1], ArrowUp: ["y", 1], ArrowDown: ["y", -1] }[e.key] as ["x" | "y", number] | undefined;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    const [axis, sign] = dir;
    if (!free[axis]) return;
    const p = ps[axis];
    const id = axis === "x" ? px : py;
    const k = nearestPosition(p, rt.params[id] ?? p.default) + sign * (e.shiftKey ? 5 : 1);
    rt.set({ [id]: positionValue(p, k) });
  };
  return (
    <g onKeyDownCapture={keys} data-el={s.id}>
      <DragHandle
        id={s.id}
        at={[at.x, at.y]}
        onMove={move}
        axis={free.x && free.y ? "both" : free.x ? "x" : "y"}
        color={s.color}
        label={`${name}: arrow keys move it one step (${stepOf(ps.x)} in ${px}, ${stepOf(ps.y)} in ${py})`}
        value={free.x ? { now: at.x, min: ps.x.min, max: ps.x.max } : { now: at.y, min: ps.y.min, max: ps.y.max }}
        valueText={valueText}
        className={rt.highlight === s.id ? "w-handle-hl" : undefined}
      />
    </g>
  );
}

function Notes({ notes, rt }: { notes: { id: string; at: number; y?: number }[]; rt: Runtime }) {
  const plot = usePlot();
  return (
    <>
      <Clip>
        {notes.map((n) =>
          n.y === undefined ? (
            <Segment key={n.id} id={n.id} a={[n.at, plot.y[0]]} b={[n.at, plot.y[1]]} color="var(--chart-axis)" style="dashed" width={1.25} highlight={rt.highlight === n.id} className={rt.isRevealed(n.id) ? "w-reveal" : undefined} />
          ) : null,
        )}
      </Clip>
      {notes.map((n) => (n.y === undefined ? null : <Dot key={n.id} id={n.id} at={[n.at, n.y]} color="var(--text)" r={4.5} highlight={rt.highlight === n.id} className={rt.isRevealed(n.id) ? "w-reveal" : undefined} />))}
    </>
  );
}

function HoverCard({ x, series, lookup, approx, at, right }: { x: number; series: SeriesView[]; lookup: Lookup; approx: (p: ChartPoint) => boolean; at: [number, number]; right: boolean }) {
  const rows = series.flatMap((s) => {
    const p = lookup.get(s.id)?.get(x);
    return p ? [{ s, p }] : [];
  });
  if (!rows.length) return null;
  const head = rows[0]!.p.label;
  return (
    <div className={`w-hover${right ? " w-hover-left" : ""}`} style={{ left: `${at[0].toFixed(1)}px`, top: `${(at[1] + 4).toFixed(1)}px` }}>
      <div className="w-hover-t">{head}</div>
      {rows.map(({ s, p }) => (
        <div key={s.id} className="w-hover-row">
          <span className="w-swatch" style={{ background: s.color }} />
          {nameOf(s)} <span className="w-hover-v">{`${approx(p) ? "≈" : ""}${format(undefined, p.y)}`}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ series, rt }: { series: SeriesView[]; rt: Runtime }) {
  if (series.length < 2) return null;
  return (
    <div className="w-legend" role="group" aria-label="Series">
      {series.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`w-legend-item${rt.highlight === s.id ? " w-hl" : ""}`}
          data-series={s.id}
          aria-pressed={s.on}
          disabled={!s.allowed}
          title={s.allowed ? undefined : "Not part of this step"}
          onClick={() => rt.setFlag(`off:${s.id}`, s.on)}
        >
          <span className="w-swatch" style={{ background: s.color }} />
          {nameOf(s)}
        </button>
      ))}
    </div>
  );
}

function Note({ meta, approx }: { meta: DatasetMeta; approx: boolean }) {
  return (
    <p className="w-data-note">
      {approx ? (
        <>
          <strong>≈ Approximate:</strong> read off a published chart.{" "}
        </>
      ) : null}
      Data: {meta.title}
      {meta.period && !meta.title.includes(meta.period) ? ` (${meta.period})` : ""}.
    </p>
  );
}
