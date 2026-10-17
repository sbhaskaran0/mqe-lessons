// Inequality and shape measures of a distribution, in pure code: no React, no DOM, no expression engine. The
// widget runtime draws from it, and `expr.ts` / `npm run validate` call the same functions, so a test's numbers are
// the numbers on screen.
//
// Two kinds of distribution share one interface:
//  - a parametric family (lognormal, normal, pareto, uniform), whose measures use closed forms wherever they
//    exist. Only the log-variance of the normal and uniform has none; it comes from a fixed quantile grid, so it is
//    deterministic.
//  - a (weighted) sample, from a dataset column: measures of the empirical distribution, with the Lorenz curve
//    interpolated linearly between observations and quantiles at Hazen plotting positions (so the median of
//    1, 2, 3, 4 is 2.5).
import { erf } from "mathjs";
import { DIST_MEASURES } from "../spec";

export type Measure = (typeof DIST_MEASURES)[number];
export type Measures = Record<Measure, number>;
export type Family = "lognormal" | "normal" | "pareto" | "uniform";
export type FamilyParams = { mu?: number; sigma?: number; alpha?: number; xmin?: number; lo?: number; hi?: number };

/** Which `dist` keys each family takes: the ones that must be given, and the defaults of the others. */
export const FAMILIES: Record<Family, { required: (keyof FamilyParams)[]; defaults: FamilyParams }> = {
  lognormal: { required: ["sigma"], defaults: { mu: 0 } },
  normal: { required: ["sigma"], defaults: { mu: 0 } },
  pareto: { required: ["alpha"], defaults: { xmin: 1 } },
  uniform: { required: ["hi"], defaults: { lo: 0 } },
};

// ---------------------------------------------------------------- the normal distribution

const SQRT2 = Math.SQRT2;
const SQRT_2PI = Math.sqrt(2 * Math.PI);

export const normPdf = (z: number) => Math.exp(-0.5 * z * z) / SQRT_2PI;
export const normCdf = (z: number) => 0.5 * (1 + (erf as (v: number) => number)(z / SQRT2));

// Acklam's rational approximation (relative error ~1e-9), polished by one Halley step against the exact CDF.
const A = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
const B = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
const C = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const D = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];

/** The z with Φ(z) = p (±∞ at 0 and 1, NaN outside). */
export function normInv(p: number): number {
  if (!(p >= 0 && p <= 1)) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  let x: number;
  if (p < 0.02425 || p > 1 - 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p < 0.5 ? p : 1 - p));
    const t = (((((C[0]! * q + C[1]!) * q + C[2]!) * q + C[3]!) * q + C[4]!) * q + C[5]!) / ((((D[0]! * q + D[1]!) * q + D[2]!) * q + D[3]!) * q + 1);
    x = p < 0.5 ? t : -t;
  } else {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((A[0]! * r + A[1]!) * r + A[2]!) * r + A[3]!) * r + A[4]!) * r + A[5]!) * q) / (((((B[0]! * r + B[1]!) * r + B[2]!) * r + B[3]!) * r + B[4]!) * r + 1);
  }
  const e = normCdf(x) - p;
  const u = e * SQRT_2PI * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

// ---------------------------------------------------------------- the common interface

export type Dist = {
  measures: Measures;
  /** Value below which a share p of the population lies. */
  quantile: (p: number) => number;
  /** Share of the population at or below x. */
  cdf: (x: number) => number;
  /** Share of the total held by the poorest share p (0 and 1 at the ends). NaN where a Lorenz curve is undefined. */
  lorenz: (p: number) => number;
  /** Probability density at x (parametric families only; a sample is smoothed in shapes.ts). */
  pdf?: (x: number) => number;
  /** A range showing nearly all of the distribution (the default x-axis). */
  window: [number, number];
  /** The observations, sorted by value, for a sample. */
  sample?: { x: number[]; w: number[] };
};

const nan = (): Measures => Object.fromEntries(DIST_MEASURES.map((m) => [m, NaN])) as Measures;
const Z9 = normInv(0.9);
const Z1 = normInv(0.1);

const ratio = (a: number, b: number) => (b > 0 ? a / b : NaN);

/** Var(ln X) from a fixed grid of N quantiles: deterministic, and accurate to ~1e-6 for smooth quantile functions. */
function gridVarLog(quantile: (p: number) => number, N = 20000): number {
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < N; i++) {
    const q = quantile((i + 0.5) / N);
    if (!(q > 0)) return NaN;
    const l = Math.log(q);
    s += l;
    s2 += l * l;
  }
  return s2 / N - (s / N) ** 2;
}

function lognormal({ mu = 0, sigma }: FamilyParams): Dist {
  const s = sigma ?? NaN;
  const q = (p: number) => Math.exp(mu + s * normInv(p));
  const measures: Measures = {
    gini: 2 * normCdf(s / SQRT2) - 1,
    // exp(σ(z.9 − z.1)) and its two halves: the 90th over the 10th, the median over the 10th, the 90th over the median.
    p90p10: Math.exp(s * (Z9 - Z1)),
    p50p10: Math.exp(s * (0 - Z1)),
    p90p50: Math.exp(s * Z9),
    varlog: s * s,
    mean: Math.exp(mu + (s * s) / 2),
    median: Math.exp(mu),
    cv: Math.sqrt(Math.exp(s * s) - 1),
    top10: 1 - normCdf(Z9 - s),
  };
  return {
    measures,
    quantile: q,
    cdf: (x) => (x > 0 ? normCdf((Math.log(x) - mu) / s) : 0),
    lorenz: (p) => (p <= 0 ? 0 : p >= 1 ? 1 : normCdf(normInv(p) - s)),
    pdf: (x) => (x > 0 ? normPdf((Math.log(x) - mu) / s) / (x * s) : 0),
    window: [q(0.001), q(0.995)],
  };
}

function normal({ mu = 0, sigma }: FamilyParams): Dist {
  const s = sigma ?? NaN;
  const q = (p: number) => mu + s * normInv(p);
  const positive = mu > 0; // shares of a total, and a coefficient of variation, only mean something for a positive mean
  const measures: Measures = {
    // E|X − X'| / (2·mean), with E|X − X'| = 2σ/√π: the Gini of a normal that is (nearly) always positive.
    gini: positive ? s / (mu * Math.sqrt(Math.PI)) : NaN,
    p90p10: ratio(q(0.9), q(0.1)),
    p50p10: ratio(q(0.5), q(0.1)),
    p90p50: ratio(q(0.9), q(0.5)),
    varlog: gridVarLog(q),
    mean: mu,
    median: mu,
    cv: positive ? s / mu : NaN,
    top10: positive ? (0.1 * mu + s * normPdf(Z9)) / mu : NaN,
  };
  return {
    measures,
    quantile: q,
    cdf: (x) => normCdf((x - mu) / s),
    lorenz: (p) => (!positive ? NaN : p <= 0 ? 0 : p >= 1 ? 1 : (mu * p - s * normPdf(normInv(p))) / mu),
    pdf: (x) => normPdf((x - mu) / s) / s,
    window: [q(0.001), q(0.999)],
  };
}

function pareto({ alpha, xmin = 1 }: FamilyParams): Dist {
  const a = alpha ?? NaN;
  const q = (p: number) => xmin * (1 - p) ** (-1 / a);
  const measures: Measures = {
    gini: a > 1 ? 1 / (2 * a - 1) : 1,
    p90p10: 9 ** (1 / a),
    p50p10: 1.8 ** (1 / a),
    p90p50: 5 ** (1 / a),
    varlog: 1 / (a * a),
    mean: a > 1 ? (a * xmin) / (a - 1) : Infinity,
    median: xmin * 2 ** (1 / a),
    cv: a > 2 ? 1 / Math.sqrt(a * (a - 2)) : Infinity,
    top10: a > 1 ? 0.1 ** (1 - 1 / a) : 1,
  };
  return {
    measures,
    quantile: q,
    cdf: (x) => (x >= xmin ? 1 - (xmin / x) ** a : 0),
    lorenz: (p) => (p <= 0 ? 0 : p >= 1 ? 1 : a > 1 ? 1 - (1 - p) ** (1 - 1 / a) : 0),
    pdf: (x) => (x >= xmin ? (a * xmin ** a) / x ** (a + 1) : 0),
    window: [xmin, q(0.99)],
  };
}

function uniform({ lo = 0, hi }: FamilyParams): Dist {
  const h = hi ?? NaN;
  const w = h - lo;
  const q = (p: number) => lo + w * p;
  const mean = (lo + h) / 2;
  const lorenz = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : (lo * p + (w * p * p) / 2) / mean);
  const measures: Measures = {
    gini: w / (3 * (h + lo)),
    p90p10: ratio(q(0.9), q(0.1)),
    p50p10: ratio(q(0.5), q(0.1)),
    p90p50: ratio(q(0.9), q(0.5)),
    varlog: gridVarLog(q),
    mean,
    median: mean,
    cv: w / (Math.sqrt(12) * mean),
    top10: 1 - lorenz(0.9),
  };
  return {
    measures,
    quantile: q,
    cdf: (x) => Math.min(1, Math.max(0, (x - lo) / w)),
    lorenz,
    pdf: (x) => (x >= lo && x <= h ? 1 / w : 0),
    window: [lo - 0.08 * w, h + 0.08 * w],
  };
}

const BUILD: Record<Family, (p: FamilyParams) => Dist> = { lognormal, normal, pareto, uniform };

/** A parametric family. Invalid parameters (σ < 0, α ≤ 0, hi ≤ lo …) give NaN measures rather than an exception. */
export function parametric(family: Family, params: FamilyParams): Dist {
  const finite = Object.values(params).every((v) => v === undefined || Number.isFinite(v));
  const valid =
    finite &&
    (family === "lognormal" || family === "normal"
      ? params.sigma !== undefined && params.sigma >= 0
      : family === "pareto"
        ? params.alpha !== undefined && params.alpha > 0 && (params.xmin ?? 1) > 0
        : params.hi !== undefined && params.hi > (params.lo ?? 0));
  if (valid) return BUILD[family](params);
  const dead = () => NaN;
  return { measures: nan(), quantile: dead, cdf: dead, lorenz: dead, pdf: dead, window: [0, 1] };
}

// ---------------------------------------------------------------- a sample

/** Weighted observations. Non-finite values and non-positive or non-finite weights are dropped. */
export function empirical(values: readonly (number | null)[], weights?: readonly (number | null)[]): Dist {
  const obs: [number, number][] = [];
  values.forEach((x, i) => {
    const w = weights ? (weights[i] ?? NaN) : 1;
    if (x !== null && Number.isFinite(x) && Number.isFinite(w) && w > 0) obs.push([x, w]);
  });
  obs.sort((a, b) => a[0] - b[0]);
  const n = obs.length;
  if (!n) return { measures: nan(), quantile: () => NaN, cdf: () => NaN, lorenz: () => NaN, window: [0, 1] };

  const x = obs.map((o) => o[0]);
  const w = obs.map((o) => o[1]);
  const cumW: number[] = [];
  const cumXW: number[] = [];
  let sw = 0;
  let sxw = 0;
  for (let i = 0; i < n; i++) {
    sw += w[i]!;
    sxw += x[i]! * w[i]!;
    cumW.push(sw);
    cumXW.push(sxw);
  }
  const mean = sxw / sw;
  const variance = x.reduce((s, v, i) => s + w[i]! * (v - mean) ** 2, 0) / sw;
  const nonNegative = x[0]! >= 0 && sxw > 0;

  // Hazen positions: observation i sits at the middle of its weight; between positions, interpolate.
  const pos = cumW.map((c, i) => (c - w[i]! / 2) / sw);
  const quantile = (p: number) => {
    if (!(p >= 0 && p <= 1)) return NaN;
    if (p <= pos[0]!) return x[0]!;
    if (p >= pos[n - 1]!) return x[n - 1]!;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pos[mid]! <= p) lo = mid;
      else hi = mid;
    }
    return x[lo]! + ((x[hi]! - x[lo]!) * (p - pos[lo]!)) / (pos[hi]! - pos[lo]!);
  };

  // Lorenz vertices: (0, 0), then (share of weight, share of x·w) after each observation, joined by straight lines.
  const lorenz = (p: number) => {
    if (!nonNegative) return NaN;
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    const target = p * sw;
    let lo = 0;
    let hi = n - 1; // first observation whose cumulative weight reaches the target
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumW[mid]! >= target) hi = mid;
      else lo = mid + 1;
    }
    const w0 = lo === 0 ? 0 : cumW[lo - 1]!;
    const x0 = lo === 0 ? 0 : cumXW[lo - 1]!;
    return (x0 + ((cumXW[lo]! - x0) * (target - w0)) / w[lo]!) / sxw;
  };
  // Gini = 1 − 2·(area under the Lorenz curve), by the trapezoid rule over the vertices.
  let area = 0;
  for (let i = 0; i < n; i++) {
    const p0 = (i === 0 ? 0 : cumW[i - 1]!) / sw;
    const l0 = (i === 0 ? 0 : cumXW[i - 1]!) / sxw;
    area += ((cumW[i]! / sw - p0) * (cumXW[i]! / sxw + l0)) / 2;
  }

  let varlog = NaN;
  if (x[0]! > 0) {
    const lm = x.reduce((s, v, i) => s + w[i]! * Math.log(v), 0) / sw;
    varlog = x.reduce((s, v, i) => s + w[i]! * (Math.log(v) - lm) ** 2, 0) / sw;
  }
  const cdf = (v: number) => {
    let lo = 0;
    let hi = n; // count of observations at or below v
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (x[mid]! <= v) lo = mid + 1;
      else hi = mid;
    }
    return lo === 0 ? 0 : cumW[lo - 1]! / sw;
  };

  const measures: Measures = {
    gini: nonNegative ? 1 - 2 * area : NaN,
    p90p10: ratio(quantile(0.9), quantile(0.1)),
    p50p10: ratio(quantile(0.5), quantile(0.1)),
    p90p50: ratio(quantile(0.9), quantile(0.5)),
    varlog,
    mean,
    median: quantile(0.5),
    cv: mean !== 0 ? Math.sqrt(variance) / mean : NaN,
    top10: nonNegative ? 1 - lorenz(0.9) : NaN,
  };
  return { measures, quantile, cdf, lorenz, window: [quantile(0.002), quantile(0.998)], sample: { x, w } };
}
