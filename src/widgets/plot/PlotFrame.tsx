// A plot: Mafs supplies the SVG canvas and accessible drag gestures; this frame owns the coordinate system.
// Mafs' "math space" is the plot box normalized to [0, 100] on both axes, so Mafs never sees data units (its
// view transform rounds scales to 5 decimals, which would misplace points on large-valued axes). Marks draw in
// SVG user units through `usePlot()`; text that needs KaTeX is laid over the SVG as HTML at the same pixels.
// For assistive tech the plot is a figure named by `ariaLabel`. Not an img: an img's children are presentational,
// which would hide the drag handles (sliders) inside it. The axes and labels are hidden; the name summarizes them.
import { Mafs } from "mafs";
import { createContext, type ReactNode, type RefObject, useContext, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Tex } from "../../lib/Tex";
import { useStageHeight } from "../ui/stage";
import { type Range, tickFormatter, ticks } from "./ticks";

/** How a widget that stacks plots splits the room: how many plots, how many carry an x axis, and whether this one does. */
export type PlotShare = { parts: number; axes: number; axis: boolean };
export type AxisTitle = { tex?: string; label?: string };
export type Anchor = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw" | "c";

export type PlotLabel = {
  id: string;
  x: number;
  y: number;
  content: ReactNode;
  anchor?: Anchor;
  color?: string;
  className?: string;
  /** Nudge vertically to avoid other labels that also set this (curve-end labels). */
  avoid?: boolean;
};

export type Plot = {
  x: Range;
  y: Range;
  /** Data -> SVG user units. The plot box spans [0, pw] × [-ph, 0]. */
  sx: (x: number) => number;
  sy: (y: number) => number;
  pw: number;
  ph: number;
  clipId: string;
  /** Data <-> the [0, 100]² space Mafs gestures work in. */
  toNorm: (x: number, y: number) => [number, number];
  fromNorm: (u: number, v: number) => [number, number];
};

const PlotContext = createContext<Plot | null>(null);

export function usePlot(): Plot {
  const p = useContext(PlotContext);
  if (!p) throw new Error("usePlot() outside a <PlotFrame>");
  return p;
}

/** Width of an element, tracked with ResizeObserver (0 until measured). */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width) || el.clientWidth);
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

type Props = {
  x: Range;
  y: Range;
  /** The height when the widget has not measured the room it has (inline in a step); in the pane the plot is sized to fit. */
  height: number;
  share?: PlotShare;
  xTitle?: AxisTitle;
  yTitle?: AxisTitle;
  /** Format y ticks as percentages (growth panels). */
  yPercent?: boolean;
  /** Replaces the x ticks: category bands, or powers of ten on a log axis (memoize it; a new array re-lays-out the plot). */
  xTickLabels?: { at: number; label: string }[];
  labels?: PlotLabel[];
  ariaLabel: string;
  onHover?: (x: number | null) => void;
  /** HTML laid over the plot in container pixels (hover tooltips). */
  overlay?: (px: (x: number, y: number) => [number, number]) => ReactNode;
  /** Equal units on both axes: the shorter range widens about its centre (vector diagrams). */
  square?: boolean;
  /** Equal units on both axes with the authored ranges kept: the plot box takes the ranges' shape (a square for equal
   *  ranges), as large as the room allows, centred, the rest of the width left as margin. */
  equal?: boolean;
  children: ReactNode;
};

const FONT_PX = 6.4; // average width of an 11px tabular digit, for sizing the y-tick gutter

export function PlotFrame({ x: xIn, y: yIn, height: fallbackHeight, share, xTitle, yTitle, yPercent, xTickLabels, labels, ariaLabel, onHover, overlay, square, equal, children }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = useStageHeight(fallbackHeight, share);
  const bare = share?.axis === false; // a stacked plot above one that carries the time axis
  const rawId = useId();
  const clipId = `w-clip-${rawId.replace(/[^A-Za-z0-9_-]/g, "")}`;

  const layout = useMemo(() => {
    const frame = (x: Range, y: Range) => {
      const yTicks = ticks(y[0], y[1], Math.max(2, Math.round((height - 50) / 42)));
      const yFmt = tickFormatter(yTicks, yPercent);
      const gutter = Math.max(...yTicks.map((t) => yFmt(t).length), 1) * FONT_PX;
      const m = { top: yTitle ? 26 : 12, right: 14, bottom: bare ? 8 : xTitle ? 42 : 24, left: Math.max(30, Math.ceil(gutter + 14)) };
      let pw = Math.max(10, width - m.left - m.right);
      let ph = Math.max(10, height - m.top - m.bottom);
      if (equal && x[1] > x[0] && y[1] > y[0]) {
        // The largest box with the ranges' aspect that fits: full width on a phone, full height in a wide pane.
        const ratio = (x[1] - x[0]) / (y[1] - y[0]);
        if (pw / ph > ratio) pw = Math.max(10, ph * ratio);
        else ph = Math.max(10, pw / ratio);
      }
      const xTicks = xTickLabels ? xTickLabels.map((t) => t.at) : ticks(x[0], x[1], Math.max(2, Math.round(pw / 78)));
      const named = xTickLabels ? new Map(xTickLabels.map((t) => [t.at, t.label])) : null;
      return { x, y, m, pw, ph, yTicks, yFmt, xTicks, xFmt: named ? (v: number) => named.get(v) ?? "" : tickFormatter(xTicks) };
    };
    const first = frame(xIn, yIn);
    if (!square) return first;
    const ux = (xIn[1] - xIn[0]) / first.pw;
    const uy = (yIn[1] - yIn[0]) / first.ph;
    const widen = (r: Range, k: number): Range => [(r[0] + r[1]) / 2 - ((r[1] - r[0]) * k) / 2, (r[0] + r[1]) / 2 + ((r[1] - r[0]) * k) / 2];
    return ux > uy ? frame(xIn, widen(yIn, ux / uy)) : frame(widen(xIn, uy / ux), yIn);
  }, [xIn, yIn, width, height, xTitle, yTitle, yPercent, xTickLabels, bare, square, equal]);

  const { m, pw, ph, x, y } = layout;
  const plot = useMemo<Plot>(() => {
    const dx = x[1] - x[0] || 1;
    const dy = y[1] - y[0] || 1;
    return {
      x,
      y,
      pw,
      ph,
      clipId,
      sx: (v) => ((v - x[0]) / dx) * pw,
      sy: (v) => -((v - y[0]) / dy) * ph,
      toNorm: (a, b) => [((a - x[0]) / dx) * 100, ((b - y[0]) / dy) * 100],
      fromNorm: (u, v) => [x[0] + (u / 100) * dx, y[0] + (v / 100) * dy],
    };
  }, [x, y, pw, ph, clipId]);

  // Container pixels for HTML overlays: the SVG's user origin sits at (m.left, m.top + ph).
  const px = (a: number, b: number): [number, number] => [m.left + plot.sx(a), m.top + ph + plot.sy(b)];

  const viewBox = useMemo(
    () => ({ x: [-(m.left / pw) * 100, 100 + (m.right / pw) * 100] as [number, number], y: [-(m.bottom / ph) * 100, 100 + (m.top / ph) * 100] as [number, number], padding: 0 }),
    [m, pw, ph],
  );

  const placed = placeLabels(labels ?? [], px);
  // With equal units the drawing is the plot box plus its margins, centred in the room; otherwise it fills the room.
  const boxW = equal ? Math.min(width, Math.ceil(pw + m.left + m.right)) : width;
  const boxH = equal ? Math.min(height, Math.ceil(ph + m.top + m.bottom)) : height;
  const inset = (width - boxW) / 2;

  return (
    <div
      ref={ref}
      className="w-plot"
      style={{ height: boxH }}
      role="figure"
      aria-label={ariaLabel}
      onPointerMove={
        onHover
          ? (e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const u = (e.clientX - box.left - inset - m.left) / pw;
              onHover(u >= 0 && u <= 1 ? x[0] + u * (x[1] - x[0]) : null);
            }
          : undefined
      }
      onPointerLeave={onHover ? () => onHover(null) : undefined}
    >
      {width > 0 ? (
        <div className="w-plot-box" style={equal ? { width: boxW, height: boxH, marginLeft: inset } : undefined}>
          <Mafs width={boxW} height={boxH} pan={false} zoom={false} preserveAspectRatio={false} viewBox={viewBox}>
            <PlotContext.Provider value={plot}>
              <defs>
                <clipPath id={clipId}>
                  <rect x={-2} y={-ph - 2} width={pw + 4} height={ph + 4} />
                </clipPath>
              </defs>
              <Axes xTicks={layout.xTicks} yTicks={layout.yTicks} xFmt={layout.xFmt} yFmt={layout.yFmt} bare={bare} />
              {children}
            </PlotContext.Provider>
          </Mafs>
          <div className="w-plot-overlay" aria-hidden="true">
            {xTitle && !bare ? (
              <div className="w-axis-title w-axis-title-x" style={{ right: m.right, top: m.top + ph + 22 }}>
                <AxisTitleText t={xTitle} />
              </div>
            ) : null}
            {yTitle ? (
              <div className="w-axis-title w-axis-title-y" style={{ left: Math.max(2, m.left - 10), top: 4 }}>
                <AxisTitleText t={yTitle} />
              </div>
            ) : null}
            {placed.map((l) => (
              <div
                key={l.id}
                className={`w-label w-anchor-${l.anchor ?? "ne"}${l.className ? ` ${l.className}` : ""}`}
                style={{ transform: `translate(${l.left.toFixed(1)}px, ${l.top.toFixed(1)}px)`, color: l.color }}
                data-label={l.id}
              >
                <span className="w-label-inner">{l.content}</span>
              </div>
            ))}
            {overlay?.(px)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AxisTitleText({ t }: { t: AxisTitle }) {
  return (
    <>
      {t.label ? <span>{t.label}</span> : null}
      {t.label && t.tex ? <span className="w-axis-sep">, </span> : null}
      {t.tex ? <Tex tex={t.tex} /> : null}
    </>
  );
}

const LABEL_GAP = 18;

/** Pixel positions, with curve-end labels pushed apart vertically so they never sit on top of each other. */
function placeLabels(labels: PlotLabel[], px: (x: number, y: number) => [number, number]) {
  const out = labels
    .map((l) => {
      const [left, top] = px(l.x, l.y);
      return { ...l, left, top };
    })
    .filter((l) => Number.isFinite(l.left) && Number.isFinite(l.top));
  const avoid = out.filter((l) => l.avoid).sort((a, b) => a.top - b.top);
  for (let i = 1; i < avoid.length; i++) {
    const prev = avoid[i - 1]!;
    const cur = avoid[i]!;
    if (cur.top - prev.top < LABEL_GAP && Math.abs(cur.left - prev.left) < 120) cur.top = prev.top + LABEL_GAP;
  }
  return out;
}

function Axes({ xTicks, yTicks, xFmt, yFmt, bare }: { xTicks: number[]; yTicks: number[]; xFmt: (v: number) => string; yFmt: (v: number) => string; bare: boolean }) {
  const { sx, sy, pw, ph, x, y } = usePlot();
  const inX = xTicks.filter((t) => t >= x[0] - 1e-9 && t <= x[1] + 1e-9);
  const inY = yTicks.filter((t) => t >= y[0] - 1e-9 && t <= y[1] + 1e-9);
  return (
    <g className="w-axes" aria-hidden="true">
      <g className="w-grid">
        {inX.map((t) => (
          <line key={`gx${t}`} x1={sx(t)} x2={sx(t)} y1={0} y2={-ph} />
        ))}
        {inY.map((t) => (
          <line key={`gy${t}`} x1={0} x2={pw} y1={sy(t)} y2={sy(t)} />
        ))}
      </g>
      {y[0] < 0 && y[1] > 0 ? <line className="w-zero" x1={0} x2={pw} y1={sy(0)} y2={sy(0)} /> : null}
      <line className="w-axis-line" x1={0} x2={pw} y1={0} y2={0} />
      <line className="w-axis-line" x1={0} x2={0} y1={0} y2={-ph} />
      <g className="w-ticks">
        {(bare ? [] : inX).map((t) => (
          <text key={`tx${t}`} x={sx(t)} y={15} textAnchor="middle">
            {xFmt(t)}
          </text>
        ))}
        {inY.map((t) => (
          <text key={`ty${t}`} x={-7} y={sy(t)} dy="0.32em" textAnchor="end">
            {yFmt(t)}
          </text>
        ))}
      </g>
    </g>
  );
}
