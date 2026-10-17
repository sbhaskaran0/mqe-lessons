// A draggable point in data coordinates: Mafs' gesture handling (pointer, touch, arrow keys) and point display,
// exposed to assistive tech as a slider. Moves arrive in data units, already kept inside the plot box.
import { MovablePointDisplay, useMovable } from "mafs";
import { type RefObject, useLayoutEffect, useRef } from "react";
import { usePlot } from "./PlotFrame";
import type { Pt } from "./marks";

type Props = {
  at: Pt;
  onMove: (p: [number, number]) => void;
  axis?: "x" | "y" | "both";
  color?: string;
  label: string;
  /** The value a slider reports: the parameter the handle sets, with its range. Without it, the handle's position on
   *  the axis it moves along (x when it moves freely) within the plot's range. */
  value?: { now: number; min: number; max: number };
  valueText: string;
  className?: string;
  id?: string;
};

export function DragHandle({ at, onMove, axis = "both", color = "var(--accent)", label, value, valueText, className, id }: Props) {
  const plot = usePlot();
  const ref = useRef<SVGGElement>(null);
  const point = plot.toNorm(at[0], at[1]);
  const finite = point.every(Number.isFinite);
  const safe: [number, number] = finite ? point : [50, 50];
  const constrain = ([u, v]: [number, number]): [number, number] => [
    axis === "y" ? safe[0] : Math.min(100, Math.max(0, u)),
    axis === "x" ? safe[1] : Math.min(100, Math.max(0, v)),
  ];
  const { dragging } = useMovable({
    gestureTarget: ref as RefObject<Element>,
    point: safe,
    constrain,
    onMove: ([u, v]) => onMove(plot.fromNorm(u, v)),
  });

  const along = axis === "y" ? 1 : 0;
  const v = value ?? { now: at[along], min: (along ? plot.y : plot.x)[0], max: (along ? plot.y : plot.x)[1] };
  // Mafs renders the point's <g>; these make it a slider for assistive tech (it already takes focus and arrow keys).
  useLayoutEffect(() => {
    const g = ref.current;
    if (!g) return;
    g.setAttribute("role", "slider");
    g.setAttribute("aria-label", label);
    g.setAttribute("aria-valuetext", valueText);
    g.setAttribute("aria-valuenow", String(round(v.now)));
    g.setAttribute("aria-valuemin", String(round(v.min)));
    g.setAttribute("aria-valuemax", String(round(v.max)));
    if (id) g.setAttribute("data-handle", id);
  }, [label, valueText, v.now, v.min, v.max, id]);

  if (!finite) return null;
  return (
    <g className={`w-handle${dragging ? " w-handle-dragging" : ""}${className ? ` ${className}` : ""}`}>
      <MovablePointDisplay ref={ref} point={safe} color={color} dragging={dragging} />
    </g>
  );
}

/** Enough digits for a value assistive tech reads (aria-valuetext carries the formatted one). */
function round(x: number): number {
  return Number.isFinite(x) ? Number(x.toPrecision(6)) : 0;
}
