// The few dense-matrix operations the checker needs, on plain Float64Arrays: products of n×K design matrices with
// n ≤ 12 are tiny, so this is faster than going through mathjs and has no dependency.

export interface Mat {
  r: number;
  c: number;
  /** Row-major entries. */
  d: Float64Array;
}

/** A statement that can't be evaluated as written: mismatched shapes, a singular inverse, x_i outside a sum. */
export class EvalError extends Error {
  constructor(
    message: string,
    readonly kind: "shape" | "singular" | "domain" = "shape",
  ) {
    super(message);
    this.name = "EvalError";
  }
}

export const isMat = (v: unknown): v is Mat => typeof v === "object" && v !== null && "d" in v;

export function zeros(r: number, c: number): Mat {
  return { r, c, d: new Float64Array(r * c) };
}

export function eye(n: number, s = 1): Mat {
  const m = zeros(n, n);
  for (let i = 0; i < n; i++) m.d[i * n + i] = s;
  return m;
}

const shape = (a: Mat) => `${a.r}×${a.c}`;

export function addM(a: Mat, b: Mat, sign = 1): Mat {
  if (a.r !== b.r || a.c !== b.c) throw new EvalError(`can't add a ${shape(a)} matrix and a ${shape(b)} matrix`);
  const m = zeros(a.r, a.c);
  for (let i = 0; i < m.d.length; i++) m.d[i] = a.d[i]! + sign * b.d[i]!;
  return m;
}

export function scaleM(a: Mat, s: number): Mat {
  const m = zeros(a.r, a.c);
  for (let i = 0; i < m.d.length; i++) m.d[i] = a.d[i]! * s;
  return m;
}

export function mulM(a: Mat, b: Mat): Mat {
  if (a.c !== b.r) throw new EvalError(`can't multiply a ${shape(a)} matrix by a ${shape(b)} matrix`);
  const m = zeros(a.r, b.c);
  for (let i = 0; i < a.r; i++)
    for (let k = 0; k < a.c; k++) {
      const aik = a.d[i * a.c + k]!;
      if (aik === 0) continue;
      for (let j = 0; j < b.c; j++) m.d[i * b.c + j]! += aik * b.d[k * b.c + j]!;
    }
  return m;
}

export function transpose(a: Mat): Mat {
  const m = zeros(a.c, a.r);
  for (let i = 0; i < a.r; i++) for (let j = 0; j < a.c; j++) m.d[j * a.r + i] = a.d[i * a.c + j]!;
  return m;
}

/** Gauss–Jordan with partial pivoting. A pivot below 1e-10 of the matrix scale counts as singular: X X' for an
 *  n×K X with n > K has rank K, and rounding would otherwise hand back a huge "inverse". */
export function inverse(a: Mat): Mat {
  if (a.r !== a.c) throw new EvalError(`a ${shape(a)} matrix has no inverse`, "shape");
  const n = a.r;
  const w = Float64Array.from(a.d);
  const inv = eye(n).d;
  const scale = Math.max(...Array.from(w, Math.abs), 1e-300);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(w[r * n + col]!) > Math.abs(w[piv * n + col]!)) piv = r;
    const p = w[piv * n + col]!;
    if (Math.abs(p) < 1e-10 * scale) throw new EvalError("the matrix being inverted is singular", "singular");
    if (piv !== col)
      for (let j = 0; j < n; j++) {
        [w[col * n + j], w[piv * n + j]] = [w[piv * n + j]!, w[col * n + j]!];
        [inv[col * n + j], inv[piv * n + j]] = [inv[piv * n + j]!, inv[col * n + j]!];
      }
    for (let j = 0; j < n; j++) {
      w[col * n + j]! /= p;
      inv[j + col * n]! /= p;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = w[r * n + col]!;
      if (f === 0) continue;
      for (let j = 0; j < n; j++) {
        w[r * n + j]! -= f * w[col * n + j]!;
        inv[r * n + j]! -= f * inv[col * n + j]!;
      }
    }
  }
  return { r: n, c: n, d: inv };
}

export function trace(a: Mat): number {
  if (a.r !== a.c) throw new EvalError(`a ${shape(a)} matrix has no trace`);
  let t = 0;
  for (let i = 0; i < a.r; i++) t += a.d[i * a.c + i]!;
  return t;
}

export function frob(a: Mat): number {
  let s = 0;
  for (const v of a.d) s += v * v;
  return Math.sqrt(s);
}

export function isSymmetric(a: Mat, tol = 1e-9): boolean {
  if (a.r !== a.c) return false;
  const scale = frob(a) || 1;
  for (let i = 0; i < a.r; i++) for (let j = i + 1; j < a.c; j++) if (Math.abs(a.d[i * a.c + j]! - a.d[j * a.c + i]!) > tol * scale) return false;
  return true;
}
