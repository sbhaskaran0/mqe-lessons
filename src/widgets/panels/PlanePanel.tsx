// Plane panels: a contour panel draws level sets of f(x, y), where each axis binds a model variable or sweeps a
// parameter; a vector panel is a plain x-y frame for arrows (optionally with equal units). Both also take points,
// lines and arrows at the current values.
import { useMemo } from "react";
import { resolveColor } from "../core/colors";
import { value } from "../core/evaluate";
import type { Runtime } from "../core/useWidgetRuntime";
import { layerSafe, type Scope, withDerived } from "../expr";
import { autoLevels, contourSegments, sampleGrid } from "../plot/contour";
import { Arrow, Clip, ContourLines, Guides, Segment } from "../plot/marks";
import { PlotFrame, type PlotShare, usePlot } from "../plot/PlotFrame";
import type { Range } from "../plot/ticks";
import type { Panel, WidgetSpec } from "../spec";
import { lineEnds, markLabels, PointMark } from "./CurvePanel";
import type { ShowRule } from "./show";

type ContourSpec = Extract<Panel, { kind: "contour" }>;
type VectorSpec = Extract<Panel, { kind: "vector" }>;

type Props = {
  /** A panels spec, or a scatter-fit whose contour panels sweep its line's parameters. */
  spec: WidgetSpec;
  panel: ContourSpec | VectorSpec;
  scope: Scope;
  rt: Runtime;
  show: ShowRule;
  height: number;
  share?: PlotShare;
  titled: boolean;
  ariaTitle: string;
};

export function PlanePanel({ spec, panel, scope, rt, show, height, share, titled, ariaTitle }: Props) {
  const x: Range = useMemo(() => [panel.x.min, panel.x.max], [panel.x.min, panel.x.max]);
  const y: Range = useMemo(() => [panel.y.min, panel.y.max], [panel.y.min, panel.y.max]);
  const levels = useMemo(() => (panel.kind === "contour" ? contourLevels(spec, panel, scope, rt.params, x, y) : []), [spec, panel, scope, rt.params, x, y]);
  const shown = (id: string) => show.mark(id, panel.id);
  const labels = markLabels(panel, scope, rt, shown, x, y);
  return (
    <div className="w-panel" data-panel={panel.id}>
      {titled && panel.title ? <div className="w-panel-title">{panel.title}</div> : null}
      <PlotFrame
        x={x}
        y={y}
        height={height}
        share={share}
        square={panel.kind === "vector" && panel.square}
        equal={panel.aspect === "equal"}
        xTitle={panel.x.label || panel.x.tex ? { label: panel.x.label, tex: panel.x.tex } : undefined}
        yTitle={panel.y.label || panel.y.tex ? { label: panel.y.label, tex: panel.y.tex } : undefined}
        labels={labels}
        ariaLabel={`${panel.title ?? ariaTitle}: ${panel.kind === "contour" ? "level sets" : "vectors"}`}
      >
        <Clip>
          {levels.length && !rt.pending(panel.id) ? <ContourLines id={`${panel.id}-levels`} levels={levels} color="var(--chart-1)" highlight={rt.highlight === panel.id} /> : null}
          <PlaneMarks panel={panel} scope={scope} rt={rt} shown={shown} />
        </Clip>
        {(panel.points ?? []).filter((p) => shown(p.id)).map((p) => (
          <PointMark key={p.id} spec={spec} p={p} scope={scope} rt={rt} highlight={rt.highlight === p.id} className={rt.isRevealed(p.id) ? "w-reveal" : undefined} />
        ))}
      </PlotFrame>
    </div>
  );
}

function PlaneMarks({ panel, scope, rt, shown }: { panel: ContourSpec | VectorSpec; scope: Scope; rt: Runtime; shown: (id: string) => boolean }) {
  const plot = usePlot();
  const cls = (id: string) => (rt.isRevealed(id) ? "w-reveal" : undefined);
  return (
    <>
      {(panel.lines ?? []).filter((l) => shown(l.id)).map((l, i) => {
        const ends = lineEnds(l, scope, plot.x, plot.y);
        return ends ? <Segment key={l.id} id={l.id} a={ends[0]} b={ends[1]} color={resolveColor(l.color, i + 1)} style={l.style} highlight={rt.highlight === l.id} className={cls(l.id)} /> : null;
      })}
      {(panel.arrows ?? []).filter((a) => shown(a.id)).map((a, i) => (
        <Arrow key={a.id} id={a.id} a={[value(a.from[0], scope), value(a.from[1], scope)]} b={[value(a.to[0], scope), value(a.to[1], scope)]} color={resolveColor(a.color, (panel.lines?.length ?? 0) + i + 1)} style={a.style} highlight={rt.highlight === a.id} className={cls(a.id)} />
      ))}
      {(panel.points ?? []).filter((p) => shown(p.id) && p.guides).map((p) => (
        <Guides key={`g-${p.id}`} at={[value(p.x, scope), value(p.y, scope)]} className={cls(p.id)} />
      ))}
    </>
  );
}

/** The level sets of a contour panel at the current values. A swept axis re-derives the model at each grid value,
 *  which costs a derived chain per point; an axis that binds a variable only re-evaluates f. */
export function contourLevels(spec: WidgetSpec, panel: ContourSpec, scope: Scope, params: Scope, x: Range, y: Range) {
  const n = panel.grid ?? 60;
  const f = layerSafe(spec, panel.f);
  const { x: ax, y: ay } = panel;
  const at = (u: number, v: number) => {
    let sc = scope;
    // The rest of `scope` (a scatter-fit's data sums) stays in scope under the re-derived values.
    if (ax.sweep || ay.sweep) sc = { ...scope, ...withDerived(spec, { ...params, ...(ax.sweep ? { [ax.sweep]: u } : {}), ...(ay.sweep ? { [ay.sweep]: v } : {}) }) };
    return f({ ...sc, ...(ax.var ? { [ax.var]: u } : {}), ...(ay.var ? { [ay.var]: v } : {}) });
  };
  const z = sampleGrid(at, x, y, n);
  const values = panel.levels ? panel.levels.map((l) => value(l, scope)).filter(Number.isFinite) : autoLevels(z, panel.count ?? 9);
  return values.map((v) => ({ value: v, segments: contourSegments(z, n, v, x, y) }));
}
