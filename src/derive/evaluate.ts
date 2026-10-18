// Evaluate a statement at one random point. Values are numbers, matrices, or a scaled identity whose size is taken
// from whatever it meets (I − P is n×n because P is). Alongside the value, `evalMag` tracks a first-order rounding
// scale: how large the error in a computed value can be, in units of machine epsilon. A residual is "zero" when it is
// small against that scale, which is what makes Σ(x_i − x̄)(y_i − ȳ)-style cancellation compare correctly.
import type { Equation, Node, Statement } from "./ast";
import { addM, EvalError, eye, frob, inverse, isMat, type Mat, mulM, scaleM, trace, transpose } from "./linalg";
import type { SymbolTable } from "./symbols";

export interface Eye {
  eye: true;
  s: number;
  n?: number;
}
export type Val = number | Mat | Eye;

export interface Env {
  vals: Map<string, Val>;
  data: Map<string, Float64Array>;
  /** Length of the data vectors. */
  n: number;
  /** Current data index inside a sum, else -1. */
  idx: number;
}

const isEye = (v: Val): v is Eye => typeof v === "object" && "eye" in v;

function materialize(e: Eye, size: number): Mat {
  if (e.n !== undefined && e.n !== size) throw new EvalError(`I_${e.n} doesn't match a ${size}-row matrix`);
  return eye(size, e.s);
}

function scalarOf(v: Val): number | undefined {
  if (typeof v === "number") return v;
  if (isMat(v) && v.r === 1 && v.c === 1) return v.d[0]!;
  return undefined;
}

export function add(a: Val, b: Val, sign = 1): Val {
  const sa = scalarOf(a);
  const sb = scalarOf(b);
  if (sa !== undefined && sb !== undefined) return sa + sign * sb;
  // A bare 0 is the zero of any shape, as on either side of a matrix equation (MX − 0 = 0).
  if (b === 0) return a;
  if (a === 0) return scale(b, sign);
  if (isEye(a) && isEye(b)) return { eye: true, s: a.s + sign * b.s, ...(a.n ?? b.n) !== undefined ? { n: a.n ?? b.n } : {} };
  if (isMat(a) && isMat(b)) return addM(a, b, sign);
  if (isEye(a) && isMat(b)) return addM(materialize(a, b.r), b, sign);
  if (isMat(a) && isEye(b)) return addM(a, materialize(b, a.r), sign);
  throw new EvalError("can't add a number and a matrix");
}

export function scale(a: Val, s: number): Val {
  if (typeof a === "number") return a * s;
  if (isEye(a)) return { ...a, s: a.s * s };
  return scaleM(a, s);
}

export function mul(a: Val, b: Val): Val {
  if (typeof a === "number") return scale(b, a);
  if (typeof b === "number") return scale(a, b);
  if (isEye(a)) {
    if (isEye(b)) return { eye: true, s: a.s * b.s, ...(a.n ?? b.n) !== undefined ? { n: a.n ?? b.n } : {} };
    if (a.n !== undefined && a.n !== b.r) throw new EvalError(`can't multiply I_${a.n} by a ${b.r}-row matrix`);
    return scaleM(b, a.s);
  }
  if (isEye(b)) {
    if (b.n !== undefined && b.n !== a.c) throw new EvalError(`can't multiply a ${a.c}-column matrix by I_${b.n}`);
    return scaleM(a, b.s);
  }
  return mulM(a, b);
}

function div(a: Val, b: Val): Val {
  const sb = scalarOf(b);
  if (sb === undefined) throw new EvalError("can't divide by a matrix; multiply by its inverse");
  return scale(a, 1 / sb);
}

function pow(a: Val, b: Val): Val {
  const sb = scalarOf(b);
  if (sb === undefined) throw new EvalError("an exponent must be a number");
  const sa = scalarOf(a);
  if (sa !== undefined) return Math.pow(sa, sb);
  if (isEye(a)) return { ...a, s: Math.pow(a.s, sb) };
  const m = a as Mat;
  if (!Number.isInteger(sb)) throw new EvalError("a matrix power must be a whole number");
  if (m.r !== m.c) throw new EvalError(`a ${m.r}×${m.c} matrix can't be raised to a power`);
  let base = sb < 0 ? inverse(m) : m;
  let out: Mat = eye(m.r);
  for (let k = Math.abs(sb); k > 0; k >>= 1) {
    if (k & 1) out = mulM(out, base);
    if (k > 1) base = mulM(base, base);
  }
  return out;
}

function fn(name: string, a: Val): Val {
  if (name === "trace") {
    if (typeof a === "number") return a;
    if (isEye(a)) {
      if (a.n === undefined) throw new EvalError("write I_n so the trace knows the size");
      return a.s * a.n;
    }
    return trace(a);
  }
  if (name === "inv") return pow(a, -1);
  const x = scalarOf(a);
  if (x === undefined) throw new EvalError(`${name}() of a matrix isn't supported`);
  switch (name) {
    case "ln":
      return Math.log(x);
    case "exp":
      return Math.exp(x);
    case "sqrt":
      return Math.sqrt(x);
    default:
      return Math.abs(x);
  }
}

function tr(a: Val): Val {
  return isMat(a) ? transpose(a) : a;
}

function symbol(key: string, env: Env, table: SymbolTable): Val {
  const s = table.get(key);
  if (s?.kind === "data") {
    if (env.idx < 0) throw new EvalError(`${key}_i used outside a sum`);
    return env.data.get(key)![env.idx]!;
  }
  if (s?.kind === "identity") {
    const n = s.size === undefined ? undefined : env.vals.get(s.size);
    return { eye: true, s: 1, ...(typeof n === "number" ? { n } : {}) };
  }
  if (key === "pi" && !s) return Math.PI;
  if (key === "e" && !s) return Math.E;
  const v = env.vals.get(key);
  if (v === undefined) throw new EvalError(`no value for ${key}`);
  return v;
}

export function evaluate(n: Node, env: Env, table: SymbolTable): Val {
  switch (n.t) {
    case "num":
      return n.v;
    case "sym":
      return symbol(n.key, env, table);
    case "neg":
      return scale(evaluate(n.a, env, table), -1);
    case "add":
      return add(evaluate(n.a, env, table), evaluate(n.b, env, table));
    case "sub":
      return add(evaluate(n.a, env, table), evaluate(n.b, env, table), -1);
    case "mul":
      return mul(evaluate(n.a, env, table), evaluate(n.b, env, table));
    case "div":
      return div(evaluate(n.a, env, table), evaluate(n.b, env, table));
    case "pow":
      return pow(evaluate(n.a, env, table), evaluate(n.b, env, table));
    case "fn":
      return fn(n.fn, evaluate(n.a, env, table));
    case "tr":
      return tr(evaluate(n.a, env, table));
    case "sum": {
      // A sum inside a summand (\sum x_i \sum y_i) runs over its own copy of i, as it would on paper.
      const outer = env.idx;
      let acc: Val = 0;
      try {
        for (env.idx = 0; env.idx < env.n; env.idx++) acc = env.idx === 0 ? evaluate(n.a, env, table) : add(acc, evaluate(n.a, env, table));
      } finally {
        env.idx = outer;
      }
      return acc;
    }
  }
}

/** Size of a value for the rounding scale. */
export function norm(v: Val): number {
  if (typeof v === "number") return Math.abs(v);
  if (isEye(v)) return Math.abs(v.s) * Math.sqrt(v.n ?? 1);
  return frob(v);
}

/** Value plus first-order rounding scale (see the header). */
export function evalMag(n: Node, env: Env, table: SymbolTable): [Val, number] {
  switch (n.t) {
    case "num":
    case "sym": {
      const v = evaluate(n, env, table);
      return [v, norm(v)];
    }
    case "neg": {
      const [a, m] = evalMag(n.a, env, table);
      return [scale(a, -1), m];
    }
    case "add":
    case "sub": {
      const [a, ma] = evalMag(n.a, env, table);
      const [b, mb] = evalMag(n.b, env, table);
      return [add(a, b, n.t === "add" ? 1 : -1), ma + mb];
    }
    case "mul": {
      const [a, ma] = evalMag(n.a, env, table);
      const [b, mb] = evalMag(n.b, env, table);
      return [mul(a, b), ma * mb];
    }
    case "div": {
      const [a, ma] = evalMag(n.a, env, table);
      const [b, mb] = evalMag(n.b, env, table);
      const nb = norm(b);
      // A denominator that is all rounding (Σ(x_i − x̄) comes out near 1e-15) is a division by zero, not a huge number.
      if (nb <= 1e-11 * mb) throw new EvalError("this divides by something that is always 0", "domain");
      return [div(a, b), ma / nb + (norm(a) * mb) / (nb * nb)];
    }
    case "pow": {
      const [a, ma] = evalMag(n.a, env, table);
      const [b, mb] = evalMag(n.b, env, table);
      const v = pow(a, b);
      const sa = scalarOf(a);
      const sb = scalarOf(b);
      if (sa === undefined || sb === undefined) {
        // Matrix inverse: d(A⁻¹) = −A⁻¹ dA A⁻¹.
        const nv = norm(v);
        return [v, sb !== undefined && sb < 0 ? nv * nv * ma : Math.pow(ma, Math.abs(sb ?? 1))];
      }
      const nv = Math.abs(v as number);
      return [v, nv * (Math.abs(sb) * (ma / Math.abs(sa)) + Math.abs(Math.log(Math.abs(sa))) * mb) + nv];
    }
    case "fn": {
      const [a, ma] = evalMag(n.a, env, table);
      const v = fn(n.fn, a);
      const na = norm(a) || 1e-300;
      switch (n.fn) {
        case "ln":
          return [v, ma / na + Math.abs(v as number)];
        case "exp":
          return [v, norm(v) * (1 + ma)];
        case "sqrt":
          return [v, (0.5 * ma) / Math.sqrt(na) + norm(v)];
        case "inv": {
          const nv = norm(v);
          return [v, nv * nv * ma];
        }
        default:
          return [v, ma];
      }
    }
    case "tr": {
      const [a, m] = evalMag(n.a, env, table);
      return [tr(a), m];
    }
    case "sum": {
      const outer = env.idx;
      let acc: Val = 0;
      let m = 0;
      try {
        for (env.idx = 0; env.idx < env.n; env.idx++) {
          const [v, mv] = evalMag(n.a, env, table);
          acc = env.idx === 0 ? v : add(acc, v);
          m += mv;
        }
      } finally {
        env.idx = outer;
      }
      return [acc, m];
    }
  }
}

/** lhs − rhs. A bare 0 on either side of a matrix equation means the zero matrix. */
export function residual(eq: Equation, env: Env, table: SymbolTable): Val {
  return diff(evaluate(eq.l, env, table), evaluate(eq.r, env, table));
}

export function residualMag(eq: Equation, env: Env, table: SymbolTable): [Val, number] {
  const [l, ml] = evalMag(eq.l, env, table);
  const [r, mr] = evalMag(eq.r, env, table);
  return [diff(l, r), ml + mr];
}

export function diff(l: Val, r: Val): Val {
  if (isMat(l) && r === 0) return l;
  if (isMat(r) && l === 0) return scaleM(r, -1);
  if (isMat(l) && typeof r === "number") throw new EvalError("a matrix can't equal a number (only 0)");
  if (isMat(r) && typeof l === "number") throw new EvalError("a matrix can't equal a number (only 0)");
  return add(l, r, -1);
}

export function valueMag(s: Statement, env: Env, table: SymbolTable): [Val, number] {
  return s.t === "eq" ? residualMag(s, env, table) : evalMag(s, env, table);
}

/** Flatten a value to numbers for comparison (an unsized identity can't be compared). */
export function entries(v: Val): { r: number; c: number; d: ArrayLike<number> } {
  if (typeof v === "number") return { r: 1, c: 1, d: [v] };
  if (isEye(v)) {
    if (v.n === undefined) return { r: 1, c: 1, d: [v.s] };
    return eye(v.n, v.s);
  }
  return v;
}
