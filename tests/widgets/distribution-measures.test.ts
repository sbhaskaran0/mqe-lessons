// The inequality measures: closed forms for the parametric families (and the quantile grid agreeing with them),
// and a four-observation dataset worked by hand.
import { describe, expect, it } from "vitest";
import { empirical, normCdf, normInv, normPdf, parametric } from "../../src/widgets/distribution/measures";
import { cdfCurve, density, histogram, logAxis, logTicks, lorenzCurve, toU } from "../../src/widgets/distribution/shapes";

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);

describe("the normal helpers", () => {
  it("match known values", () => {
    close(normCdf(0), 0.5, 1e-15);
    close(normCdf(1), 0.8413447460685429, 1e-12);
    close(normInv(0.9), 1.2815515655446004, 1e-12);
    close(normInv(0.975), 1.959963984540054, 1e-12);
    close(normInv(0.001), -3.090232306167813, 1e-12);
    close(normPdf(0), 1 / Math.sqrt(2 * Math.PI), 1e-15);
  });
  it("invert the CDF across the range, tails included", () => {
    for (const p of [1e-8, 0.001, 0.02, 0.1, 0.3, 0.5, 0.7, 0.9, 0.98, 0.999, 1 - 1e-8]) close(normCdf(normInv(p)), p, 1e-12);
    expect(normInv(0)).toBe(-Infinity);
    expect(normInv(1)).toBe(Infinity);
    expect(normInv(1.2)).toBeNaN();
  });
});

describe("lognormal closed forms", () => {
  const z9 = normInv(0.9);
  for (const sigma of [0.2, 0.5, 0.8, 1.2]) {
    it(`σ = ${sigma}: Gini, ratios, variance of logs, top-10 share`, () => {
      const m = parametric("lognormal", { sigma }).measures;
      close(m.gini, 2 * normCdf(sigma / Math.SQRT2) - 1);
      close(m.p90p10, Math.exp(2 * sigma * z9));
      close(m.p50p10, Math.exp(sigma * z9));
      close(m.p90p50, Math.exp(sigma * z9));
      close(m.varlog, sigma * sigma);
      close(m.top10, 1 - normCdf(z9 - sigma));
      close(m.median, 1);
      close(m.mean, Math.exp((sigma * sigma) / 2));
      close(m.cv, Math.sqrt(Math.exp(sigma * sigma) - 1));
    });
  }

  it("σ = 0.8 gives the textbook numbers", () => {
    const m = parametric("lognormal", { sigma: 0.8 }).measures;
    close(m.gini, 0.42839, 1e-5);
    close(m.p90p10, 7.7717, 1e-4);
    close(m.top10, 0.31506, 1e-5);
  });

  it("μ shifts levels but not inequality", () => {
    const a = parametric("lognormal", { mu: 0, sigma: 0.6 }).measures;
    const b = parametric("lognormal", { mu: 2.5, sigma: 0.6 }).measures;
    close(a.gini, b.gini);
    close(a.p90p10, b.p90p10);
    close(b.median / a.median, Math.exp(2.5));
  });

  it("σ = 0 is equality; an invalid σ is NaN", () => {
    const m = parametric("lognormal", { sigma: 0 }).measures;
    close(m.gini, 0);
    close(m.p90p10, 1);
    close(m.top10, 0.1);
    expect(parametric("lognormal", { sigma: -1 }).measures.gini).toBeNaN();
    expect(parametric("lognormal", { sigma: NaN }).measures.gini).toBeNaN();
  });

  it("its Lorenz curve integrates to the same Gini, and top-10 equals 1 − L(0.9)", () => {
    const d = parametric("lognormal", { sigma: 0.9 });
    const N = 20000;
    let area = 0;
    for (let i = 0; i < N; i++) area += d.lorenz((i + 0.5) / N) / N;
    close(1 - 2 * area, d.measures.gini, 1e-5);
    close(1 - d.lorenz(0.9), d.measures.top10);
    expect(d.lorenz(0)).toBe(0);
    expect(d.lorenz(1)).toBe(1);
  });

  it("quantile, cdf and pdf agree", () => {
    const d = parametric("lognormal", { mu: 0.3, sigma: 0.7 });
    for (const p of [0.05, 0.5, 0.95]) close(d.cdf(d.quantile(p)), p);
    const h = 1e-5;
    close((d.cdf(2 + h) - d.cdf(2 - h)) / (2 * h), d.pdf!(2), 1e-6);
  });
});

describe("pareto, uniform and normal", () => {
  it("pareto closed forms", () => {
    const m = parametric("pareto", { alpha: 3, xmin: 2 }).measures;
    close(m.gini, 1 / 5);
    close(m.mean, 3);
    close(m.median, 2 * 2 ** (1 / 3));
    close(m.p90p10, 9 ** (1 / 3));
    close(m.varlog, 1 / 9);
    close(m.top10, 0.1 ** (2 / 3));
    close(m.cv, 1 / Math.sqrt(3));
  });

  it("pareto with a tail too heavy for a mean", () => {
    const m = parametric("pareto", { alpha: 0.8 }).measures;
    expect(m.mean).toBe(Infinity);
    expect(m.gini).toBe(1);
    expect(m.top10).toBe(1);
  });

  it("uniform closed forms (Gini 1/3 from zero)", () => {
    const m = parametric("uniform", { lo: 0, hi: 2 }).measures;
    close(m.gini, 1 / 3);
    close(m.mean, 1);
    close(m.cv, 1 / Math.sqrt(3));
    close(m.top10, 0.19);
    const shifted = parametric("uniform", { lo: 1, hi: 3 }).measures;
    close(shifted.gini, 2 / 12);
    close(shifted.p90p10, 2.8 / 1.2);
  });

  it("normal: closed forms, and the grid log-variance of a tight normal is near (σ/μ)²", () => {
    const m = parametric("normal", { mu: 10, sigma: 1 }).measures;
    close(m.gini, 1 / (10 * Math.sqrt(Math.PI)));
    close(m.cv, 0.1);
    close(m.top10, (1 + normPdf(normInv(0.9))) / 10);
    close(m.varlog, 0.01, 6e-4);
  });

  it("the quantile grid is accurate where the answer is known: Var(ln U) = 1 for U uniform on (0, 1)", () => {
    close(parametric("uniform", { lo: 0, hi: 1 }).measures.varlog, 1, 2e-3);
  });

  it("ratios are NaN when the 10th percentile is not positive", () => {
    expect(parametric("normal", { mu: 1, sigma: 2 }).measures.p90p10).toBeNaN();
  });
});

describe("a dataset column, worked by hand: 1, 2, 3, 4", () => {
  const m = empirical([1, 2, 3, 4]).measures;
  it("Gini = Σ(2i − n − 1)xᵢ / (n Σx) = 10 / 40", () => close(m.gini, 0.25));
  it("mean, median (2.5, a Hazen position) and the population-sd coefficient of variation", () => {
    close(m.mean, 2.5);
    close(m.median, 2.5);
    close(m.cv, Math.sqrt(1.25) / 2.5);
  });
  it("percentile ratios: p10 = 1, p50 = 2.5, p90 = 4", () => {
    close(m.p90p10, 4);
    close(m.p50p10, 2.5);
    close(m.p90p50, 1.6);
  });
  it("top-10 share = 1 − L(0.9) = 1 − (0.6 + 0.6·0.4) = 0.16", () => close(m.top10, 0.16));
  it("variance of logs = mean squared deviation of ln x", () => {
    const ls = [1, 2, 3, 4].map(Math.log);
    const mean = ls.reduce((a, b) => a + b) / 4;
    close(m.varlog, ls.reduce((a, b) => a + (b - mean) ** 2, 0) / 4);
    close(m.varlog, 0.271052, 1e-6);
  });

  it("weights: a weight of 3 on the value 4 equals repeating it three times (for everything but the interpolated quantiles)", () => {
    const w = empirical([1, 2, 3, 4], [1, 1, 1, 3]).measures;
    const r = empirical([1, 2, 3, 4, 4, 4]).measures;
    for (const k of ["gini", "mean", "cv", "top10", "varlog"] as const) close(w[k], r[k], 1e-12);
    close(w.mean, 3, 1e-12); // (1 + 2 + 3 + 3·4) / 6
  });

  it("order doesn't matter, and zero-weight and non-finite observations are dropped", () => {
    const a = empirical([4, 1, 3, 2, 99], [1, 1, 1, 1, 0]).measures;
    for (const k of Object.keys(a) as (keyof typeof a)[]) close(a[k], m[k], 1e-12);
    expect(empirical([1, 2, NaN, null]).measures.mean).toBe(1.5);
  });

  it("perfect equality has Gini 0; one holder has Gini (n − 1)/n", () => {
    close(empirical([5, 5, 5, 5]).measures.gini, 0);
    close(empirical([0, 0, 0, 8]).measures.gini, 0.75);
  });

  it("negative values: Lorenz-based measures and log variance are undefined, the rest are not", () => {
    const d = empirical([-1, 2, 3]);
    expect(d.measures.gini).toBeNaN();
    expect(d.measures.top10).toBeNaN();
    expect(d.measures.varlog).toBeNaN();
    close(d.measures.mean, 4 / 3);
  });

  it("an empty column gives NaN everywhere", () => {
    expect(empirical([]).measures.gini).toBeNaN();
  });

  it("agrees with the lognormal closed forms on a large deterministic sample", () => {
    const ln = parametric("lognormal", { sigma: 0.7 });
    const N = 20000;
    const xs = Array.from({ length: N }, (_, i) => ln.quantile((i + 0.5) / N));
    const e = empirical(xs).measures;
    close(e.gini, ln.measures.gini, 2e-3);
    close(e.p90p10, ln.measures.p90p10, 5e-3);
    close(e.varlog, ln.measures.varlog, 5e-3);
  });
});

describe("shapes", () => {
  const area = (pts: [number, number][]) => pts.slice(1).reduce((s, p, i) => s + ((p[1] + pts[i]![1]) / 2) * (p[0] - pts[i]![0]), 0);

  it("histogram bars hold the population inside the range; heights are mass per unit of u", () => {
    const d = parametric("lognormal", { sigma: 0.6 });
    const bars = histogram(d, [d.quantile(0.01), d.quantile(0.99)], false, 40);
    close(bars.reduce((s, b) => s + b.mass, 0), 0.98, 1e-9);
    for (const b of bars) close(b.height * (b.u1 - b.u0), b.mass, 1e-12);
  });

  it("a sample's first bin keeps its smallest observation", () => {
    close(histogram(empirical([1, 2, 3, 4]), [1, 4], false, 3).reduce((s, b) => s + b.mass, 0), 1, 1e-12);
  });

  it("a density integrates to the mass in range, on a linear and a log axis", () => {
    const d = parametric("lognormal", { sigma: 0.5 });
    for (const log of [false, true]) {
      const pts = density(d, [d.quantile(0.001), d.quantile(0.999)], log, 4000);
      close(area(pts), 0.998, 2e-3);
    }
  });

  it("a sample's smoothed density integrates to about 1", () => {
    const ln = parametric("lognormal", { sigma: 0.5 });
    const d = empirical(Array.from({ length: 3000 }, (_, i) => ln.quantile((i + 0.5) / 3000)));
    close(area(density(d, [d.quantile(0.0005), d.quantile(0.9995)], true)), 1, 0.05);
  });

  it("cdf and Lorenz curves start and end where they should", () => {
    const d = parametric("lognormal", { sigma: 0.6 });
    const c = cdfCurve(d, [d.quantile(0.001), d.quantile(0.999)], false);
    close(c[0]![1], 0.001, 1e-9);
    close(c[c.length - 1]![1], 0.999, 1e-9);
    const l = lorenzCurve(d);
    expect(l[0]).toEqual([0, 0]);
    expect(l[l.length - 1]).toEqual([1, 1]);
  });

  it("log axes need a positive range and get 1-2-5 ticks (powers of ten when wide)", () => {
    expect(logAxis(true, [0, 5])).toBe(false);
    expect(logAxis(true, [1, 5])).toBe(true);
    expect(logAxis(false, [1, 5])).toBe(false);
    close(toU(1000, true), 3);
    expect(logTicks([1, 100], String).map((t) => t.label)).toEqual(["1", "2", "5", "10", "20", "50", "100"]);
    expect(logTicks([1, 1e6], String).map((t) => t.label)).toEqual(["1", "10", "100", "1000", "10000", "100000", "1000000"]);
  });
});
