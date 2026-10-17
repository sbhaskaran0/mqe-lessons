// The draggable guess for a prediction without options: a marker along one axis, which turns into a dotted guide
// once the learner commits.
import { DragHandle } from "../plot/DragHandle";
import { Clip, type Pt, Segment } from "../plot/marks";
import { usePlot } from "../plot/PlotFrame";
import type { Runtime } from "../core/useWidgetRuntime";

export function PredictMarker({ rt, axis, fmt }: { rt: Runtime; axis: "x" | "y"; fmt: (v: number) => string }) {
  const plot = usePlot();
  const p = rt.predict;
  if (!p || p.options || p.readout !== undefined) return null;
  const at: Pt = p.marker ?? (axis === "x" ? plot.fromNorm(50, 50) : plot.fromNorm(85, 50));
  const value = axis === "x" ? at[0] : at[1];
  if (p.phase === "revealed") {
    if (!p.marker) return null;
    const g = p.marker;
    return (
      <Clip>
        <Segment
          a={axis === "x" ? [g[0], plot.y[0]] : [plot.x[0], g[1]]}
          b={axis === "x" ? [g[0], plot.y[1]] : [plot.x[1], g[1]]}
          color="var(--why)"
          style="dotted"
          width={1.5}
          className="w-guess"
        />
      </Clip>
    );
  }
  return <DragHandle id="predict-marker" at={at} axis={axis} color="var(--why)" label="Your prediction" valueText={fmt(value)} onMove={(pt) => p.placeMarker(pt)} />;
}
