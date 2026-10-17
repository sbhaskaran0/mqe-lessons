// Nice axis ticks and domains (the d3 tickIncrement rule: steps of 1, 2 or 5 × 10^k).
import { format, stepDecimals } from "../format";

export type Range = [number, number];

export function tickStep(lo: number, hi: number, count: number): number {
  const raw = Math.abs(hi - lo) / Math.max(1, count);
  if (!Number.isFinite(raw) || raw === 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const err = raw / mag;
  const mult = err >= Math.sqrt(50) ? 10 : err >= Math.sqrt(10) ? 5 : err >= Math.SQRT2 ? 2 : 1;
  return Number((mult * mag).toPrecision(12));
}

export function ticks(lo: number, hi: number, count: number): number[] {
  if (!(hi > lo)) return [lo];
  const step = tickStep(lo, hi, count);
  const out: number[] = [];
  const first = Math.ceil(lo / step - 1e-9);
  const last = Math.floor(hi / step + 1e-9);
  for (let i = first; i <= last && out.length < 50; i++) out.push(Number((i * step).toPrecision(12)));
  return out;
}

/** The range widened to tick boundaries. */
export function nice(lo: number, hi: number, count = 5): Range {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (hi - lo < 1e-12) {
    const pad = Math.abs(lo) * 0.1 || 1;
    return nice(lo - pad, hi + pad, count);
  }
  const step = tickStep(lo, hi, count);
  return [Math.floor(lo / step + 1e-9) * step, Math.ceil(hi / step - 1e-9) * step];
}

/** Tick labels with as many decimals as the step needs; `percent` shows shares as %. */
export function tickFormatter(values: number[], percent = false): (v: number) => string {
  const step = values.length > 1 ? Math.abs(values[1]! - values[0]!) : 1;
  if (percent) return (v) => format(`.${Math.max(0, stepDecimals(Number((step * 100).toPrecision(6))))}%`, v);
  const big = Math.max(...values.map(Math.abs)) >= 1e4;
  return (v) => format(`${big ? "," : ""}.${stepDecimals(Number(step.toPrecision(6)))}f`, v);
}

/** Smallest and largest finite values. */
export function extent(values: Iterable<number>): Range | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : null;
}
