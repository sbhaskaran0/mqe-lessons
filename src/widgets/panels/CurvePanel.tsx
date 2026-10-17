// A curve panel: y = f(x) over a model variable, or over a swept parameter (each x re-derives the model there), with
// shaded regions, lines, arrows and points at derived coordinates, some of them draggable. What function-plot drew.
import { useMemo } from "react";
import { Tex } from "../../lib/Tex";
import { resolveColor } from "../core/colors";
import { solveParam, value } from "../core/evaluate";
import type { Runtime } from "../core/useWidgetRuntime";
import { layerSafe, type PanelsSpec, type Scope, sweepRange, sweptScope } from "../expr";
import { format } from "../format";
import { DragHandle } from "../plot/DragHandle";
import { Area, Arrow, Clip, Curve, Dot, Guides, pathD, type Pt, sample, Segment } from "../plot/marks";
import { type PlotLabel, PlotFrame, type PlotShare, usePlot } from "../plot/PlotFrame";
import { nice, type Range } from "../plot/ticks";
import { useAnimatedRange, useStickyRange } from "../plot/useRange";
import type { Panel, WidgetSpec } from "../spec";
import type { ShowRule } from "./show";

export type CurvePanelSpec = Extract<Panel, { kind: "curve" }>;
type CurveSpec = CurvePanelSpec["curves"][number];
type CurveData = { id: string; color: string; style: CurveSpec["style"]; tex?: string; label?: string; mark?: boolean; pts: Pt[]; f: (x: number) => number; lo: number; hi: number };
/** A shaded region in data units: its upper and lower edges sampled at the same x values. */
type RegionData = { id: string; color: string; top: Pt[]; bottom: Pt[] };
export type LineSpec = NonNullable<CurvePanelSpec["lines"]>[number];
export type PointSpec = NonNullable<CurvePanelSpec["points"]>[number];
export type ArrowSpec = NonNullable<CurvePanelSpec["arrows"]>[number];

const POINT_COLOR = "var(--text)";
export const markText = (tex?: string, label?: string) => (tex ? <Tex tex={tex} /> : label ? <span>{label}</span> : null);

type Props = {
  spec: PanelsSpec;
  panel: CurvePanelSpec;
  scope: Scope;
  rt: Runtime;
  show: ShowRule;
  height: number;
  share?: PlotShare;
  titled: boolean;
  /** This panel carries the prediction marker (the first panel on screen, in a predict step without options). */
  marker: boolean;
  ariaTitle: string;
};

/** The panel. Its y range eases to fit the content after a move; that tween lives here so its frames re-render the
 *  plot alone, not the sliders and readouts around it. */
export function CurvePanel({ spec, panel, scope, rt, show, height, share, titled, marker, ariaTitle }: Props) {
  const xRange: Range = useMemo(() => (panel.x.sweep ? sweepRange(spec, panel.x) : [panel.x.min!, panel.x.max!]), [spec, panel.x]);
  const curves = useMemo(() => buildCurves(spec, panel, scope, rt.params, xRange), [spec, panel, scope, rt.params, xRange]);
  const regions = useMemo(() => buildRegions(panel, curves, scope, xRange), [panel, curves, scope, xRange]);
  const shown = (id: string) => show.mark(id, panel.id);
  const yWanted = useMemo(() => yTarget(panel, curves, scope, (id) => show.mark(id, panel.id)), [panel, curves, scope, show]);
  const yRange = useAnimatedRange(useStickyRange(yWanted, `${rt.viewKey}|${panel.id}`));
  const labels = buildLabels(panel, curves, scope, rt, shown, xRange, yRange);
  const x = panel.x;
  return (
    <div className="w-panel" data-panel={panel.id}>
      {titled && panel.title ? <div className="w-panel-title">{panel.title}</div> : null}
      <PlotFrame
        x={xRange}
        y={yRange}
        height={height}
        share={share}
        equal={panel.aspect === "equal"}
        xTitle={x.label || x.tex ? { label: x.label, tex: x.tex } : undefined}
        yTitle={panel.y.label || panel.y.tex ? { label: panel.y.label, tex: panel.y.tex } : undefined}
        labels={labels}
        ariaLabel={`${ariaTitle}: ${panel.curves.map((c) => c.label ?? c.id).join(", ")}`}
      >
        <Marks spec={spec} panel={panel} curves={curves} regions={regions} scope={scope} rt={rt} shown={shown} />
        {marker ? <PredictMarker rt={rt} /> : null}
      </PlotFrame>
    </div>
  );
}

function buildCurves(spec: PanelsSpec, panel: CurvePanelSpec, scope: Scope, params: Scope, [x0, x1]: Range): CurveData[] {
  const sweep = panel.x.sweep;
  return panel.curves.map((c, i) => {
    const fn = layerSafe(spec, c.expr);
    const f = sweep ? (x: number) => fn(sweptScope(spec, params, sweep, x)) : (x: number) => fn({ ...scope, [panel.x.var!]: x });
    const lo = Math.max(x0, c.domain ? value(c.domain[0], scope) : -Infinity);
    const hi = Math.min(x1, c.domain ? value(c.domain[1], scope) : Infinity);
    return { id: c.id, color: resolveColor(c.color, i), style: c.style, tex: c.tex, label: c.label, mark: c.mark, f, lo, hi, pts: sample(f, lo, hi, sweep ? 120 : 240) };
  });
}

/** Every region's edges, sampled once per change of the values (a learner move), not on every frame of a tween. */
function buildRegions(panel: CurvePanelSpec, curves: CurveData[], scope: Scope, [x0, x1]: Range): RegionData[] {
  const byId = new Map(curves.map((c) => [c.id, c]));
  return (panel.regions ?? []).flatMap((r, i) => {
    const [a, b] = r.between.map((id) => (id === "axis" ? null : byId.get(id)));
    const first = a ?? b;
    if (!first || a === undefined || b === undefined) return [];
    const lo = Math.max(r.from !== undefined ? value(r.from, scope) : -Infinity, a?.lo ?? -Infinity, b?.lo ?? -Infinity, x0);
    const hi = Math.min(r.to !== undefined ? value(r.to, scope) : Infinity, a?.hi ?? Infinity, b?.hi ?? Infinity, x1);
    const color = r.color ? resolveColor(r.color, i) : first.color;
    return [{ id: r.id, color, top: sample(a ? a.f : () => 0, lo, hi, 160), bottom: sample(b ? b.f : () => 0, lo, hi, 160) }];
  });
}

/** The y range the content asks for. With both ends given: that range, unless the visible content uses well under
 *  half of it, in which case the top comes down to fit (never outside the given min and max). An end left out fits
 *  the visible content. */
function yTarget(panel: CurvePanelSpec, curves: CurveData[], scope: Scope, isShown: (id: string) => boolean): Range {
  let top = -Infinity;
  let bottom = Infinity;
  const see = (y: number) => {
    if (!Number.isFinite(y)) return;
    top = Math.max(top, y);
    bottom = Math.min(bottom, y);
  };
  for (const c of curves) if (isShown(c.id)) for (const [, y] of c.pts) see(y);
  for (const p of panel.points ?? []) if (isShown(p.id)) see(value(p.y, scope));
  for (const l of panel.lines ?? []) {
    if (!isShown(l.id)) continue;
    if (l.y !== undefined) see(value(l.y, scope));
    if (l.from && l.to) [value(l.from[1], scope), value(l.to[1], scope)].forEach(see);
  }
  for (const a of panel.arrows ?? []) if (isShown(a.id)) [value(a.from[1], scope), value(a.to[1], scope)].forEach(see);
  const { min, max } = panel.y;
  if (min !== undefined && max !== undefined) {
    if (!Number.isFinite(top) || top >= min + 0.45 * (max - min)) return [min, max];
    const fitted = nice(min, top + 0.12 * (top - min))[1];
    return [min, Math.min(max, Math.max(fitted, min + 0.05 * (max - min)))];
  }
  if (!Number.isFinite(top)) return [min ?? 0, max ?? 1];
  const lo = min ?? (bottom >= 0 && bottom < 0.5 * top ? 0 : bottom);
  const hi = max ?? top;
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.1 || 1;
  const [a, b] = nice(min ?? (lo === 0 ? 0 : lo - pad), max ?? hi + pad);
  return [min ?? a, max ?? b];
}

function Marks({ spec, panel, curves, regions, scope, rt, shown }: { spec: PanelsSpec; panel: CurvePanelSpec; curves: CurveData[]; regions: RegionData[]; scope: Scope; rt: Runtime; shown: (id: string) => boolean }) {
  const plot = usePlot();
  const cls = (id: string) => (rt.isRevealed(id) ? "w-reveal" : undefined);
  const hl = (id: string) => rt.highlight === id;
  const ncurves = curves.length;
  const sweep = panel.x.sweep;

  return (
    <>
      <Clip>
        {regions.filter((r) => shown(r.id)).map((r) => {
          const pairs = r.top.map((t, k) => [t, r.bottom[k]!] as const).filter(([t, u]) => Number.isFinite(t[1]) && Number.isFinite(u[1]));
          if (pairs.length < 2) return null;
          const d = `${pathD(pairs.map(([t]) => t), plot)}${pathD([...pairs].reverse().map(([, u]) => u), plot).replace(/^M/, "L")}Z`;
          return <Area key={r.id} id={r.id} d={d} color={r.color} highlight={hl(r.id)} className={cls(r.id)} />;
        })}
        {curves.filter((c) => shown(c.id)).map((c) => (
          <Curve key={c.id} id={c.id} d={pathD(c.pts, plot)} color={c.color} style={c.style} highlight={hl(c.id)} draw={rt.isRevealed(c.id)} className={cls(c.id)} />
        ))}
        {(panel.lines ?? []).filter((l) => shown(l.id)).map((l, i) => {
          const ends = lineEnds(l, scope, plot.x, plot.y);
          if (!ends) return null;
          return <Segment key={l.id} id={l.id} a={ends[0]} b={ends[1]} color={resolveColor(l.color, ncurves + i)} style={l.style} highlight={hl(l.id)} className={cls(l.id)} />;
        })}
        {(panel.arrows ?? []).filter((a) => shown(a.id)).map((a, i) => (
          <Arrow key={a.id} id={a.id} a={[value(a.from[0], scope), value(a.from[1], scope)]} b={[value(a.to[0], scope), value(a.to[1], scope)]} color={resolveColor(a.color, ncurves + (panel.lines?.length ?? 0) + i)} style={a.style} highlight={hl(a.id)} className={cls(a.id)} />
        ))}
        {(panel.points ?? []).filter((p) => shown(p.id) && p.guides).map((p) => (
          <Guides key={`g-${p.id}`} at={[value(p.x, scope), value(p.y, scope)]} className={cls(p.id)} />
        ))}
      </Clip>
      {sweep ? curves.filter((c) => c.mark && shown(c.id)).map((c) => <SweepMark key={`m-${c.id}`} spec={spec} param={sweep} curve={c} rt={rt} highlight={hl(c.id)} />) : null}
      {(panel.points ?? []).filter((p) => shown(p.id)).map((p) => (
        <PointMark key={p.id} spec={spec} p={p} scope={scope} rt={rt} highlight={hl(p.id)} className={cls(p.id)} />
      ))}
    </>
  );
}

/** A point at derived coordinates; draggable when it binds a free parameter (the drag is solved back onto it). */
export function PointMark({ spec, p, scope, rt, highlight, className }: { spec: WidgetSpec; p: PointSpec; scope: Scope; rt: Runtime; highlight: boolean; className?: string }) {
  const at: Pt = [value(p.x, scope), value(p.y, scope)];
  const free = (["x", "y"] as const).filter((k) => p.drag?.[k] && !rt.isLocked(p.drag[k]!));
  const color = p.color ? resolveColor(p.color, 0) : POINT_COLOR;
  if (!free.length) return <Dot id={p.id} at={at} color={color} highlight={highlight} className={className} />;
  return (
    <g className={className}>
      {highlight ? <Dot at={at} color="transparent" highlight /> : null}
      <DragHandle
        id={p.id}
        at={at}
        axis={free.length === 2 ? "both" : free[0]}
        color={p.color ? color : "var(--accent)"}
        label={`Drag ${p.label ?? p.id}`}
        value={handleValue(spec, rt, p.drag![free[0]!]!)}
        valueText={free.map((k) => `${p.drag![k]} ${format(".3~r", rt.params[p.drag![k]!] ?? NaN)}`).join(", ")}
        onMove={([mx, my]) => {
          const patch: Scope = {};
          let params = rt.params;
          for (const k of free) {
            const id = p.drag![k]!;
            const v = solveParam(spec, params, id, p[k], k === "x" ? mx : my);
            if (v !== undefined) {
              patch[id] = v;
              params = { ...params, [id]: v };
            }
          }
          rt.set(patch);
        }}
      />
    </g>
  );
}

/** The current value on a sweep curve: a dot at (s, f(s)), dragged along the curve to set s unless s is locked. */
function SweepMark({ spec, param, curve, rt, highlight }: { spec: PanelsSpec; param: string; curve: CurveData; rt: Runtime; highlight: boolean }) {
  const now = rt.params[param] ?? spec.params?.[param]?.default ?? NaN;
  const at: Pt = [now, curve.f(now)];
  if (rt.isLocked(param)) return <Dot id={`${curve.id}-mark`} at={at} color={curve.color} highlight={highlight} />;
  return (
    <DragHandle
      id={`${curve.id}-mark`}
      at={at}
      axis="x"
      color={curve.color}
      label={`Drag ${spec.params?.[param]?.label ?? param}`}
      value={handleValue(spec, rt, param)}
      valueText={`${param} ${format(".3~r", now)}`}
      onMove={([mx]) => rt.set({ [param]: mx })}
    />
  );
}

/** What a point's handle reports as a slider: the first parameter it moves, within that parameter's range. */
function handleValue(spec: WidgetSpec, rt: Runtime, param: string) {
  const p = spec.params?.[param];
  return p ? { now: rt.params[param] ?? p.default, min: p.min, max: p.max } : undefined;
}

/** Endpoints of a line clipped to the plot: vertical (x), horizontal (y), or a segment (from, to). */
export function lineEnds(l: LineSpec, scope: Scope, xr: Range, yr: Range): [Pt, Pt] | null {
  if (l.x !== undefined) {
    const x = value(l.x, scope);
    return Number.isFinite(x) ? [[x, yr[0]], [x, yr[1]]] : null;
  }
  if (l.y !== undefined) {
    const y = value(l.y, scope);
    return Number.isFinite(y) ? [[xr[0], y], [xr[1], y]] : null;
  }
  if (l.from && l.to) return [[value(l.from[0], scope), value(l.from[1], scope)], [value(l.to[0], scope), value(l.to[1], scope)]];
  return null;
}

/** Labels for the marks every panel kind may carry: points, lines and arrows. */
export function markLabels(p: { points?: PointSpec[]; lines?: LineSpec[]; arrows?: ArrowSpec[] }, scope: Scope, rt: Runtime, shown: (id: string) => boolean, xr: Range, yr: Range): PlotLabel[] {
  const out: PlotLabel[] = [];
  const reveal = (id: string) => (rt.isRevealed(id) ? "w-reveal" : undefined);
  for (const pt of p.points ?? []) {
    const content = markText(pt.tex, pt.label);
    if (!content || !shown(pt.id)) continue;
    out.push({ id: pt.id, x: value(pt.x, scope), y: value(pt.y, scope), content, anchor: "ne", className: reveal(pt.id) });
  }
  for (const l of p.lines ?? []) {
    const content = markText(l.tex, l.label);
    if (!content || !shown(l.id)) continue;
    const ends = lineEnds(l, scope, xr, yr);
    if (!ends) continue;
    // Vertical lines label near the top, horizontal ones at the right end, segments beside their midpoint
    // (so a gap segment's label never sits on the point at its end).
    if (l.from && l.to) {
      const mid: Pt = [(ends[0][0] + ends[1][0]) / 2, (ends[0][1] + ends[1][1]) / 2];
      out.push({ id: l.id, x: mid[0], y: mid[1], content, anchor: "e", className: reveal(l.id) });
    } else {
      out.push({ id: l.id, x: ends[1][0], y: ends[1][1], content, anchor: l.y !== undefined ? "nw" : "se", className: reveal(l.id) });
    }
  }
  for (const a of p.arrows ?? []) {
    const content = markText(a.tex, a.label);
    if (!content || !shown(a.id)) continue;
    out.push({ id: a.id, x: value(a.to[0], scope), y: value(a.to[1], scope), content, anchor: "ne", className: reveal(a.id) });
  }
  return out;
}

function buildLabels(panel: CurvePanelSpec, curves: CurveData[], scope: Scope, rt: Runtime, shown: (id: string) => boolean, xr: Range, yr: Range): PlotLabel[] {
  const out: PlotLabel[] = [];
  const inside = (y: number) => y >= yr[0] && y <= yr[1];
  const reveal = (id: string) => (rt.isRevealed(id) ? "w-reveal" : undefined);
  for (const c of curves) {
    const content = markText(c.tex, c.label);
    if (!content || !shown(c.id)) continue;
    const end = [...c.pts].reverse().find(([, y]) => Number.isFinite(y) && inside(y));
    if (!end) continue;
    const nearTop = end[1] > yr[1] - 0.14 * (yr[1] - yr[0]);
    out.push({ id: c.id, x: end[0], y: end[1], content, color: c.color, anchor: nearTop ? "sw" : "nw", avoid: true, className: reveal(c.id) });
  }
  const pointLabels = markLabels({ points: panel.points }, scope, rt, shown, xr, yr);
  out.push(...pointLabels);
  const byId = new Map(curves.map((c) => [c.id, c]));
  for (const r of panel.regions ?? []) {
    const content = markText(r.tex, r.label);
    if (!content || !shown(r.id)) continue;
    const [a, b] = r.between.map((id) => (id === "axis" ? undefined : byId.get(id)));
    const lo = Math.max(xr[0], a?.lo ?? -Infinity, b?.lo ?? -Infinity);
    const hi = Math.min(xr[1], a?.hi ?? Infinity, b?.hi ?? Infinity);
    const x = lo + 0.62 * (hi - lo);
    const y = ((a ? a.f(x) : 0) + (b ? b.f(x) : 0)) / 2;
    out.push({ id: r.id, x, y, content, anchor: "c", className: `w-label-region${reveal(r.id) ? " w-reveal" : ""}` });
  }
  out.push(...markLabels({ lines: panel.lines, arrows: panel.arrows }, scope, rt, shown, xr, yr));
  return out;
}

/** The learner's guess in a predict step without options: a marker they drag; it stays as a ghost after the reveal. */
function PredictMarker({ rt }: { rt: Runtime }) {
  const plot = usePlot();
  const p = rt.predict!;
  const at: Pt = p.marker ?? plot.fromNorm(50, 50);
  if (p.phase === "revealed") return p.marker ? <Dot at={p.marker} color="var(--why)" r={6} className="w-guess" /> : null;
  return (
    <DragHandle
      id="predict-marker"
      at={at}
      color="var(--why)"
      label="Your prediction"
      valueText={format(".3~r", at[0])}
      onMove={(pt) => p.placeMarker(pt)}
    />
  );
}
