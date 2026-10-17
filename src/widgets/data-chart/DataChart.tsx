// data-chart: a dataset drawn as lines, bars, areas or points. Series come from filtered rows of a long-format
// dataset (or from separate columns), each with a legend chip that toggles it; hovering reads every shown series at
// the nearest x; annotations mark events. Values are shown with ≈ where the dataset says they were read off a chart.
//
// It draws on the shared PlotFrame (Mafs canvas, the runtime's axes, labels and hover overlay) rather than Observable
// Plot: the chart then looks and themes exactly like the other widgets, axis titles and labels get KaTeX for free, and
// the learner-facing parts (presets, predictions, goals) already live around that frame. Plot would add a second
// rendering stack and ~200 KB of d3 for marks this file draws in a few lines.
import "../data/data.css";
import { useMemo, useState } from "react";
import { Tex } from "../../lib/Tex";
import { resolveColor } from "../core/colors";
import { readoutValues } from "../core/evaluate";
import type { DataChartSpec } from "../core/types";
import { type Runtime, useGoal, useWidgetRuntime } from "../core/useWidgetRuntime";
import { isApproximate } from "../data/approx";
import { DatasetError, DatasetLoading } from "../data/DatasetCards";
import { useDataset } from "../data/fetch";
import { PredictMarker } from "../data/PredictMarker";
import { withDerived } from "../expr";
import { format } from "../format";
import type { WidgetProps } from "../host";
import type { DatasetMeta } from "../../ir";
import { Area, Clip, Curve, Dot, pathD, type Pt, Segment } from "../plot/marks";
import { type PlotLabel, PlotFrame, usePlot } from "../plot/PlotFrame";
import { extent, nice, type Range } from "../plot/ticks";
import { GoalFeedback, HintButton, PredictPanel } from "../ui/Feedback";
import { ParamPanel } from "../ui/ParamPanel";
import { Readouts } from "../ui/Readouts";
import { WidgetFrame } from "../ui/WidgetFrame";
import { type ChartData, type ChartPoint, chartData, locate, type SeriesData } from "./series";

type Mark = NonNullable<DataChartSpec["mark"]>;
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
  const built = useMemo(() => {
    if (!table) return null;
    try {
      return { data: chartData(spec, table) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [spec, table]);

  if (ds.status === "loading") return <DatasetLoading entry={props.entry} />;
  if (ds.status === "error") return <DatasetError entry={props.entry} message={ds.message} retry={ds.retry} />;
  if (!built || "error" in built) return <DatasetError entry={props.entry} message={built && "error" in built ? built.error! : "no data"} />;
  return <Chart {...props} spec={spec} data={built.data} meta={ds.meta} />;
}

function Chart({ entry, view, compact, onGoalMet, onPredict, initial, spec, data, meta }: WidgetProps & { spec: DataChartSpec; data: ChartData; meta: DatasetMeta }) {
  const rt = useWidgetRuntime(spec, view, onPredict, initial);
  const scope = useMemo(() => withDerived(spec, rt.params), [spec, rt.params]);
  const readouts = useMemo(() => readoutValues(spec, scope), [spec, scope]);
  const goal = useGoal(rt, useMemo(() => ({ ...scope, ...readouts }), [scope, readouts]), onGoalMet);
  const [hover, setHover] = useState<number | null>(null);

  const mark: Mark = spec.mark ?? "line";
  const approxAll = isApproximate(meta);
  const series: SeriesView[] = data.series.map((s, i) => {
    const allowed = rt.isShown(s.id);
    return { ...s, color: resolveColor(s.color, i), allowed, on: allowed && !rt.flag(`off:${s.id}`) };
  });
  const drawn = series.filter((s) => s.on);

  // Annotations sit at an x (a year, a date or a band name); one that matches nothing in the data is skipped.
  const notes = (spec.annotations ?? []).flatMap((a) => {
    const x = locate(data, a.x);
    return x === undefined ? [] : [{ ...a, at: x }];
  });

  // Ranges follow all the series, shown or not, so toggling one never rescales the axes under the learner.
  const xr = useMemo(() => xRange(spec, data, mark, notes.map((n) => n.at)), [spec, data, mark, notes]);
  const yr = useMemo(() => yRange(spec, data, mark, notes.flatMap((n) => (n.y === undefined ? [] : [n.y]))), [spec, data, mark, notes]);

  const xTicks = useMemo(() => {
    if (data.kind !== "band") return undefined;
    const every = Math.max(1, Math.ceil(data.bands.length / (compact ? 5 : 9)));
    return data.bands.flatMap((b, i) => (i % every === 0 ? [{ at: i, label: b }] : []));
  }, [data, compact]);

  const lookup = useMemo(() => new Map(data.series.map((s) => [s.id, new Map(s.points.map((p) => [p.x, p]))])), [data]);
  const snapTo = (u: number): number | null => {
    const xs = [...new Set(drawn.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
    if (!xs.length) return null;
    let lo = 0;
    let hi = xs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid]! <= u) lo = mid;
      else hi = mid;
    }
    return Math.abs(xs[lo]! - u) <= Math.abs(xs[hi]! - u) ? xs[lo]! : xs[hi]!;
  };

  const showEnds = (mark === "line" || mark === "area") && drawn.length > 0;
  const labels: PlotLabel[] = [];
  if (showEnds) {
    for (const s of drawn) {
      const last = s.points[s.points.length - 1];
      if (last) labels.push({ id: s.id, x: last.x, y: last.y, content: nameOf(s), color: s.color, anchor: "nw", avoid: true, className: rt.isRevealed(s.id) ? "w-reveal" : undefined });
    }
  }
  const shownNotes = notes.filter((n) => rt.isShown(n.id));
  for (const n of shownNotes) {
    labels.push({ id: `note-${n.id}`, x: n.at, y: n.y ?? yr[1], content: <span>{n.label}</span>, anchor: n.y === undefined ? "se" : "ne", className: `w-label-shock${rt.isRevealed(n.id) ? " w-reveal" : ""}` });
  }

  const col = (name: string) => {
    const unit = meta.columns[name]?.unit;
    return unit && unit !== name ? `${name} (${unit})` : name;
  };
  const axisTitle = (a: { label?: string; tex?: string; column: string }) => (a.label || a.tex ? { label: a.label, tex: a.tex } : { label: col(a.column) });
  const markerMode = !!rt.predict && !rt.predict.options && rt.predict.readout === undefined;
  const approx = (p: ChartPoint) => approxAll || p.approx;

  return (
    <WidgetFrame
      entry={entry}
      rt={rt}
      compact={compact}
      stage={
        <>
          <PlotFrame
            x={xr}
            y={yr}
            height={compact ? 260 : 340}
            xTickLabels={xTicks}
            xTitle={axisTitle({ ...spec.x })}
            yTitle={axisTitle({ ...spec.y })}
            labels={labels}
            ariaLabel={`${spec.title ?? entry.name}: ${data.series.map((s) => s.label ?? s.id).join(", ")}`}
            onHover={(u) => setHover(u === null ? null : snapTo(u))}
            overlay={(px) => (hover === null ? null : <HoverCard x={hover} data={data} series={drawn} lookup={lookup} approx={approx} at={px(hover, yr[1])} right={hover > (xr[0] + xr[1]) / 2} />)}
          >
            <Marks mark={mark} series={drawn} rt={rt} xs={allX(data)} hover={hover} lookup={lookup} />
            <Notes notes={shownNotes} rt={rt} />
            {markerMode ? <PredictMarker rt={rt} axis="y" fmt={(v) => format(".3~r", v)} /> : null}
          </PlotFrame>
          <Legend series={series} rt={rt} />
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

const nameOf = (s: { tex?: string; label?: string; id: string }) => (s.tex ? <Tex tex={s.tex} /> : <span>{s.label ?? s.id}</span>);

const allX = (data: ChartData) => [...new Set(data.series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);

function xRange(spec: DataChartSpec, data: ChartData, mark: Mark, extra: number[]): Range {
  let lo: number;
  let hi: number;
  if (data.kind === "band") [lo, hi] = [-0.5, Math.max(0.5, data.bands.length - 0.5)];
  else {
    const e = extent([...data.series.flatMap((s) => s.points.map((p) => p.x)), ...extra]) ?? [0, 1];
    const xs = allX(data);
    const gap = xs.length > 1 ? Math.min(...xs.slice(1).map((v, i) => v - xs[i]!)) : 1;
    const pad = mark === "bar" ? 0.6 * gap : (e[1] - e[0]) * 0.03 || 1;
    [lo, hi] = [e[0] - pad, e[1] + pad];
  }
  const range: Range = [spec.x.min ?? lo, spec.x.max ?? hi];
  return range[1] > range[0] ? range : [range[0], range[0] + 1];
}

function yRange(spec: DataChartSpec, data: ChartData, mark: Mark, extra: number[]): Range {
  const e = extent([...data.series.flatMap((s) => s.points.map((p) => p.y)), ...extra]) ?? [0, 1];
  let [lo, hi] = e;
  if (mark === "bar" || mark === "area") [lo, hi] = [Math.min(lo, 0), Math.max(hi, 0)];
  else if (lo >= 0 && lo < 0.5 * hi) lo = 0;
  const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.1 || 1;
  const target = nice(lo === 0 ? 0 : lo - pad, hi === 0 ? 0 : hi + pad);
  const range: Range = [spec.y.min ?? target[0], spec.y.max ?? target[1]];
  return range[1] > range[0] ? range : [range[0], range[0] + 1];
}

type Lookup = Map<string, Map<number, ChartPoint>>;

function Marks({ mark, series, rt, xs, hover, lookup }: { mark: Mark; series: SeriesView[]; rt: Runtime; xs: number[]; hover: number | null; lookup: Lookup }) {
  const plot = usePlot();
  const hl = (id: string) => rt.highlight === id;
  const reveal = (id: string) => (rt.isRevealed(id) ? "w-reveal" : undefined);
  const gap = xs.length > 1 ? Math.min(...xs.slice(1).map((v, i) => v - xs[i]!)) : 1;
  const slot = 0.8 * gap;
  const base = Math.min(plot.y[1], Math.max(plot.y[0], 0));

  return (
    <>
      <Clip>
        {series.map((s, k) => {
          const key = `${s.id}|${rt.viewKey}`;
          const pts: Pt[] = s.points.map((p) => [p.x, p.y]);
          if (mark === "line" || mark === "area") {
            const d = pathD(pts, plot);
            const first = s.points[0];
            const last = s.points[s.points.length - 1];
            const fill =
              mark === "area" && first && last
                ? `${d}L${plot.sx(last.x).toFixed(2)},${plot.sy(base).toFixed(2)}L${plot.sx(first.x).toFixed(2)},${plot.sy(base).toFixed(2)}Z`
                : "";
            return (
              <g key={key}>
                {fill ? <Area d={fill} color={s.color} highlight={hl(s.id)} className={reveal(s.id)} /> : null}
                <Curve id={s.id} d={d} color={s.color} highlight={hl(s.id)} draw className={reveal(s.id)} />
              </g>
            );
          }
          if (mark === "point") {
            return (
              <g key={key} className={`w-mark w-points${reveal(s.id) ? " w-reveal" : ""}`} data-el={s.id}>
                {s.points.map((p, i) => (
                  <circle key={i} cx={plot.sx(p.x)} cy={plot.sy(p.y)} r={hl(s.id) ? 4.75 : 3.75} style={{ fill: s.color }} />
                ))}
              </g>
            );
          }
          // bars: the series share each x's slot, side by side
          const bw = slot / series.length;
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
            const p = lookup.get(s.id)?.get(hover);
            return p ? [<Dot key={`h${s.id}`} at={[p.x, p.y]} color={s.color} r={3.5} />] : [];
          })
        : null}
    </>
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

function HoverCard({ x, data, series, lookup, approx, at, right }: { x: number; data: ChartData; series: SeriesView[]; lookup: Lookup; approx: (p: ChartPoint) => boolean; at: [number, number]; right: boolean }) {
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
