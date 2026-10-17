// Marching squares: the level sets of f(x, y) sampled on a grid, as line segments. Hand-rolled (about as long as an
// import would be) so contours need no new dependency. A saddle cell is split by the value at its centre.
import type { Pt } from "./marks";
import type { Range } from "./ticks";

/** f on a (n + 1) x (n + 1) grid over x × y, row-major from the bottom row (z[j * (n + 1) + i] is at x_i, y_j). */
export function sampleGrid(f: (x: number, y: number) => number, x: Range, y: Range, n: number): Float64Array {
  const z = new Float64Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++) {
    const yv = y[0] + ((y[1] - y[0]) * j) / n;
    for (let i = 0; i <= n; i++) {
      let v: number;
      try {
        v = f(x[0] + ((x[1] - x[0]) * i) / n, yv);
      } catch {
        v = NaN;
      }
      z[j * (n + 1) + i] = v;
    }
  }
  return z;
}

/** `count` levels at evenly spaced quantiles of the finite grid values, so a bowl with a steep rim (an SSR) still gets
 *  rings near its bottom. */
export function autoLevels(z: ArrayLike<number>, count: number): number[] {
  const v = Array.from(z).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return [];
  const out: number[] = [];
  for (let k = 1; k <= count; k++) {
    const q = v[Math.min(v.length - 1, Math.floor((k / (count + 1)) * v.length))]!;
    if (!out.length || q > out[out.length - 1]!) out.push(q);
  }
  return out;
}

/** Segments where the grid crosses `level`, in data units. */
export function contourSegments(z: ArrayLike<number>, n: number, level: number, x: Range, y: Range): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  const X = (i: number) => x[0] + ((x[1] - x[0]) * i) / n;
  const Y = (j: number) => y[0] + ((y[1] - y[0]) * j) / n;
  const frac = (a: number, b: number) => (a === b ? 0.5 : (level - a) / (b - a));
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const z00 = z[j * (n + 1) + i]!;
      const z10 = z[j * (n + 1) + i + 1]!;
      const z11 = z[(j + 1) * (n + 1) + i + 1]!;
      const z01 = z[(j + 1) * (n + 1) + i]!;
      if (![z00, z10, z11, z01].every(Number.isFinite)) continue;
      const c = (z00 >= level ? 1 : 0) | (z10 >= level ? 2 : 0) | (z11 >= level ? 4 : 0) | (z01 >= level ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const bottom: Pt = [X(i + frac(z00, z10)), Y(j)];
      const right: Pt = [X(i + 1), Y(j + frac(z10, z11))];
      const top: Pt = [X(i + frac(z01, z11)), Y(j + 1)];
      const left: Pt = [X(i), Y(j + frac(z00, z01))];
      const centre = (z00 + z10 + z11 + z01) / 4 >= level;
      switch (c) {
        case 1: case 14: out.push([left, bottom]); break;
        case 2: case 13: out.push([bottom, right]); break;
        case 3: case 12: out.push([left, right]); break;
        case 4: case 11: out.push([right, top]); break;
        case 6: case 9: out.push([bottom, top]); break;
        case 7: case 8: out.push([left, top]); break;
        // Saddles: corners 00 and 11 above (5) or 10 and 01 above (10). A centre on the same side as a diagonal pair
        // joins that pair, so the segments cut off the other two corners.
        case 5:
          if (centre) out.push([bottom, right], [left, top]);
          else out.push([left, bottom], [right, top]);
          break;
        case 10:
          if (centre) out.push([left, bottom], [right, top]);
          else out.push([bottom, right], [left, top]);
          break;
      }
    }
  }
  return out;
}
