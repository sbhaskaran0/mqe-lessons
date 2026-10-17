// SVG marks in data coordinates. Colours arrive as CSS variables, so they go through `style` (SVG presentation
// attributes don't resolve var()). Every data mark is clipped to the plot box.
import type { CSSProperties, ReactNode } from "react";
import { type Plot, usePlot } from "./PlotFrame";

export type LineStyle = "solid" | "dashed" | "dotted";
export type Pt = readonly [number, number];

const DASH: Record<LineStyle, string | undefined> = { solid: undefined, dashed: "7 5", dotted: "1.5 5" };

/** Sample y = f(x) at n + 1 evenly spaced points (non-finite values break the line). */
export function sample(f: (x: number) => number, x0: number, x1: number, n = 240): Pt[] {
  const out: Pt[] = [];
  if (!(x1 > x0)) return out;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    let y: number;
    try {
      y = f(x);
    } catch {
      y = NaN;
    }
    out.push([x, y]);
  }
  return out;
}

/** An SVG path through the points; gaps where a value is missing. Far-off values are clamped so the path stays
 *  drawable (the clip hides the excess). */
export function pathD(pts: readonly Pt[], plot: Plot): string {
  const lim = plot.ph * 4;
  let d = "";
  let pen = false;
  for (const [x, y] of pts) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    const sy = Math.max(-lim - plot.ph, Math.min(lim, plot.sy(y)));
    d += `${pen ? "L" : "M"}${plot.sx(x).toFixed(2)},${sy.toFixed(2)}`;
    pen = true;
  }
  return d;
}

export function Clip({ children }: { children: ReactNode }) {
  const { clipId } = usePlot();
  return <g clipPath={`url(#${clipId})`}>{children}</g>;
}

type CurveProps = {
  d: string;
  color: string;
  style?: LineStyle;
  width?: number;
  highlight?: boolean;
  /** Animate the stroke drawing on mount (solid lines only: dashes would be rescaled by pathLength). */
  draw?: boolean;
  className?: string;
  id?: string;
};

export function Curve({ d, color, style = "solid", width = 2.25, highlight, draw, className, id }: CurveProps) {
  const drawable = draw && style === "solid";
  return (
    <g className={`w-mark${className ? ` ${className}` : ""}`} data-el={id}>
      {highlight ? <path className="w-halo" d={d} style={{ strokeWidth: width + 7 }} /> : null}
      <path
        className={`w-curve${drawable ? " w-draw" : ""}`}
        d={d}
        pathLength={drawable ? 1 : undefined}
        style={{ stroke: color, strokeWidth: highlight ? width + 0.75 : width, strokeDasharray: drawable ? undefined : DASH[style] }}
      />
    </g>
  );
}

export function Segment({ a, b, color, style = "solid", width = 1.5, highlight, className, id }: { a: Pt; b: Pt; color: string; style?: LineStyle; width?: number; highlight?: boolean; className?: string; id?: string }) {
  const plot = usePlot();
  const [x1, y1, x2, y2] = [plot.sx(a[0]), plot.sy(a[1]), plot.sx(b[0]), plot.sy(b[1])];
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  return (
    <g className={`w-mark${className ? ` ${className}` : ""}`} data-el={id}>
      {highlight ? <line className="w-halo" x1={x1} y1={y1} x2={x2} y2={y2} style={{ strokeWidth: width + 7 }} /> : null}
      <line className="w-curve" x1={x1} y1={y1} x2={x2} y2={y2} style={{ stroke: color, strokeWidth: width, strokeDasharray: DASH[style] }} />
    </g>
  );
}

export function Area({ d, color, opacity = 0.16, highlight, className, id }: { d: string; color: string; opacity?: number; highlight?: boolean; className?: string; id?: string }) {
  return (
    <g className={`w-mark${className ? ` ${className}` : ""}`} data-el={id}>
      <path className={`w-area${highlight ? " w-area-hl" : ""}`} d={d} style={{ fill: highlight ? "var(--chart-highlight)" : color, fillOpacity: highlight ? 0.32 : opacity } as CSSProperties} />
    </g>
  );
}

export function Dot({ at, color, r = 5, highlight, className, id }: { at: Pt; color: string; r?: number; highlight?: boolean; className?: string; id?: string }) {
  const plot = usePlot();
  const cx = plot.sx(at[0]);
  const cy = plot.sy(at[1]);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return (
    <g className={`w-mark${className ? ` ${className}` : ""}`} data-el={id}>
      {highlight ? <circle className="w-halo w-halo-dot" cx={cx} cy={cy} r={r + 7} /> : null}
      <circle className="w-dot" cx={cx} cy={cy} r={r} style={{ fill: color }} />
    </g>
  );
}

/** Dashed drop lines from a point to both axes. */
export function Guides({ at, className }: { at: Pt; className?: string }) {
  const plot = usePlot();
  const cx = plot.sx(at[0]);
  const cy = plot.sy(at[1]);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return (
    <g className={`w-guides${className ? ` ${className}` : ""}`}>
      <line x1={cx} y1={cy} x2={cx} y2={0} />
      <line x1={cx} y1={cy} x2={0} y2={cy} />
    </g>
  );
}

/** An arrow from `a` to `b` (a vector): a shaft and a head drawn in screen space, so the head keeps its size. */
export function Arrow({ a, b, color, style = "solid", width = 2, highlight, className, id }: { a: Pt; b: Pt; color: string; style?: LineStyle; width?: number; highlight?: boolean; className?: string; id?: string }) {
  const plot = usePlot();
  const [x1, y1, x2, y2] = [plot.sx(a[0]), plot.sy(a[1]), plot.sx(b[0]), plot.sy(b[1])];
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.min(10, len * 0.45);
  const at = (r: number, da: number) => `${(x2 - r * Math.cos(ang + da)).toFixed(2)},${(y2 - r * Math.sin(ang + da)).toFixed(2)}`;
  // The shaft stops inside the head so a wide stroke never pokes through its tip.
  const [sx, sy] = [x2 - head * 0.7 * Math.cos(ang), y2 - head * 0.7 * Math.sin(ang)];
  return (
    <g className={`w-mark${className ? ` ${className}` : ""}`} data-el={id}>
      {highlight ? <line className="w-halo" x1={x1} y1={y1} x2={x2} y2={y2} style={{ strokeWidth: width + 7 }} /> : null}
      <line className="w-curve" x1={x1} y1={y1} x2={sx} y2={sy} style={{ stroke: color, strokeWidth: highlight ? width + 0.75 : width, strokeDasharray: DASH[style] }} />
      {len > 0 ? <polygon className="w-arrowhead" points={`${x2.toFixed(2)},${y2.toFixed(2)} ${at(head, 0.42)} ${at(head, -0.42)}`} style={{ fill: color }} /> : null}
    </g>
  );
}

/** Level sets as one path per level, from marching-squares segments in data units. */
export function ContourLines({ levels, color, highlight, className, id }: { levels: { value: number; segments: [Pt, Pt][] }[]; color: string; highlight?: boolean; className?: string; id?: string }) {
  const plot = usePlot();
  return (
    <g className={`w-mark w-contour${className ? ` ${className}` : ""}`} data-el={id}>
      {levels.map((l, i) => {
        let d = "";
        for (const [p, q] of l.segments) d += `M${plot.sx(p[0]).toFixed(2)},${plot.sy(p[1]).toFixed(2)}L${plot.sx(q[0]).toFixed(2)},${plot.sy(q[1]).toFixed(2)}`;
        return d ? <path key={i} className="w-curve" d={d} data-level={l.value} style={{ stroke: color, strokeWidth: highlight ? 2 : 1.4, strokeOpacity: 0.55 + (0.45 * (i + 1)) / levels.length }} /> : null;
      })}
    </g>
  );
}

/** Histogram bars from x0 to x1 at `height` (data units), drawn from y = 0. */
export function Bars({ bars, color, highlight, className, id }: { bars: readonly { x0: number; x1: number; height: number }[]; color: string; highlight?: boolean; className?: string; id?: string }) {
  const plot = usePlot();
  return (
    <g className={`w-mark w-bars${highlight ? " w-bars-hl" : ""}${className ? ` ${className}` : ""}`} data-el={id}>
      {bars.map((b, i) => {
        const x0 = plot.sx(b.x0);
        const x1 = plot.sx(b.x1);
        const y1 = plot.sy(b.height);
        const h = plot.sy(0) - y1;
        return Number.isFinite(x0 + x1 + y1) && h > 0 ? <rect key={i} x={x0} y={y1} width={Math.max(1, x1 - x0)} height={h} style={{ fill: color }} /> : null;
      })}
    </g>
  );
}
