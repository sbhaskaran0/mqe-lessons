// Slider positions: the values a parameter's slider can take (min + k·step), which is also the grid a precomputed
// data-chart table is keyed by. Pure, so the slider, the table lookup, the point drag and `npm run validate` agree.
import type { ParamSpec } from "./types";

/** A round step giving about 100 positions across the range: what a slider without `step` moves by. */
export function autoStep(min: number, max: number): number {
  const raw = (max - min) / 100;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 5, 10].find((m) => m * mag >= raw) ?? 10;
  return Number((unit * mag).toPrecision(12));
}

export const stepOf = (p: Pick<ParamSpec, "min" | "max" | "step">): number => p.step ?? autoStep(p.min, p.max);

/** Index of the last position (positions run 0..last, never past max). */
export function lastPosition(p: Pick<ParamSpec, "min" | "max" | "step">): number {
  return Math.floor((p.max - p.min) / stepOf(p) + 1e-9);
}

/** The value of position k, rounded so 0.1 + 0.2 reads 0.3. */
export function positionValue(p: Pick<ParamSpec, "min" | "max" | "step">, k: number): number {
  return Number((p.min + k * stepOf(p)).toPrecision(12));
}

/** Every slider position, in order. */
export function positions(p: Pick<ParamSpec, "min" | "max" | "step">): number[] {
  return Array.from({ length: lastPosition(p) + 1 }, (_, k) => positionValue(p, k));
}

/** The nearest position to `v`, clamped to the range: where a dragged or animated value snaps for a lookup. */
export function nearestPosition(p: Pick<ParamSpec, "min" | "max" | "step">, v: number): number {
  return Math.min(lastPosition(p), Math.max(0, Math.round((v - p.min) / stepOf(p))));
}

/** `v` snapped to the nearest position. */
export const snap = (p: Pick<ParamSpec, "min" | "max" | "step">, v: number): number => positionValue(p, nearestPosition(p, v));

/** The position a table cell holds, or undefined when it is off the grid: within a relative 1e-5 of a position counts
 *  (exports keep 6 significant digits), anything else is not a slider value. */
export function cellPosition(p: Pick<ParamSpec, "min" | "max" | "step">, c: number): number | undefined {
  const k = Math.round((c - p.min) / stepOf(p));
  if (k < 0 || k > lastPosition(p)) return undefined;
  const tol = Math.max(1e-5 * Math.abs(c), 1e-6 * stepOf(p));
  return Math.abs(positionValue(p, k) - c) <= tol ? k : undefined;
}

/** The label of each position, when every position has one (a segmented control), else null. Label keys are numbers
 *  written as text (JSON keys), matched to positions as table cells are. */
export function positionLabels(p: ParamSpec): string[] | null {
  if (!p.labels) return null;
  const byPos = new Map<number, string>();
  for (const [k, text] of Object.entries(p.labels)) {
    const at = cellPosition(p, Number(k));
    if (at !== undefined) byPos.set(at, text);
  }
  const n = lastPosition(p) + 1;
  if (byPos.size < n) return null;
  return Array.from({ length: n }, (_, k) => byPos.get(k)!);
}

/** The label `value` has, if any (a slider whose positions are only partly labelled still names those). */
export function labelOf(p: ParamSpec, value: number): string | undefined {
  if (!p.labels) return undefined;
  for (const [k, text] of Object.entries(p.labels)) if (Math.abs(Number(k) - value) <= Math.max(1e-5 * Math.abs(value), 1e-6 * stepOf(p))) return text;
  return undefined;
}
