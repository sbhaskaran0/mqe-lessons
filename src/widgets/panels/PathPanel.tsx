// Path panels: time paths of the view's recurrence (what dynamics drew), with shock markers and a hover card, and the
// phase (cobweb) panel, x_{t+1} against x_t. Drawn with the same frame as the curve panels, so they look and feel
// alike and the prediction marker reuses the drag handle.
import { useMemo } from "react";
import { Tex } from "../../lib/Tex";
import type { Runtime } from "../core/useWidgetRuntime";
import { layerSafe, type PanelsSpec, type Scope, type simulate, withDerived } from "../expr";
import { format } from "../format";
import { DragHandle } from "../plot/DragHandle";
import { Clip, Curve, Dot, pathD, type Pt, sample, Segment } from "../plot/marks";
import { type PlotLabel, PlotFrame, type PlotShare, usePlot } from "../plot/PlotFrame";
import { extent, nice, type Range } from "../plot/ticks";
import { useAnimatedRange, useStickyRange } from "../plot/useRange";
import type { Panel } from "../spec";

export type PathPanelSpec = Extract<Panel, { kind: "path" }>;
export type Sim = ReturnType<typeof simulate>;
export type SeriesView = { id: string; tex?: string; label?: string; color: string; values: number[]; shown: boolean };
export type ShockSpec = NonNullable<NonNullable<PanelsSpec["recurrence"]>["shocks"]>[number];

type TimePanelProps = {
  spec: PanelsSpec;
  panel: PathPanelSpec;
  series: SeriesView[];
  shocks: ShockSpec[];
  labelShocks: boolean;
  height: number;
  share: PlotShare;
  rt: Runtime;
  hoverT: number | null;
  onHover: (t: number | null) => void;
  marker: boolean;
  titled: boolean;
};

// A panel's scale is presentation only: series hold the values to plot (authors write log() and growth() in
// `series.expr`). "logs" labels the axis in log points; "growth" formats it as percentages.
export function TimePanel({ spec, panel, series, shocks, labelShocks, height, share, rt, hoverT, onHover, marker, titled }: TimePanelProps) {
  const rec = spec.recurrence!;
  const growth = panel.scale === "growth";
  // Hidden (predicted) series count towards the range, so the reveal doesn't rescale the axes.
  const ext = extent(series.flatMap((s) => s.values)) ?? [0, 1];
  let lo = Math.min(ext[0], growth ? 0 : ext[0]);
  const hi = Math.max(ext[1], growth ? 0 : ext[1]);
  // Levels start at zero unless the path lives in a narrow band far from it.
  if (!growth && lo >= 0 && lo < 0.5 * hi) lo = 0;
  const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.1 || 1;
  let target: Range = nice(lo === 0 ? 0 : lo - pad, hi + pad);
  if (panel.y?.min !== undefined) target = [panel.y.min, Math.max(target[1], panel.y.min + 1e-9)];
  if (panel.y?.max !== undefined) target = [target[0], panel.y.max];
  const y = useAnimatedRange(useStickyRange(target, `${rt.viewKey}|${panel.id}`));
  // Time runs t0 .. t0 + periods (the notes count from period 1); arrays are indexed from 0.
  const t0 = rec.t0 ?? 0;
  const x: Range = [t0, t0 + rec.periods];

  const labels: PlotLabel[] = [];
  for (const s of series) {
    if (!s.shown || (!s.tex && !s.label)) continue;
    const t = lastFinite(s.values);
    if (t < 0) continue;
    labels.push({ id: s.id, x: t0 + t, y: s.values[t]!, content: s.tex ? <Tex tex={s.tex} /> : <span>{s.label}</span>, color: s.color, anchor: "nw", avoid: true, className: rt.isRevealed(s.id) ? "w-reveal" : undefined });
  }
  if (labelShocks) {
    for (const [i, sh] of shocks.entries()) {
      if (sh.label) labels.push({ id: `shock-${sh.id ?? i}`, x: sh.t, y: y[1], content: <span>{sh.label}</span>, anchor: "se", className: "w-label-shock" });
    }
  }

  const fmtY = (v: number) => (growth ? format(".1%", v) : format(".3~r", v));
  return (
    <div className="w-panel" data-panel={panel.id}>
      {titled && panel.title ? (
        <div className="w-panel-title">
          {panel.title}
          {panel.scale && panel.scale !== "levels" ? <span className="w-panel-kind">{panel.scale === "logs" ? "log points" : "growth rate"}</span> : null}
        </div>
      ) : null}
      <PlotFrame
        x={x}
        y={y}
        height={height}
        share={share}
        yPercent={growth}
        xTitle={{ tex: "t", label: "Period" }}
        yTitle={panel.y?.label || panel.y?.tex ? { label: panel.y.label, tex: panel.y.tex } : panel.scale === "logs" ? { label: "log points" } : undefined}
        labels={labels}
        ariaLabel={`${panel.title ?? "Time path"}: ${series.map((s) => s.label ?? s.id).join(", ")}`}
        onHover={(v) => onHover(v === null ? null : Math.max(t0, Math.min(t0 + rec.periods, Math.round(v))))}
        overlay={(px) =>
          hoverT === null ? null : (
            <HoverCard t={hoverT} t0={t0} series={series.filter((s) => s.shown)} at={px(hoverT, y[1])} fmt={fmtY} right={hoverT > t0 + rec.periods * 0.6} />
          )
        }
      >
        <Clip>
          {shocks.map((sh, i) => (
            <Segment key={`s${sh.id ?? i}`} id={sh.id} a={[sh.t, y[0]]} b={[sh.t, y[1]]} color="var(--chart-axis)" style="dashed" width={1.25} highlight={rt.highlight !== undefined && rt.highlight === sh.id} />
          ))}
          {series.filter((s) => s.shown).map((s) => (
            <PathOf key={`${s.id}|${rt.viewKey}`} s={s} t0={t0} rt={rt} />
          ))}
          {hoverT !== null ? <Segment a={[hoverT, y[0]]} b={[hoverT, y[1]]} color="var(--chart-axis)" width={1} className="w-crosshair" /> : null}
        </Clip>
        {hoverT !== null
          ? series.filter((s) => s.shown && Number.isFinite(s.values[hoverT - t0])).map((s) => <Dot key={`h${s.id}`} at={[hoverT, s.values[hoverT - t0]!]} color={s.color} r={3.5} />)
          : null}
        {marker ? <LevelMarker rt={rt} /> : null}
      </PlotFrame>
    </div>
  );
}

/** One series path; keyed by the view so it draws itself in again whenever a new view arrives. */
function PathOf({ s, t0, rt }: { s: SeriesView; t0: number; rt: Runtime }) {
  const plot = usePlot();
  const pts: Pt[] = s.values.map((v, i) => [t0 + i, v]);
  return <Curve id={s.id} d={pathD(pts, plot)} color={s.color} highlight={rt.highlight === s.id} draw className={rt.isRevealed(s.id) ? "w-reveal" : undefined} />;
}

function HoverCard({ t, t0, series, at, fmt, right }: { t: number; t0: number; series: SeriesView[]; at: [number, number]; fmt: (v: number) => string; right: boolean }) {
  return (
    <div className={`w-hover${right ? " w-hover-left" : ""}`} style={{ left: `${at[0].toFixed(1)}px`, top: `${(at[1] + 4).toFixed(1)}px` }}>
      <div className="w-hover-t">
        <Tex tex="t" /> = {t}
      </div>
      {series.map((s) => (
        <div key={s.id} className="w-hover-row">
          <span className="w-swatch" style={{ background: s.color }} />
          {s.tex ? <Tex tex={s.tex} /> : <span>{s.label ?? s.id}</span>} <span className="w-hover-v">{fmt(s.values[t - t0] ?? NaN)}</span>
        </div>
      ))}
    </div>
  );
}

/** Prediction without options: the learner drags a marker to the level they expect. */
function LevelMarker({ rt }: { rt: Runtime }) {
  const plot = usePlot();
  const p = rt.predict!;
  const at: Pt = p.marker ?? plot.fromNorm(85, 50);
  if (p.phase === "revealed") {
    return p.marker ? (
      <Clip>
        <Segment a={[plot.x[0], p.marker[1]]} b={[plot.x[1], p.marker[1]]} color="var(--why)" style="dotted" width={1.5} className="w-guess" />
      </Clip>
    ) : null;
  }
  return <DragHandle id="predict-marker" at={at} color="var(--why)" label="Your prediction" valueText={format(".3~r", at[1])} onMove={(pt) => p.placeMarker(pt)} />;
}

const nextTex = (tex: string) => (/_\{?t\}?$/.test(tex) ? tex.replace(/_\{?t\}?$/, "_{t+1}") : `${tex}_{t+1}`);

export function PhasePanel({ spec, panel, sim, params, rt, height, share }: { spec: PanelsSpec; panel: PathPanelSpec; sim: Sim; params: Scope; rt: Runtime; height: number; share: PlotShare }) {
  const rec = spec.recurrence!;
  const v = rec.var;
  const tex = rec.tex ?? v;
  const ext = extent(sim.state) ?? [0, 1];
  const lo = panel.phase?.min ?? (ext[0] >= 0 ? 0 : nice(ext[0], ext[1])[0]);
  const hi = panel.phase?.max ?? nice(lo, ext[1] * 1.15)[1];
  const r: Range = [lo, hi];
  const after = useMemo(() => {
    let p = { ...params };
    for (const s of [...(rec.shocks ?? [])].sort((a, b) => a.t - b.t)) p = { ...p, ...s.set };
    return p;
  }, [params, rec.shocks]);
  const pending = !!rt.predict && rt.predict.phase === "ask";
  return (
    <div className="w-panel w-panel-phase" data-panel={panel.id}>
      <div className="w-panel-title">{panel.phase?.label ?? panel.title ?? "Phase diagram"}</div>
      <PlotFrame x={r} y={r} height={height} share={share} xTitle={{ tex }} yTitle={{ tex: nextTex(tex) }} ariaLabel={`Phase diagram of ${v}`}>
        <PhaseMarks spec={spec} sim={sim} params={params} after={after} range={r} cobweb={!pending} highlight={rt.highlight === panel.id} />
      </PlotFrame>
    </div>
  );
}

function PhaseMarks({ spec, sim, params, after, range, cobweb, highlight }: { spec: PanelsSpec; sim: Sim; params: Scope; after: Scope; range: Range; cobweb: boolean; highlight: boolean }) {
  const plot = usePlot();
  const rec = spec.recurrence!;
  const map = (p: Scope) => {
    const scope = withDerived(spec, p);
    const next = layerSafe(spec, rec.next);
    return (x: number) => next({ ...scope, [rec.var]: x, t: rec.t0 ?? 0 });
  };
  const shocked = (rec.shocks ?? []).length > 0;
  const web: Pt[] = [];
  const xs = sim.state;
  for (let t = 0; t + 1 < xs.length && t < 80; t++) {
    web.push([xs[t]!, xs[t]!], [xs[t]!, xs[t + 1]!]);
  }
  return (
    <Clip>
      <Segment a={[range[0], range[0]]} b={[range[1], range[1]]} color="var(--chart-axis)" style="dashed" width={1.25} />
      <Curve d={pathD(sample(map(params), range[0], range[1], 160), plot)} color="var(--chart-1)" highlight={highlight} />
      {shocked ? <Curve d={pathD(sample(map(after), range[0], range[1], 160), plot)} color="var(--chart-1)" style="dotted" width={1.75} /> : null}
      {cobweb ? <Curve d={pathD(web, plot)} color="var(--chart-2)" width={1.5} /> : null}
      {cobweb && Number.isFinite(xs[0]) ? <Dot at={[xs[0]!, xs[0]!]} color="var(--chart-2)" r={3.5} /> : null}
    </Clip>
  );
}

function lastFinite(values: number[]): number {
  for (let i = values.length - 1; i >= 0; i--) if (Number.isFinite(values[i])) return i;
  return -1;
}
