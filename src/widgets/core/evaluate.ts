// Evaluation helpers on top of expr.ts for the live runtime: values that can't be computed are NaN (drawn as gaps)
// rather than exceptions, and a dragged point can be mapped back to the parameter that moves it.
import { compile, type Scope, withDerived } from "../expr";
import type { Expr, WidgetSpec } from "../spec";

export function value(expr: Expr, scope: Scope): number {
  try {
    const v = compile(expr)(scope);
    return typeof v === "number" ? v : Number(v);
  } catch {
    return NaN;
  }
}

/** Readout values by id. */
export function readoutValues(spec: WidgetSpec, scope: Scope): Scope {
  return Object.fromEntries((spec.readouts ?? []).map((r) => [r.id, value(r.expr, scope)]));
}

/** The value of `param` that puts `expr` (a point coordinate) at `target`, holding the other params fixed.
 *  When the coordinate is the parameter itself this is just `target`; otherwise it brackets a root on a grid over
 *  the parameter's range (nearest to the current value) and bisects, or takes the closest grid value if the
 *  coordinate can't reach the target. */
export function solveParam(spec: WidgetSpec, params: Scope, param: string, expr: Expr, target: number): number | undefined {
  const p = spec.params?.[param];
  if (!p) return undefined;
  if (typeof expr === "string" && expr.trim() === param) return Math.min(p.max, Math.max(p.min, target));
  const g = (v: number) => value(expr, withDerived(spec, { ...params, [param]: v })) - target;
  const N = 32;
  const grid = Array.from({ length: N + 1 }, (_, i) => p.min + ((p.max - p.min) * i) / N);
  const vals = grid.map(g);
  const cur = params[param] ?? p.default;
  let best: [number, number] | null = null;
  for (let i = 0; i < N; i++) {
    const a = vals[i]!;
    const b = vals[i + 1]!;
    if (!Number.isFinite(a) || !Number.isFinite(b) || (Math.sign(a) === Math.sign(b) && a !== 0)) continue;
    const mid = (grid[i]! + grid[i + 1]!) / 2;
    if (!best || Math.abs(mid - cur) < Math.abs((best[0] + best[1]) / 2 - cur)) best = [grid[i]!, grid[i + 1]!];
  }
  if (!best) {
    let k = -1;
    vals.forEach((v, i) => {
      if (Number.isFinite(v) && (k < 0 || Math.abs(v) < Math.abs(vals[k]!))) k = i;
    });
    return k < 0 ? undefined : grid[k];
  }
  let [lo, hi] = best;
  let glo = g(lo);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const gm = g(mid);
    if (Math.sign(gm) === Math.sign(glo)) {
      lo = mid;
      glo = gm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}
