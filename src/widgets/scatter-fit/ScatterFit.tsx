// scatter-fit: seeded points and a line the learner fits by dragging two handles (shift and tilt), with residual
// sticks, optional residual squares, live SSR and R², and a "Reveal OLS" that animates the line onto the
// least-squares fit. Optional contour panels beside it draw SSR(b1, b2) as a bowl, with the current line as a point
// that drags both parameters at once.
import { type MouseEvent, useMemo, useRef } from "react";
import { readoutValues } from "../core/evaluate";
import type { ScatterFitSpec } from "../core/types";
import { type Runtime, useGoal, useWidgetRuntime } from "../core/useWidgetRuntime";
import { defaults, fitStats, generate, type Scope, withDerived } from "../expr";
import { format } from "../format";
import type { WidgetProps } from "../host";
import { DragHandle } from "../plot/DragHandle";
import { Clip, Segment } from "../plot/marks";
import { type PlotLabel, PlotFrame, type PlotShare, usePlot } from "../plot/PlotFrame";
import { extent, nice, type Range } from "../plot/ticks";
import { GoalFeedback, HintButton, PredictPanel } from "../ui/Feedback";
import { ParamPanel } from "../ui/ParamPanel";
import { type ReadoutItem, Readouts } from "../ui/Readouts";
import { WidgetFrame, WidgetNotice } from "../ui/WidgetFrame";
import { PlanePanel } from "../panels/PlanePanel";
import { showRule } from "../panels/show";

type Point = { x: number; y: number };
type Stats = ReturnType<typeof fitStats>;

const REVEAL_MS = 700;
const COLORS = { points: "var(--chart-1)", line: "var(--chart-2)", resid: "var(--chart-6)", ols: "var(--chart-3)" };

export default function ScatterFit(props: WidgetProps) {
  const spec = props.entry.spec as ScatterFitSpec;
  if (spec.dataset !== undefined) {
    const meta = props.datasets[spec.dataset];
    return (
      <WidgetNotice entry={props.entry} tone="info" title="Dataset-backed scatter plots arrive with the data pipeline (phase 3).">
        <p>
          This widget fits a line to <strong>{meta?.title ?? spec.dataset}</strong>. It will be interactive once datasets load in the player.
        </p>
      </WidgetNotice>
    );
  }
  return <GeneratedFit {...props} spec={spec} />;
}

function GeneratedFit({ entry, view, compact, onGoalMet, onPredict, initial, spec }: WidgetProps & { spec: ScatterFitSpec }) {
  const rt = useWidgetRuntime(spec, view, onPredict, initial);
  const { intercept: aId, slope: bId } = spec.line;
  const scope = useMemo(() => withDerived(spec, rt.params), [spec, rt.params]);

  // The data depends on every parameter except the line's own two (held at their defaults here, in case a derived
  // value reads them), so dragging the line never regenerates the data.
  const dataKey = JSON.stringify(Object.entries(rt.params).filter(([k]) => k !== aId && k !== bId));
  const points = useMemo(
    () => generate(spec, { ...defaults(spec), ...Object.fromEntries(JSON.parse(dataKey) as [string, number][]) }),
    [spec, dataKey],
  );
  const a = rt.params[aId] ?? 0;
  const b = rt.params[bId] ?? 0;
  const stats = useMemo(() => fitStats(points, a, b), [points, a, b]);
  const fitScope = useMemo(() => ({ ...scope, ...stats }), [scope, stats]);
  const readouts = useMemo(() => readoutValues(spec, fitScope), [spec, fitScope]);
  rt.readouts.current = readouts;
  const goal = useGoal(rt, useMemo(() => ({ ...fitScope, ...readouts }), [fitScope, readouts]), onGoalMet);
  const { listed, pending } = rt;
  const panels = spec.panels;
  const show = useMemo(() => (panels ? showRule({ panels }, { listed, pending }) : null), [panels, listed, pending]);
  const extra = show && panels ? panels.filter(show.panel) : [];
  const share: PlotShare | undefined = extra.length ? { parts: extra.length + 1, axes: extra.length + 1, axis: true } : undefined;

  const xr = useMemo<Range>(() => axisRange(points.map((p) => p.x), spec.x.min, spec.x.max), [points, spec.x.min, spec.x.max]);
  const yr = useMemo<Range>(() => axisRange(points.map((p) => p.y), spec.y.min, spec.y.max), [points, spec.y.min, spec.y.max]);

  const olsShown = !rt.pending("ols") && (rt.listed("ols") === true || rt.flag("ols"));
  const squaresShown = !rt.pending("squares") && (rt.listed("squares") === true || rt.flag("squares"));
  const canToggleSquares = !rt.pending("squares") && rt.listed("squares") !== true && rt.isShown("residuals");
  // In a view with a goal, the OLS line is the goal's answer: Reveal appears once the learner has met it, as the
  // exact fit to compare theirs with. Before that the hint is the help on offer (and Skip, in the lesson).
  const canReveal = !rt.pending("ols") && !olsShown && (!goal || goal.met);

  const ssrRef = useRef<HTMLDivElement>(null);
  const r2Ref = useRef<HTMLDivElement>(null);
  const reveal = (e: MouseEvent<HTMLButtonElement>) => {
    rt.setFlag("ols", true);
    const patch: Scope = {};
    if (!rt.isLocked(aId)) patch[aId] = stats.intercept_ols;
    if (!rt.isLocked(bId)) patch[bId] = stats.slope_ols;
    rt.animateTo(patch, REVEAL_MS);
    // An unanswered prediction must not take the revealed slope as the learner's guess.
    rt.untouch();
    // The button goes with the click, so keyboard focus would fall to the page: it moves to the SSR, which now shows
    // its minimum (or to R², or the widget, when the view hides it), without scrolling the plot out of view.
    const root = e.currentTarget.closest<HTMLElement>(".w-root");
    const target = ssrRef.current ?? r2Ref.current ?? root;
    if (target === root && root) root.tabIndex = -1;
    target?.focus({ preventScroll: true });
  };

  const items: ReadoutItem[] = [
    {
      id: "ssr",
      tex: "\\text{SSR}",
      value: stats.ssr,
      format: spec.readouts?.find((r) => r.id === "ssr")?.format,
      extra: rt.pending("ols") ? null : <FitMeter ssr={stats.ssr} min={stats.ssr_min} showMin={olsShown} />,
      focusRef: ssrRef,
    },
    { id: "r2", tex: "R^2", value: stats.r2, format: ".3f", focusRef: r2Ref },
    ...(spec.readouts ?? []).map((r) => ({ id: r.id, tex: r.tex, label: r.label, format: r.format, labels: r.labels, value: readouts[r.id] ?? NaN })),
  ];

  const labels: PlotLabel[] = olsShown ? [{ id: "ols", x: xr[1], y: stats.intercept_ols + stats.slope_ols * xr[1], content: <span>OLS</span>, color: COLORS.ols, anchor: "nw", avoid: true, className: rt.isRevealed("ols") ? "w-reveal" : undefined }] : [];
  const predict = rt.predict;
  const plotFrame = (
    <PlotFrame
      x={xr}
      y={yr}
      height={compact ? 260 : extra.length ? 260 : 340}
      share={share}
      xTitle={spec.x.label || spec.x.tex ? { label: spec.x.label, tex: spec.x.tex } : undefined}
      yTitle={spec.y.label || spec.y.tex ? { label: spec.y.label, tex: spec.y.tex } : undefined}
      labels={labels}
      ariaLabel={`${spec.title ?? entry.name}: ${points.length} points and a line to fit`}
    >
      <FitMarks points={points} a={a} b={b} stats={stats} rt={rt} squares={squaresShown} ols={olsShown} />
      {rt.isShown("line") ? (
        <LineHandles
          a={a}
          b={b}
          aRange={spec.params?.[aId]}
          bRange={spec.params?.[bId]}
          aLocked={rt.isLocked(aId)}
          bLocked={rt.isLocked(bId)}
          onMove={(patch) => rt.set({ ...(patch.a !== undefined ? { [aId]: patch.a } : {}), ...(patch.b !== undefined ? { [bId]: patch.b } : {}) })}
        />
      ) : null}
    </PlotFrame>
  );

  return (
    <WidgetFrame
      entry={entry}
      rt={rt}
      compact={compact}
      stage={
        extra.length ? (
          <div className="w-panels">
            {plotFrame}
            {extra.map((p) => (
              <PlanePanel key={p.id} spec={spec} panel={p} scope={fitScope} rt={rt} show={show!} height={compact ? 240 : 260} share={share} titled ariaTitle={spec.title ?? entry.name} />
            ))}
          </div>
        ) : (
          plotFrame
        )
      }
      predict={
        <PredictPanel
          predict={predict}
          howTo="Drag the line to where you think it fits best, then commit."
          value={rt.touched ? b : undefined}
          describe={(v) => `slope ${format(".3~r", v)}`}
        />
      }
      readouts={<Readouts rt={rt} notation={entry.notation} items={items} />}
      params={<ParamPanel rt={rt} notation={entry.notation} />}
      tools={
        <>
          {canToggleSquares ? (
            <button type="button" className="w-btn w-btn-quiet w-btn-sm" aria-pressed={squaresShown} onClick={() => rt.setFlag("squares", !rt.flag("squares"))}>
              Squares
            </button>
          ) : null}
          {canReveal ? (
            <button type="button" className="w-btn w-btn-sm" onClick={reveal}>
              Reveal OLS
            </button>
          ) : null}
          <HintButton goal={goal} />
        </>
      }
      feedback={<GoalFeedback goal={goal} />}
    />
  );
}

function axisRange(values: number[], min: number | undefined, max: number | undefined): Range {
  const e = extent(values) ?? [0, 1];
  const pad = (e[1] - e[0]) * 0.08 || 1;
  const n = nice(e[0] - pad, e[1] + pad);
  return [min ?? n[0], max ?? n[1]];
}

function FitMarks({ points, a, b, stats, rt, squares, ols }: { points: Point[]; a: number; b: number; stats: Stats; rt: Runtime; squares: boolean; ols: boolean }) {
  const plot = usePlot();
  const { sx, sy, x } = plot;
  const yhat = (v: number) => a + b * v;
  const hl = (id: string) => rt.highlight === id;
  const cls = (id: string) => (rt.isRevealed(id) ? "w-reveal" : undefined);

  let sticks = "";
  let boxes = "";
  for (const p of points) {
    const px = sx(p.x);
    const py = sy(p.y);
    const ph = sy(yhat(p.x));
    if (![px, py, ph].every(Number.isFinite)) continue;
    sticks += `M${px.toFixed(2)},${py.toFixed(2)}V${ph.toFixed(2)}`;
    const side = Math.abs(ph - py);
    const dir = px < plot.pw / 2 ? 1 : -1;
    boxes += `M${px.toFixed(2)},${Math.min(py, ph).toFixed(2)}h${(dir * side).toFixed(2)}v${side.toFixed(2)}h${(-dir * side).toFixed(2)}Z`;
  }

  return (
    <>
      <Clip>
        {squares ? (
          <g className={`w-mark${cls("squares") ? " w-reveal" : ""}`} data-el="squares">
            <path className="w-squares" d={boxes} style={{ fill: COLORS.resid, stroke: COLORS.resid }} />
          </g>
        ) : null}
        {rt.isShown("residuals") ? (
          <g className={`w-mark${cls("residuals") ? " w-reveal" : ""}`} data-el="residuals">
            {hl("residuals") ? <path className="w-halo" d={sticks} style={{ strokeWidth: 6 }} /> : null}
            <path className="w-sticks" d={sticks} style={{ stroke: COLORS.resid }} />
          </g>
        ) : null}
        {ols ? (
          <Segment id="ols" a={[x[0], stats.intercept_ols + stats.slope_ols * x[0]]} b={[x[1], stats.intercept_ols + stats.slope_ols * x[1]]} color={COLORS.ols} style="dashed" width={2} highlight={hl("ols")} className={cls("ols")} />
        ) : null}
        {rt.isShown("line") ? <Segment id="line" a={[x[0], yhat(x[0])]} b={[x[1], yhat(x[1])]} color={COLORS.line} width={2.5} highlight={hl("line")} className={cls("line")} /> : null}
      </Clip>
      {rt.isShown("points") ? (
        <g className={`w-mark w-points${cls("points") ? " w-reveal" : ""}${hl("points") ? " w-points-hl" : ""}`} data-el="points">
          {points.map((p, i) => (
            <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={hl("points") ? 4.5 : 3.75} style={{ fill: COLORS.points }} />
          ))}
        </g>
      ) : null}
    </>
  );
}

/** Two handles on the learner's line. The shift handle (at x = 0 when that's on screen, so it sits on the
 *  intercept) moves the line up and down; the tilt handle swings it about the shift handle, or about the
 *  intercept when the intercept is locked. */
type Bounds = { min: number; max: number } | undefined;

function LineHandles({ a, b, aRange, bRange, aLocked, bLocked, onMove }: { a: number; b: number; aRange: Bounds; bRange: Bounds; aLocked: boolean; bLocked: boolean; onMove: (p: { a?: number; b?: number }) => void }) {
  const { x } = usePlot();
  const span = x[1] - x[0];
  const x1 = x[0] <= 0 && 0 <= x[1] - 0.25 * span ? 0 : x[0] + 0.12 * span;
  const x2 = x[0] + 0.88 * span;
  const y1 = a + b * x1;
  return (
    <>
      {!aLocked ? (
        <DragHandle id="intercept" at={[x1, y1]} axis="y" color={COLORS.line} label="Line intercept" value={aRange && { now: a, min: aRange.min, max: aRange.max }} valueText={format(".3~r", a)} onMove={([, my]) => onMove({ a: my - b * x1 })} />
      ) : null}
      {!bLocked ? (
        <DragHandle
          id="slope"
          at={[x2, a + b * x2]}
          axis="y"
          color={COLORS.line}
          label="Line slope"
          value={bRange && { now: b, min: bRange.min, max: bRange.max }}
          valueText={format(".3~r", b)}
          onMove={([, my]) => {
            if (aLocked) onMove({ b: (my - a) / x2 });
            else {
              const nb = (my - y1) / (x2 - x1);
              onMove({ a: y1 - nb * x1, b: nb });
            }
          }}
        />
      ) : null}
    </>
  );
}

function FitMeter({ ssr, min, showMin }: { ssr: number; min: number; showMin: boolean }) {
  const q = ssr > 0 && Number.isFinite(min) ? Math.max(0, Math.min(1, min / ssr)) : 0;
  return (
    <span className="w-meter-wrap">
      <span className="w-meter" title="How close the line is to the smallest possible SSR" aria-hidden="true">
        <span className="w-meter-fill" style={{ width: `${(q * 100).toFixed(1)}%` }} />
      </span>
      {showMin ? (
        <span className="w-readout-sub">
          min {format(undefined, min)}
        </span>
      ) : null}
    </span>
  );
}
