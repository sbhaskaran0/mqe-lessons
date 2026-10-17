// The curves a distribution widget draws, as points in plot coordinates `u`: u = x on a linear axis and
// u = log10 x on a log axis. Densities are per unit of u, so the area under a histogram or density is the share of
// the population it covers, on either axis.
import type { Dist } from "./measures";

export type Pt = [number, number];
export type Range = [number, number];
export type Bar = { u0: number; u1: number; mass: number; height: number };

export const toU = (x: number, log: boolean) => (log ? Math.log10(x) : x);
export const fromU = (u: number, log: boolean) => (log ? 10 ** u : u);

/** A log axis needs a positive range; otherwise the axis stays linear. */
export function logAxis(wanted: boolean | undefined, range: Range): boolean {
  return !!wanted && range[0] > 0 && range[1] > range[0];
}

/** x-axis range: the author's bounds where given, else the distribution's window. */
export function xRange(dist: Dist, min: number | undefined, max: number | undefined): Range {
  let lo = min ?? dist.window[0];
  let hi = max ?? dist.window[1];
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) [lo, hi] = [0, 1];
  return [lo, hi];
}

/** Equal-width bins in u over `range` (an x range) with the population share in each. */
export function histogram(dist: Dist, range: Range, log: boolean, bins: number): Bar[] {
  const [u0, u1] = [toU(range[0], log), toU(range[1], log)];
  const step = (u1 - u0) / bins;
  const sampleMin = dist.sample?.x[0];
  const edge = (i: number) => fromU(u0 + step * i, log);
  const out: Bar[] = [];
  for (let i = 0; i < bins; i++) {
    // The CDF counts a value at its own x, so the first bin must not drop the smallest observation.
    const below = i === 0 && sampleMin !== undefined && sampleMin >= range[0] ? 0 : dist.cdf(edge(i));
    const mass = Math.max(0, dist.cdf(edge(i + 1)) - below);
    out.push({ u0: u0 + step * i, u1: u0 + step * (i + 1), mass, height: mass / step });
  }
  return out;
}

const SMOOTH_BINS = 160;

/** The density over `range`: the closed-form pdf for a family, a Gaussian kernel estimate for a sample. */
export function density(dist: Dist, range: Range, log: boolean, points = 200): Pt[] {
  const [u0, u1] = [toU(range[0], log), toU(range[1], log)];
  if (dist.pdf) {
    const pdf = dist.pdf;
    return Array.from({ length: points + 1 }, (_, i) => {
      const u = u0 + ((u1 - u0) * i) / points;
      const x = fromU(u, log);
      return [u, log ? pdf(x) * x * Math.LN10 : pdf(x)] as Pt;
    });
  }
  const bars = histogram(dist, range, log, SMOOTH_BINS);
  const h = bandwidth(dist, log, (u1 - u0) / 50);
  const centres = bars.map((b) => (b.u0 + b.u1) / 2);
  return centres.map((u, j) => {
    let s = 0;
    for (let k = Math.max(0, j - 40); k < Math.min(bars.length, j + 41); k++) {
      const z = (u - centres[k]!) / h;
      s += bars[k]!.mass * Math.exp(-0.5 * z * z);
    }
    return [u, s / (h * Math.sqrt(2 * Math.PI))] as Pt;
  });
}

/** Silverman's rule of thumb in u: 0.9 · min(sd, IQR / 1.34) · n_eff^(-1/5). */
function bandwidth(dist: Dist, log: boolean, fallback: number): number {
  const s = dist.sample;
  if (!s) return fallback;
  const us = s.x.map((x) => toU(x, log));
  let sw = 0;
  let sw2 = 0;
  let m = 0;
  us.forEach((u, i) => {
    sw += s.w[i]!;
    sw2 += s.w[i]! ** 2;
    m += s.w[i]! * u;
  });
  m /= sw;
  const sd = Math.sqrt(us.reduce((a, u, i) => a + s.w[i]! * (u - m) ** 2, 0) / sw);
  const iqr = toU(dist.quantile(0.75), log) - toU(dist.quantile(0.25), log);
  const spread = Math.min(sd, iqr > 0 ? iqr / 1.34 : sd);
  const h = 0.9 * spread * (sw * sw / sw2) ** -0.2;
  return Number.isFinite(h) && h > 0 ? h : fallback;
}

export function cdfCurve(dist: Dist, range: Range, log: boolean, points = 240): Pt[] {
  const [u0, u1] = [toU(range[0], log), toU(range[1], log)];
  return Array.from({ length: points + 1 }, (_, i) => {
    const u = u0 + ((u1 - u0) * i) / points;
    return [u, dist.cdf(fromU(u, log))] as Pt;
  });
}

export function lorenzCurve(dist: Dist, points = 240): Pt[] {
  return Array.from({ length: points + 1 }, (_, i) => [i / points, dist.lorenz(i / points)] as Pt);
}

/** Tick positions (in u) and labels for a log axis: 1, 2 and 5 times each power of ten when the range spans a few
 *  decades, else the powers of ten alone (every few, for a very wide range). */
export function logTicks(range: Range, fmt: (x: number) => string): { at: number; label: string }[] {
  const [lo, hi] = range;
  const decades = Math.log10(hi / lo);
  const mults = decades <= 3 ? [1, 2, 5] : [1];
  const every = Math.max(1, Math.ceil(decades / 8));
  const out: { at: number; label: string }[] = [];
  for (let k = Math.floor(Math.log10(lo)); k <= Math.ceil(Math.log10(hi)); k += every) {
    for (const m of mults) {
      const x = m * 10 ** k;
      if (x >= lo * (1 - 1e-9) && x <= hi * (1 + 1e-9)) out.push({ at: Math.log10(x), label: fmt(x) });
    }
  }
  return out;
}
