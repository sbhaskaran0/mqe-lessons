// distribution: a distribution that is either a dataset column (optionally weighted) or a parametric family whose
// parameters are expressions over the widget's sliders, with four views (histogram, density, Lorenz curve, CDF) and
// inequality measures as live readouts. The measures are built-in scalars, so goals and readouts can read them
// (`gini > 0.4`). All the maths is in measures.ts and shapes.ts; this file is layout and drawing.
import "../data/data.css";
import { useMemo, useState } from "react";
import { Tex } from "../../lib/Tex";
import type { DatasetMeta } from "../../ir";
import { readoutValues } from "../core/evaluate";
import type { DistributionSpec } from "../core/types";
import { type Runtime, useGoal, useWidgetRuntime } from "../core/useWidgetRuntime";
import { isApproximate } from "../data/approx";
import { DatasetError, DatasetLoading } from "../data/DatasetCards";
import { useDataset } from "../data/fetch";
import { PredictMarker } from "../data/PredictMarker";
import type { Table } from "../data/table";
import { distributionOf, familyParams, withDerived } from "../expr";
import { format } from "../format";
import type { WidgetProps } from "../host";
import { Area, Bars, Clip, Curve, Dot, pathD, type Pt, Segment } from "../plot/marks";
import { type PlotLabel, PlotFrame, usePlot } from "../plot/PlotFrame";
import { nice, type Range } from "../plot/ticks";
import { useAnimatedRange, useStickyRange } from "../plot/useRange";
import { GoalFeedback, HintButton, PredictPanel } from "../ui/Feedback";
import { ParamPanel } from "../ui/ParamPanel";
import { type ReadoutItem, Readouts } from "../ui/Readouts";
import { WidgetFrame } from "../ui/WidgetFrame";
import { DIST_VIEWS } from "../spec";
import { type Dist, type FamilyParams, type Measure, parametric } from "./measures";
import { cdfCurve, density, fromU, histogram, logAxis, logTicks, lorenzCurve, toU, xRange } from "./shapes";

type View = (typeof DIST_VIEWS)[number];
const VIEW_NAMES: Record<View, string> = { histogram: "Histogram", density: "Density", lorenz: "Lorenz curve", cdf: "CDF" };

const MEASURE_ITEMS: Record<Measure, Omit<ReadoutItem, "id" | "value">> = {
  gini: { tex: "\\text{Gini}", label: "Gini coefficient", format: ".3f" },
  p90p10: { tex: "p_{90}/p_{10}", label: "90/10 percentile ratio", format: ".2f" },
  p50p10: { tex: "p_{50}/p_{10}", label: "50/10 percentile ratio", format: ".2f" },
  p90p50: { tex: "p_{90}/p_{50}", label: "90/50 percentile ratio", format: ".2f" },
  varlog: { tex: "\\mathrm{Var}(\\ln x)", label: "Variance of log values", format: ".3f" },
  mean: { tex: "\\text{Mean}", label: "Mean" },
  median: { tex: "\\text{Median}", label: "Median" },
  cv: { tex: "\\mathrm{CV}", label: "Coefficient of variation", format: ".3f" },
  top10: { tex: "\\text{Top }10\\%", label: "Share held by the top 10%", format: ".1%" },
};

/** Reference lines each measure draws on the density, histogram and CDF: the quantiles it is built from. */
const LINES: Partial<Record<Measure, { id: string; p?: number }[]>> = {
  p90p10: [{ id: "p10", p: 0.1 }, { id: "p90", p: 0.9 }],
  p50p10: [{ id: "p10", p: 0.1 }, { id: "p50", p: 0.5 }],
  p90p50: [{ id: "p50", p: 0.5 }, { id: "p90", p: 0.9 }],
  median: [{ id: "p50", p: 0.5 }],
  mean: [{ id: "mean" }],
};

export default function Distribution(props: WidgetProps) {
  const spec = props.entry.spec as DistributionSpec;
  if (spec.dataset !== undefined) return <FromDataset {...props} spec={spec} dataset={spec.dataset} />;
  return <Body {...props} spec={spec} table={null} />;
}

function FromDataset(props: WidgetProps & { spec: DistributionSpec; dataset: string }) {
  const ds = useDataset(props.dataset, props.datasets, props.contentBase);
  if (ds.status === "loading") return <DatasetLoading entry={props.entry} />;
  if (ds.status === "error") return <DatasetError entry={props.entry} message={ds.message} retry={ds.retry} />;
  return <Body {...props} table={ds.table} meta={ds.meta} />;
}

function Body({ entry, view, compact, onGoalMet, onPredict, initial, spec, table, meta }: WidgetProps & { spec: DistributionSpec; table: Table | null; meta?: DatasetMeta }) {
  const rt = useWidgetRuntime(spec, view, onPredict, initial);
  const scope = useMemo(() => withDerived(spec, rt.params), [spec, rt.params]);

  // The distribution depends on the sliders only through the family's parameters, so moving an unrelated slider
  // (or a derived value the family never reads) doesn't rebuild it.
  // (A NaN parameter serializes as null, which `parametric` rejects like any other invalid value.)
  const famKey = JSON.stringify(spec.family ? familyParams(spec, scope) : null);
  const built = useMemo(() => {
    try {
      return { dist: spec.family ? parametric(spec.family, JSON.parse(famKey) as FamilyParams) : distributionOf(spec, {}, table ?? undefined) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [spec, famKey, table]);
  const dist: Dist | null = "error" in built ? null : built.dist;
  const measures = dist?.measures;

  const readouts = useMemo(() => readoutValues(spec, { ...scope, ...measures }), [spec, scope, measures]);
  const goal = useGoal(rt, useMemo(() => ({ ...scope, ...measures, ...readouts }), [scope, measures, readouts]), onGoalMet);

  const declared = (spec.views ?? (spec.dataset !== undefined ? ["histogram", "lorenz"] : ["density", "lorenz"])) as View[];
  const shown = declared.filter((v, i) => declared.indexOf(v) === i && rt.isShown(v));
  const [pick, setPick] = useState<{ key: string; view: View | null }>({ key: rt.viewKey, view: null });
  const chosen = pick.key === rt.viewKey ? pick.view : null;
  const active = shown.find((v) => v === chosen) ?? shown.find((v) => v === rt.highlight) ?? shown[0];

  if ("error" in built) return <DatasetError entry={entry} message={built.error!} />;

  const win = xRange(dist!, spec.x?.min, spec.x?.max);
  const log = logAxis(spec.x?.log, win);
  const items: ReadoutItem[] = [
    ...(spec.measures ?? []).map((m) => ({ id: m, ...MEASURE_ITEMS[m], value: dist!.measures[m] })),
    ...(spec.readouts ?? []).map((r) => ({ id: r.id, tex: r.tex, label: r.label, format: r.format, labels: r.labels, value: readouts[r.id] ?? NaN })),
  ];
  const marker = rt.predict?.marker;

  return (
    <WidgetFrame
      entry={entry}
      rt={rt}
      compact={compact}
      stage={
        <>
          {shown.length > 1 ? (
            <div className="w-tabs" role="tablist" aria-label="View">
              {shown.map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  className={`w-tab${rt.highlight === v ? " w-hl" : ""}`}
                  data-view={v}
                  aria-selected={v === active}
                  onClick={() => setPick({ key: rt.viewKey, view: v })}
                >
                  {VIEW_NAMES[v]}
                </button>
              ))}
            </div>
          ) : null}
          {active ? <Panel key={active} view={active} dist={dist!} spec={spec} rt={rt} win={win} log={log} compact={!!compact} title={spec.title ?? entry.name} /> : null}
          <Note spec={spec} meta={meta} />
        </>
      }
      predict={
        <PredictPanel
          predict={rt.predict}
          howTo="Open the density, histogram or CDF and drag the marker to your guess."
          value={marker && active !== "lorenz" ? fromU(marker[0], log) : undefined}
          describe={(v) => `≈ ${format(".3~r", v)}`}
        />
      }
      readouts={<Readouts rt={rt} notation={entry.notation} items={items} />}
      params={<ParamPanel rt={rt} notation={entry.notation} />}
      tools={<HintButton goal={goal} />}
      feedback={<GoalFeedback goal={goal} />}
    />
  );
}

type PanelProps = { view: View; dist: Dist; spec: DistributionSpec; rt: Runtime; win: Range; log: boolean; compact: boolean; title: string };

/** One view. Keyed by the view, so each keeps its own axis ranges (which only grow while the learner moves a slider). */
function Panel(p: PanelProps) {
  return p.view === "lorenz" ? <LorenzPanel {...p} /> : <ValuePanel {...p} />;
}

function ValuePanel({ view, dist, spec, rt, win, log, compact, title }: PanelProps) {
  const valid = Number.isFinite(dist.quantile(0.5));
  const u = useAnimatedRange(useStickyRange([toU(win[0], log), toU(win[1], log)], rt.viewKey));
  const [x0, x1] = [fromU(u[0], log), fromU(u[1], log)];
  const bins = compact ? 28 : 44;

  const shape = useMemo(() => {
    if (!valid) return { bars: [], line: [] as Pt[], top: 1 };
    if (view === "histogram") {
      const bars = histogram(dist, [x0, x1], log, bins);
      return { bars, line: [] as Pt[], top: Math.max(...bars.map((b) => b.height), 1e-12) };
    }
    const line = view === "cdf" ? cdfCurve(dist, [x0, x1], log) : density(dist, [x0, x1], log);
    return { bars: [], line, top: view === "cdf" ? 1 : Math.max(...line.map((q) => (Number.isFinite(q[1]) ? q[1] : 0)), 1e-12) };
  }, [valid, view, dist, x0, x1, log, bins]);

  const yTarget: Range = view === "cdf" ? [0, 1] : nice(0, shape.top * 1.08);
  const y = useAnimatedRange(useStickyRange(yTarget, `${rt.viewKey}|${view}`));

  const ticks = useMemo(() => (log ? logTicks([x0, x1], (x) => (x >= 1000 ? format(".3~s", x) : format(".3~r", x))) : undefined), [log, x0, x1]);

  const lines = referenceLines(spec, dist, rt, log);
  const labels: PlotLabel[] = lines.map((l) => ({ id: l.id, x: l.u, y: y[1], content: <span>{l.id === "mean" ? "mean" : l.id}</span>, anchor: "se", className: "w-label-shock", color: "var(--text-2)" }));
  if (!valid) labels.push(noDistribution((u[0] + u[1]) / 2, (y[0] + y[1]) / 2));
  const color = "var(--chart-1)";
  const hl = rt.highlight === view;

  return (
    <PlotFrame
      x={u}
      y={y}
      height={compact ? 260 : 340}
      xTickLabels={ticks}
      xTitle={xAxisTitle(spec, log)}
      yTitle={view === "cdf" ? { label: "Share at or below x" } : { label: log ? "Density (per log x)" : "Density" }}
      yPercent={view === "cdf"}
      labels={labels}
      ariaLabel={`${title}: ${VIEW_NAMES[view].toLowerCase()}`}
    >
      <Clip>
        {shape.bars.length ? (
          <Bars id="histogram" bars={shape.bars.map((b) => ({ x0: b.u0, x1: b.u1, height: b.height }))} color={color} highlight={hl} className={rt.isRevealed(view) ? "w-reveal" : undefined} />
        ) : null}
        {shape.line.length ? <Line pts={shape.line} view={view} color={color} hl={hl} reveal={rt.isRevealed(view)} /> : null}
        {lines.map((l) => (
          <Segment key={l.id} id={`line-${l.id}`} a={[l.u, y[0]]} b={[l.u, y[1]]} color="var(--chart-axis)" style="dashed" width={1.25} highlight={l.highlight} />
        ))}
      </Clip>
      {rt.predict && !rt.predict.options && rt.predict.readout === undefined ? <PredictMarker rt={rt} axis="x" fmt={(v) => format(".3~r", fromU(v, log))} /> : null}
    </PlotFrame>
  );
}

function Line({ pts, view, color, hl, reveal }: { pts: Pt[]; view: View; color: string; hl: boolean; reveal: boolean }) {
  const plot = usePlot();
  const d = pathD(pts, plot);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const fill = view === "density" && first && last ? `${d}L${plot.sx(last[0]).toFixed(2)},${plot.sy(0).toFixed(2)}L${plot.sx(first[0]).toFixed(2)},${plot.sy(0).toFixed(2)}Z` : "";
  return (
    <>
      {fill ? <Area d={fill} color={color} highlight={hl} className={reveal ? "w-reveal" : undefined} /> : null}
      <Curve id={view} d={d} color={color} highlight={hl} className={reveal ? "w-reveal" : undefined} />
    </>
  );
}

function LorenzPanel({ dist, spec, rt, compact, title }: PanelProps) {
  const defined = Number.isFinite(dist.lorenz(0.5));
  const curve = useMemo(() => (defined ? lorenzCurve(dist) : []), [defined, dist]);
  const range: Range = [0, 1];
  const gini = dist.measures.gini;
  const topShown = (spec.measures ?? []).includes("top10") && rt.isShown("top10");
  const hl = rt.highlight;

  // The shaded gap is widest here, which is where its label sits.
  const widest = curve.reduce<Pt>((best, q) => (q[0] - q[1] > best[0] - best[1] ? q : best), [0, 0]);
  const labels: PlotLabel[] = [];
  if (!compact && defined && Number.isFinite(gini) && !rt.pending("gini")) {
    labels.push({ id: "gini-area", x: widest[0] - 0.07, y: (widest[0] + widest[1]) / 2 + 0.03, content: <Tex tex="\text{shaded}=G/2" />, anchor: "c", className: "w-label-region" });
  }
  if (defined && topShown && !rt.pending("top10")) {
    labels.push({ id: "top10", x: 0.9, y: dist.lorenz(0.9), content: <span>top 10% hold {format(".0%", dist.measures.top10)}</span>, anchor: "sw", color: "var(--text-2)" });
  }
  if (!defined) labels.push(noDistribution(0.5, 0.5, "A Lorenz curve needs non-negative values."));

  return (
    <div className="w-square">
      <PlotFrame
        x={range}
        y={range}
        height={compact ? 280 : 360}
        xTitle={{ label: "Cumulative share of the population" }}
        yTitle={{ label: "Cumulative share of the total" }}
        labels={labels}
        ariaLabel={`${title}: Lorenz curve`}
      >
        {defined ? (
          <>
            {!rt.pending("equality") ? <Segment id="equality" a={[0, 0]} b={[1, 1]} color="var(--chart-axis)" style="dashed" width={1.5} highlight={hl === "equality"} className={rt.isRevealed("equality") ? "w-reveal" : undefined} /> : null}
            <LorenzMarks curve={curve} hl={hl === "lorenz"} reveal={rt.isRevealed("lorenz")} shade={!rt.pending("gini")} shadeHl={hl === "gini"} />
            {topShown && !rt.pending("top10") ? <Dot id="top10-dot" at={[0.9, dist.lorenz(0.9)]} color="var(--chart-2)" r={4.5} highlight={hl === "top10"} /> : null}
          </>
        ) : null}
      </PlotFrame>
    </div>
  );
}

function LorenzMarks({ curve, hl, reveal, shade, shadeHl }: { curve: Pt[]; hl: boolean; reveal: boolean; shade: boolean; shadeHl: boolean }) {
  const plot = usePlot();
  const d = pathD(curve, plot);
  return (
    <>
      {/* The curve out and the equality line back: the area between them is half the Gini. */}
      {shade ? <Area d={`${d}Z`} color="var(--chart-2)" opacity={0.18} highlight={shadeHl} /> : null}
      <Curve id="lorenz" d={d} color="var(--chart-1)" width={2.5} highlight={hl} className={reveal ? "w-reveal" : undefined} />
    </>
  );
}

/** Dotted rules at the quantiles (and mean) behind the measures the widget shows. */
function referenceLines(spec: DistributionSpec, dist: Dist, rt: Runtime, log: boolean) {
  const out: { id: string; u: number; highlight: boolean }[] = [];
  for (const m of spec.measures ?? []) {
    if (!rt.isShown(m)) continue;
    for (const l of LINES[m] ?? []) {
      const x = l.p === undefined ? dist.measures.mean : dist.quantile(l.p);
      const at = toU(x, log);
      if (Number.isFinite(at) && !out.some((o) => o.id === l.id)) out.push({ id: l.id, u: at, highlight: rt.highlight === m });
      else if (rt.highlight === m) {
        const o = out.find((q) => q.id === l.id);
        if (o) o.highlight = true;
      }
    }
  }
  return out;
}

function xAxisTitle(spec: DistributionSpec, log: boolean) {
  const label = spec.x?.label ?? spec.column;
  const tex = spec.x?.tex ?? (label ? undefined : "x");
  return { label: label && log ? `${label} (log scale)` : label, tex };
}

function noDistribution(x: number, y: number, text = "These parameter values don't define a distribution."): PlotLabel {
  return { id: "undefined", x, y, content: <span>{text}</span>, anchor: "c", className: "w-label-region" };
}

function Note({ spec, meta }: { spec: DistributionSpec; meta?: DatasetMeta }) {
  if (!meta) return null;
  return (
    <p className="w-data-note">
      {isApproximate(meta) ? (
        <>
          <strong>≈ Approximate:</strong> read off a published chart.{" "}
        </>
      ) : null}
      Data: {meta.title}
      {meta.period && !meta.title.includes(meta.period) ? ` (${meta.period})` : ""}; <code>{spec.column}</code>
      {spec.weight ? (
        <>
          , weighted by <code>{spec.weight}</code>
        </>
      ) : null}
      .
    </p>
  );
}
