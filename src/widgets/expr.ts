// Widget expressions: mathjs syntax restricted to an allow-list, evaluated over params, derived values, the
// x / state variable and dataset columns. `npm run validate` and the widget runtime share this module, so a spec
// that validates is evaluated the same way on screen.
import type { MathNode } from "mathjs";
import type { DistributionSpec } from "./core/types";
import { chartData, chartValue, locate } from "./data-chart/series";
import { numbers, type Table } from "./data/table";
import { type Dist, empirical, FAMILIES, type FamilyParams, parametric } from "./distribution/measures";
import { math, normalFrom, rng } from "./math";
import { AGGREGATES, runSampler, SAMPLER_LIMITS, samplerSize } from "./sampler";
import type { DerivedExpr, Expr, Panel, Rebind, WidgetSpec } from "./spec";
import { BUILTIN_ELEMENTS, BUILTIN_SCALARS, DATA_SUMS, panelMarks, SAMPLER_STATS, samplerSummaries, widgetParts } from "./spec";

export { rng };

/** Standard normal CDF, optionally with mean and standard deviation. */
function normcdf(x: number, mu = 0, sigma = 1): number {
  return 0.5 * (1 + (math.erf as (v: number) => number)((x - mu) / (sigma * Math.SQRT2)));
}

// The seeded draws scatter-fit `generate` may call. They read whichever generator `generate` installs for the
// duration of one data set; outside it they throw, so no other expression can be random.
let source: (() => number) | null = null;
function u(): number {
  if (!source) throw new Error("normal() and uniform() only work in generate");
  return source();
}
const draws = {
  uniform: (a = 0, b = 1) => a + (b - a) * u(),
  normal: (mu = 0, sigma = 1) => normalFrom(u, mu, sigma),
};
math.import({ normcdf, ...draws }, { override: true });

/** Thrown when a value needs a dataset this run has not loaded: the one failure `validate` reports as a note
 *  rather than an error (the widget may be fine; this run just can't tell). */
export class DatasetNotLoaded extends Error {}

export const FUNCTIONS = {
  /** Allowed in every expression. `log` is the natural log (log(x, b) for base b); angles are in radians, and
   *  atan2(y, x) is the angle of the point (x, y). */
  base: ["log", "exp", "sqrt", "abs", "min", "max", "normcdf", "sin", "cos", "atan2"],
  /** Seeded draws, only inside scatter-fit `generate`. */
  generate: ["normal", "uniform"],
  /** Period-on-period growth of an expression, only in path panels' `series`. */
  series: ["growth"],
  /** Reductions across replications, only in a sampler's `summaries`. */
  aggregate: AGGREGATES,
} as const;

/** How many arguments each function takes, [fewest, most]. mathjs only finds a wrong count when it evaluates the
 *  call, and some (normcdf()) quietly give NaN instead. */
const ARITY: Record<string, readonly [number, number]> = {
  log: [1, 2], exp: [1, 1], sqrt: [1, 1], abs: [1, 1], min: [1, Infinity], max: [1, Infinity], normcdf: [1, 3],
  sin: [1, 1], cos: [1, 1], atan2: [2, 2],
  normal: [0, 2], uniform: [0, 2], growth: [1, 1], mean: [1, 1], sd: [1, 1], quantile: [2, 2], share: [1, 1],
};

function arityProblem(name: string, given: number): string | undefined {
  const [lo, hi] = ARITY[name] ?? [0, Infinity];
  if (given >= lo && given <= hi) return undefined;
  const want = lo === hi ? `${lo}` : hi === Infinity ? `at least ${lo}` : `${lo} to ${hi}`;
  return `${name}() takes ${want} argument${want === "1" || want === "at least 1" ? "" : "s"}, not ${given}`;
}

const NODE_TYPES = new Set(["ConstantNode", "SymbolNode", "OperatorNode", "ParenthesisNode", "FunctionNode", "ConditionalNode"]);
const OPERATORS = new Set([
  "add", "subtract", "multiply", "divide", "pow", "mod", "unaryMinus", "unaryPlus",
  "smaller", "larger", "smallerEq", "largerEq", "equal", "unequal", "and", "or", "not",
]);
const CONSTANTS = new Set(["pi", "e"]);

export type Scope = Record<string, number>;

/** Problems with one expression, and the names it reads. */
export function checkExpr(src: Expr, names: Iterable<string>, functions: Iterable<string> = FUNCTIONS.base) {
  const errors: string[] = [];
  const symbols = new Set<string>();
  if (typeof src === "number") return { errors: Number.isFinite(src) ? errors : ["is not a finite number"], symbols };
  let node: MathNode;
  try {
    node = math.parse(src);
  } catch (e) {
    return { errors: [`does not parse: ${(e as Error).message}`], symbols };
  }
  const known = new Set(names);
  const fns = new Set(functions);
  node.traverse((n, path, parent) => {
    if (!NODE_TYPES.has(n.type)) errors.push(`${n.type.replace(/Node$/, "").toLowerCase()} syntax is not allowed`);
    if (n.type === "ConstantNode" && typeof (n as unknown as { value: unknown }).value !== "number") {
      errors.push("only numbers may appear as constants");
    }
    if (n.type === "OperatorNode") {
      const fn = (n as unknown as { fn: string }).fn;
      if (!OPERATORS.has(fn)) errors.push(`operator '${(n as unknown as { op: string }).op}' is not allowed`);
    }
    if (n.type === "FunctionNode") {
      const name = (n as unknown as { fn: { name?: string } }).fn.name ?? "?";
      if (!fns.has(name)) errors.push(`function ${name}() is not allowed here`);
      else {
        const bad = arityProblem(name, (n as unknown as { args: MathNode[] }).args.length);
        if (bad) errors.push(bad);
      }
    } else if (n.type === "SymbolNode" && !(parent?.type === "FunctionNode" && path === "fn")) {
      const name = (n as unknown as { name: string }).name;
      symbols.add(name);
      if (!known.has(name) && !CONSTANTS.has(name)) errors.push(`unknown name '${name}'`);
    }
  });
  return { errors, symbols };
}

const compiled = new Map<string, (scope: Scope) => number>();

/** A checked expression as a function of its scope. */
export function compile(src: Expr): (scope: Scope) => number {
  if (typeof src === "number") return () => src;
  let fn = compiled.get(src);
  if (!fn) {
    const code = math.parse(src).compile();
    fn = (scope: Scope) => Number(code.evaluate({ ...scope }));
    compiled.set(src, fn);
  }
  return fn;
}

export type PanelsSpec = Extract<WidgetSpec, { type: "panels" }>;

export const isRebind = (d: DerivedExpr | undefined): d is Rebind => typeof d === "object" && d !== null;

/** Names a definition reads: an expression's symbols; a rebinding's target and the symbols of its `with` values. */
function defSymbols(d: DerivedExpr): Set<string> {
  if (!isRebind(d)) return checkExpr(d, []).symbols;
  const out = new Set([d.of]);
  for (const e of Object.values(d.with)) for (const x of checkExpr(e, []).symbols) out.add(x);
  return out;
}

// Specs never change once loaded, and every slider move needs the order (withDerived), so it is worked out once.
const orders = new WeakMap<Record<string, DerivedExpr>, { order: string[]; cycle: string[] }>();

/** Derived values (or equations) in evaluation order, each after the values it reads, or the names caught in a cycle.
 *  A rebinding comes after its target and the values its `with` reads, so one that re-evaluates itself is a cycle. */
export function derivedOrder(derived: Record<string, DerivedExpr>): { order: string[]; cycle: string[] } {
  let known = orders.get(derived);
  if (!known) {
    known = orderOf(derived);
    orders.set(derived, known);
  }
  return known;
}

function orderOf(derived: Record<string, DerivedExpr>): { order: string[]; cycle: string[] } {
  const names = Object.keys(derived);
  const syms = new Map(names.map((d) => [d, defSymbols(derived[d]!)]));
  const deps = new Map(names.map((d) => [d, new Set([...syms.get(d)!].filter((s) => s in derived && s !== d))]));
  const self = names.filter((d) => syms.get(d)!.has(d));
  const order: string[] = [];
  let ready = names.filter((d) => deps.get(d)!.size === 0 && !self.includes(d));
  while (ready.length) {
    const d = ready.shift()!;
    order.push(d);
    for (const [k, s] of deps) {
      if (s.delete(d) && s.size === 0 && !order.includes(k) && !self.includes(k)) ready.push(k);
    }
  }
  return { order, cycle: names.filter((d) => !order.includes(d)) };
}

export function defaults(spec: WidgetSpec): Scope {
  return Object.fromEntries(Object.entries(spec.params ?? {}).map(([k, p]) => [k, p.default]));
}

type Fn = (scope: Scope) => number;

/** A spec's definitions compiled once: derived values and equations in order, an evaluator per definition (a
 *  rebinding included), and which equations an expression needs. Only panels specs have equations and rebindings. */
type Model = {
  derived: Record<string, DerivedExpr>;
  equations: Record<string, DerivedExpr>;
  dOrder: string[];
  eOrder: string[];
  /** Model params held at their value (panels `fixed`): in scope everywhere, never sliders. */
  fixed: Scope;
  fn: (d: DerivedExpr) => Fn;
  /** Equations an expression needs, transitively, in evaluation order. */
  needs: (d: DerivedExpr) => string[];
  /** `layer` evaluators, made once per definition. */
  layers: Map<string, Fn>;
  /** Model variables an equation reads, transitively. */
  varsOf: (eq: string) => Set<string>;
};

const NO_DEFS: Record<string, DerivedExpr> = {};
const models = new WeakMap<WidgetSpec, Model>();

function modelOf(spec: WidgetSpec): Model {
  let m = models.get(spec);
  if (m) return m;
  const panels = spec.type === "panels" ? spec : undefined;
  const derived: Record<string, DerivedExpr> = spec.derived ?? NO_DEFS;
  const equations = panels?.equations ?? NO_DEFS;
  const vars = new Set(Object.keys(panels?.vars ?? {}));
  const dOrder = derivedOrder(derived).order;
  const eOrder = derivedOrder(equations).order;
  const fns = new Map<string, Fn>();
  const key = (d: DerivedExpr) => (isRebind(d) ? JSON.stringify(d) : `${typeof d}:${d}`);
  const closure = (start: Iterable<string>): Set<string> => {
    const seen = new Set<string>();
    const stack = [...start];
    while (stack.length) {
      const x = stack.pop()!;
      const d = derived[x] ?? equations[x];
      if (seen.has(x) || d === undefined) continue;
      seen.add(x);
      stack.push(...defSymbols(d));
    }
    return seen;
  };
  const varMemo = new Map<string, Set<string>>();
  const varsOf = (eq: string): Set<string> => {
    let v = varMemo.get(eq);
    if (!v) {
      v = new Set([...closure([eq])].flatMap((x) => [...defSymbols(derived[x] ?? equations[x]!)].filter((s) => vars.has(s))));
      varMemo.set(eq, v);
    }
    return v;
  };
  const needs = (d: DerivedExpr) => {
    const want = closure(defSymbols(d));
    return eOrder.filter((e) => want.has(e));
  };
  const fn = (d: DerivedExpr): Fn => {
    const k = key(d);
    let f = fns.get(k);
    if (!f) {
      f = isRebind(d) ? rebound(d) : compile(d);
      fns.set(k, f);
    }
    return f;
  };
  // A rebinding re-evaluates its target, and only what the target reads, with some params replaced; everything else
  // in scope (variables, t, the state, the other params) stays as it is where the rebinding is evaluated.
  const rebound = (r: Rebind): Fn => {
    const withFns = Object.entries(r.with).map(([p, e]) => [p, compile(e)] as const);
    const want = closure([r.of]);
    const chain = [...dOrder.filter((x) => want.has(x)), ...eOrder.filter((x) => want.has(x))];
    return (scope) => {
      const at: Scope = { ...scope };
      for (const [p, f] of withFns) at[p] = f(scope);
      for (const x of chain) at[x] = fn(derived[x] ?? equations[x]!)(at);
      const v = at[r.of];
      if (v === undefined) throw new Error(`'${r.of}' is not a derived value or equation`);
      return v;
    };
  };
  m = { derived, equations, dOrder, eOrder, fixed: panels?.fixed ?? {}, fn, needs, varsOf, layers: new Map() };
  models.set(spec, m);
  return m;
}

/** Params plus every derived value. A value mathjs rejects at these params (the max of a complex number) is NaN,
 *  drawn as a gap like any other undefined value; `validate` reports it when it happens at a view's starting values. */
export function withDerived(spec: WidgetSpec, params: Scope): Scope {
  const m = modelOf(spec);
  const scope: Scope = { ...m.fixed, ...params };
  for (const d of m.dOrder) {
    try {
      scope[d] = m.fn(m.derived[d]!)(scope);
    } catch {
      scope[d] = NaN;
    }
  }
  return scope;
}

/** An expression (or rebinding) of a panels spec as a function of a scope that already holds the base values and
 *  whatever variables the place binds: the equations it reads are evaluated first. A failure throws. */
export function layer(spec: WidgetSpec, d: DerivedExpr): Fn {
  const m = modelOf(spec);
  const key = isRebind(d) ? JSON.stringify(d) : `${typeof d}:${d}`;
  let made = m.layers.get(key);
  if (!made) {
    const eqs = m.needs(d);
    const f = m.fn(d);
    made = eqs.length
      ? (scope) => {
          const at: Scope = { ...scope };
          for (const e of eqs) at[e] = m.fn(m.equations[e]!)(at);
          return f(at);
        }
      : f;
    m.layers.set(key, made);
  }
  return made;
}

/** `layer`, with failures as NaN (a gap on screen). */
export function layerSafe(spec: WidgetSpec, d: DerivedExpr): Fn {
  const f = layer(spec, d);
  return (scope) => {
    try {
      return f(scope);
    } catch {
      return NaN;
    }
  };
}

/** The base scope with a parameter swept to `v`: what a sweep axis evaluates its curves (and a contour its f) in. */
export function sweptScope(spec: WidgetSpec, params: Scope, param: string, v: number): Scope {
  return withDerived(spec, { ...params, [param]: v });
}

/** The range a swept parameter runs over: the axis' own min/max, else the parameter's slider range. */
export function sweepRange(spec: WidgetSpec, axis: { sweep?: string; min?: number; max?: number }): [number, number] {
  const p = axis.sweep ? spec.params?.[axis.sweep] : undefined;
  return [axis.min ?? p?.min ?? 0, axis.max ?? p?.max ?? 1];
}

/** A time series as functions of the period's scope: `fn` reads the period-on-period growth of each `growth()`
 *  argument from `__growth<i>`, and `inner` computes those arguments. */
function seriesFns(expr: DerivedExpr, spec?: WidgetSpec): { fn: (x: Scope) => number; inner: ((x: Scope) => number)[] } {
  if (typeof expr === "number") return { fn: () => expr, inner: [] };
  if (isRebind(expr)) return { fn: layer(spec!, expr), inner: [] };
  const inner: MathNode[] = [];
  const node = math.parse(expr).transform((n) => {
    if (n.type === "FunctionNode" && (n as unknown as { fn: { name: string } }).fn.name === "growth") {
      inner.push((n as unknown as { args: MathNode[] }).args[0]!);
      return new math.SymbolNode(`__growth${inner.length - 1}`);
    }
    return n;
  });
  const code = node.compile();
  return {
    fn: (x: Scope) => Number(code.evaluate({ ...x })),
    inner: inner.map((a) => {
      const c = a.compile();
      return (x: Scope) => Number(c.evaluate({ ...x }));
    }),
  };
}

type Simulation = { t: number[]; state: number[]; series: Record<string, number[]> };
/** What `simulate` iterates: a panels spec's recurrence and the series of its time panels. */
type Iteration = {
  var: string;
  init: Expr;
  t0?: number;
  periods: number;
  next: DerivedExpr;
  shocks?: { t: number; set: Record<string, number> }[];
  series: { id: string; expr: DerivedExpr }[];
};

/** The series of every time panel of a panels spec, in panel order. */
export function pathSeries(spec: PanelsSpec): (NonNullable<Extract<Panel, { kind: "path" }>["series"]>[number] & { panel: string })[] {
  return spec.panels.flatMap((p) => (p.kind === "path" ? (p.series ?? []).map((s) => ({ ...s, panel: p.id })) : []));
}

function iteration(spec: WidgetSpec): Iteration | null {
  if (spec.type === "panels" && spec.recurrence) return { ...spec.recurrence, series: pathSeries(spec) };
  return null;
}

/** Iterate a recurrence: x_{t+1} = next(x_t), t = t0..t0 + periods, applying shocks at their period. Each period's
 *  scope holds the base values, the state variable, t, and the equations the series and `next` read. */
export function simulate(spec: WidgetSpec, params: Scope): Simulation {
  const it = iteration(spec);
  if (!it) return { t: [], state: [], series: {} };
  const series = it.series.map((s) => ({ id: s.id, ...seriesFns(s.expr, spec) }));
  const m = modelOf(spec);
  const eqs = [...new Set([...it.series.map((s) => s.expr), it.next].flatMap((d) => m.needs(d)))];
  const order = m.eOrder.filter((e) => eqs.includes(e));
  const next = m.fn(it.next);
  let p = { ...params };
  let scope = withDerived(spec, p);
  const v = it.var;
  let x = compile(it.init)(scope);
  const out: Simulation = { t: [], state: [], series: Object.fromEntries(it.series.map((s) => [s.id, [] as number[]])) };
  const prevInner = series.map((s) => s.inner.map(() => NaN));
  const t0 = it.t0 ?? 0;
  for (let t = t0; t <= t0 + it.periods; t++) {
    const shocks = (it.shocks ?? []).filter((s) => s.t === t);
    if (shocks.length) {
      for (const s of shocks) p = { ...p, ...s.set };
      scope = withDerived(spec, p);
    }
    const here: Scope = { ...scope, [v]: x, t };
    for (const e of order) {
      try {
        here[e] = m.fn(m.equations[e]!)(here);
      } catch {
        here[e] = NaN;
      }
    }
    out.t.push(t);
    out.state.push(x);
    series.forEach((s, i) => {
      const g: Scope = {};
      s.inner.forEach((fn, j) => {
        const now = fn(here);
        g[`__growth${j}`] = t === t0 ? NaN : now / prevInner[i]![j]! - 1;
        prevInner[i]![j] = now;
      });
      let y: number;
      try {
        y = s.fn({ ...here, ...g });
      } catch {
        y = NaN;
      }
      out.series[s.id]!.push(y);
    });
    try {
      x = next(here);
    } catch {
      x = NaN;
    }
  }
  return out;
}

/** Runs `f` with normal() and uniform() drawing from `gen`. */
function drawingFrom<T>(gen: () => number, f: () => T): T {
  const outer = source;
  source = gen;
  try {
    return f();
  } finally {
    source = outer;
  }
}

/** Points of a scatter-fit `generate` block: the same seed always gives the same data. */
export function generate(spec: Extract<WidgetSpec, { type: "scatter-fit" }>, params: Scope): { x: number; y: number }[] {
  const g = spec.generate;
  if (!g) return [];
  const fx = compile(g.x);
  const fy = compile(g.y);
  const scope = withDerived(spec, params);
  return drawingFrom(rng(g.seed), () =>
    Array.from({ length: g.n }, () => {
      const x = fx(scope);
      return { x, y: fy({ ...scope, x }) };
    }),
  );
}

/** OLS on (x, y) and the fit of a given line: the scatter-fit built-in scalars. */
export function fitStats(points: { x: number; y: number }[], intercept: number, slope: number) {
  const n = points.length;
  const xbar = points.reduce((s, p) => s + p.x, 0) / n;
  const ybar = points.reduce((s, p) => s + p.y, 0) / n;
  const sxx = points.reduce((s, p) => s + (p.x - xbar) ** 2, 0);
  const sxy = points.reduce((s, p) => s + (p.x - xbar) * (p.y - ybar), 0);
  const slope_ols = sxy / sxx;
  const intercept_ols = ybar - slope_ols * xbar;
  const ssrOf = (a: number, b: number) => points.reduce((s, p) => s + (p.y - a - b * p.x) ** 2, 0);
  const sst = points.reduce((s, p) => s + (p.y - ybar) ** 2, 0);
  const ssr = ssrOf(intercept, slope);
  const sum = (f: (p: { x: number; y: number }) => number) => points.reduce((s, p) => s + f(p), 0);
  return {
    n, xbar, ybar, slope_ols, intercept_ols, ssr, ssr_min: ssrOf(intercept_ols, slope_ols), r2: 1 - ssr / sst,
    sum_x: n * xbar, sum_y: n * ybar, sum_xx: sum((p) => p.x * p.x), sum_xy: sum((p) => p.x * p.y), sum_yy: sum((p) => p.y * p.y),
  };
}

/** A distribution widget's `dist` expressions evaluated at `scope`, with the family's defaults for what's omitted. */
export function familyParams(spec: DistributionSpec, scope: Scope): FamilyParams {
  const out: FamilyParams = { ...(spec.family ? FAMILIES[spec.family].defaults : {}) };
  for (const [k, e] of Object.entries(spec.dist ?? {})) out[k as keyof FamilyParams] = compile(e)(scope);
  return out;
}

/** The distribution a widget describes: its family at `scope`, or the dataset column (weighted) in `table`. */
export function distributionOf(spec: DistributionSpec, scope: Scope, table?: Table): Dist {
  if (spec.family) return parametric(spec.family, familyParams(spec, scope));
  if (!table) throw new DatasetNotLoaded(`dataset '${spec.dataset}' is not loaded`);
  return empirical(numbers(table, spec.column!), spec.weight ? numbers(table, spec.weight) : undefined);
}

/** Looks a dataset up by id (`npm run validate` reads them from the export directory). */
export type DataLookup = (dataset: string) => Table | undefined;

/** Problems only the data can show: a column the widget names that the dataset lacks, a filter that matches no rows. */
function dataProblems(spec: WidgetSpec, table: Table): string[] {
  const missing = (cols: (string | undefined)[]) =>
    cols.filter((c): c is string => c !== undefined && !table.col[c]).map((c) => `column '${c}' is not in the dataset (columns: ${table.columns.join(", ")})`);
  switch (spec.type) {
    case "data-chart": {
      try {
        const cd = chartData(spec, table);
        const errs = cd.series.filter((s) => !s.points.length).map((s) => `series '${s.id}' has no data (its filter matches no rows, or '${s.column}' is empty there)`);
        for (const a of spec.annotations ?? []) {
          if (cd.kind === "band" && locate(cd, a.x) === undefined) errs.push(`annotations.${a.id}: x '${a.x}' is not one of the x values (${cd.bands.join(", ")})`);
        }
        return errs;
      } catch (e) {
        return [(e as Error).message];
      }
    }
    case "distribution": {
      const errs = missing([spec.column, spec.weight]);
      if (!errs.length && spec.column && !table.col[spec.column]!.some((c) => typeof c === "number")) errs.push(`column '${spec.column}' has no numbers`);
      return errs;
    }
    case "scatter-fit":
      return missing([spec.x.column, spec.y.column]);
    default:
      return [];
  }
}

/** Names each part of a spec may read, and the functions it may call. Derived values read params and each other only:
 *  the runtime works them out from the sliders first, before the fit or the measures exist, so the built-in scalars
 *  are for readouts, goals and tests. */
export function scopes(spec: WidgetSpec) {
  const { params, scalars } = widgetParts(spec);
  const derived = Object.keys(spec.derived ?? {});
  const fixed = spec.type === "panels" ? Object.keys(spec.fixed ?? {}) : [];
  const base = [...params, ...fixed, ...derived];
  const builtins = scalars.filter((s) => !derived.includes(s) && !(spec.readouts ?? []).some((r) => r.id === s));
  return { base, builtins, goal: [...base, ...scalars] };
}

export type CheckOptions = {
  /** Recompute each `tests` entry (default true). The player passes false: `npm run validate` has already run them,
   *  and a scatter-fit's would hold up the widget's first render. */
  tests?: boolean;
};

/** Semantic problems in a widget spec: expressions, names, derived cycles, every expression evaluated once at the
 *  defaults, and each `tests` entry recomputed. With `data`, dataset-backed widgets are also checked against their
 *  dataset and their tests run on it; without it those tests are reported as not run (a note). Any other failure
 *  is an error. */
export function checkWidget(spec: WidgetSpec, data?: DataLookup, { tests = true }: CheckOptions = {}): { errors: string[]; notes: string[] } {
  const errors: string[] = [];
  const notes: string[] = [];
  const { base, builtins } = scopes(spec);
  const expr = (where: string, src: Expr | undefined, names: string[], fns: readonly string[] = FUNCTIONS.base) => {
    if (src === undefined) return;
    for (const e of checkExpr(src, names, fns).errors) errors.push(`${where}: ${e}`);
  };
  const derived = spec.derived ?? {};
  if (spec.type !== "panels") for (const [d, src] of Object.entries(derived)) expr(`derived.${d}`, src as Expr, base);
  const { cycle } = derivedOrder(derived);
  if (cycle.length) errors.push(`derived values depend on each other in a cycle: ${cycle.join(", ")}`);
  for (const r of spec.readouts ?? []) expr(`readouts.${r.id}`, r.expr, [...base, ...builtins]);

  switch (spec.type) {
    case "panels":
      errors.push(...panelsProblems(spec, base));
      break;
    case "scatter-fit":
      if (spec.generate) {
        expr("generate.x", spec.generate.x, base, [...FUNCTIONS.base, ...FUNCTIONS.generate]);
        expr("generate.y", spec.generate.y, [...base, "x"], [...FUNCTIONS.base, ...FUNCTIONS.generate]);
      }
      errors.push(...fitPanelProblems(spec, base, builtins));
      break;
    case "distribution": {
      for (const [k, v] of Object.entries(spec.dist ?? {})) expr(`dist.${k}`, v, base);
      if (spec.family) {
        const { required, defaults } = FAMILIES[spec.family];
        const takes = [...required, ...Object.keys(defaults)];
        for (const k of Object.keys(spec.dist ?? {})) if (!takes.includes(k)) errors.push(`dist.${k}: a ${spec.family} takes ${takes.join(", ")}`);
        for (const k of required) if (spec.dist?.[k as keyof typeof spec.dist] === undefined) errors.push(`dist.${k}: a ${spec.family} needs it`);
        if (spec.column !== undefined || spec.weight !== undefined) errors.push("column and weight read a dataset; a family has none");
      } else if (spec.dist) errors.push("dist gives a family's parameters; a dataset has none");
      if (spec.dataset === undefined && spec.weight !== undefined) errors.push("weight needs a dataset");
      break;
    }
  }
  const table = tableOf(spec, data);
  if (table) errors.push(...dataProblems(spec, table));
  if (errors.length) return { errors, notes };
  // Names and syntax pass; evaluation finds the rest (a value mathjs rejects), which on screen is an error card.
  errors.push(...evaluated(spec, defaults(spec), table).problems);
  if (errors.length || !tests) return { errors, notes };

  (spec.tests ?? []).forEach((test, i) => {
    const params = { ...defaults(spec), ...test.params };
    const tol = test.tol ?? 1e-6;
    const keys = Object.keys(test.expect);
    const badKeys = spec.type === "panels" ? keys.flatMap((k) => periodKeyProblems(spec, k)) : [];
    if (badKeys.length) {
      errors.push(...badKeys.map((e) => `tests[${i}]: ${e}`));
      return;
    }
    let values: Record<string, number>;
    try {
      values = actuals(spec, params, keys, table, test.at);
    } catch (e) {
      if (e instanceof DatasetNotLoaded) notes.push(`tests[${i}] not run: ${e.message}`);
      else errors.push(`tests[${i}]: ${(e as Error).message}`);
      return;
    }
    for (const [k, want] of Object.entries(test.expect)) {
      const got = values[k];
      if (got === undefined || !Number.isFinite(got)) errors.push(`tests[${i}]: ${k} is ${got} (expected ${want})`);
      else if (Math.abs(got - want) > tol) errors.push(`tests[${i}]: ${k} = ${round(got)}, expected ${want} ± ${tol}`);
    }
  });
  return { errors, notes };
}

/** What `validate` needs to know about a view (an ```interactive block) of a widget. */
export type ViewCheck = { state?: Record<string, number>; goal?: { when: string } };

/** Problems with one view that only evaluation shows, at the values the view starts from (its presets, the defaults
 *  for the rest; Reset returns there too): an expression that fails there, a goal that fails there, and a goal that
 *  already holds there, which the learner's first nudge would meet without them doing anything. Run it once
 *  checkWidget and the static goal check have passed. */
export function checkView(spec: WidgetSpec, view: ViewCheck, data?: DataLookup): string[] {
  const table = tableOf(spec, data);
  const start = evaluated(spec, { ...defaults(spec), ...view.state }, table);
  const errors: string[] = [];
  if (view.state) {
    const atDefaults = new Set(evaluated(spec, defaults(spec), table).problems);
    errors.push(...start.problems.filter((p) => !atDefaults.has(p)).map((p) => `at the view's starting values, ${p}`));
  }
  if (view.goal && start.complete) {
    try {
      if (compile(view.goal.when)(start.scope)) {
        errors.push("goal.when already holds at the view's starting values, so the learner's first nudge would meet it; start the view (state) where it does not");
      }
    } catch (e) {
      errors.push(`goal.when: ${(e as Error).message}`);
    }
  }
  return errors;
}

function tableOf(spec: WidgetSpec, data?: DataLookup): Table | undefined {
  const dataset = "dataset" in spec ? spec.dataset : undefined;
  return dataset !== undefined ? data?.(dataset) : undefined;
}

function need(spec: WidgetSpec, table?: Table): Table {
  if (!table) throw new DatasetNotLoaded(`needs dataset '${"dataset" in spec ? spec.dataset : "?"}', which this run did not load`);
  return table;
}

/** The scatter-fit fit statistics or the distribution measures, at `params` and their derived values `scope`. */
function builtinScalars(spec: WidgetSpec, params: Scope, scope: Scope, table?: Table): Scope {
  if (spec.type === "scatter-fit") {
    let points: { x: number; y: number }[];
    if (spec.generate) points = generate(spec, params);
    else {
      const t = need(spec, table);
      const xs = numbers(t, spec.x.column!);
      const ys = numbers(t, spec.y.column!);
      points = xs.flatMap((x, i) => (x !== null && ys[i] !== null ? [{ x, y: ys[i]! }] : []));
    }
    return fitStats(points, scope[spec.line.intercept]!, scope[spec.line.slope]!);
  }
  if (spec.type === "distribution") return distributionOf(spec, scope, spec.dataset !== undefined ? need(spec, table) : undefined).measures;
  return {};
}

/** Every expression of a spec evaluated once at `params`, and the scope a goal reads there (params, derived values,
 *  built-in scalars, readouts). The static check settles names and syntax; this finds what only evaluation can, such
 *  as a value mathjs rejects (the max of a complex number). What needs a dataset `table` lacks is skipped, and
 *  `complete` is then false. */
function evaluated(spec: WidgetSpec, params: Scope, table?: Table): { problems: string[]; scope: Scope; complete: boolean } {
  const problems: string[] = [];
  let complete = true;
  const run = (where: string, f: () => number): number => {
    try {
      return f();
    } catch (e) {
      if (e instanceof DatasetNotLoaded) complete = false;
      else problems.push(`${where}: ${(e as Error).message}`);
      return NaN;
    }
  };
  const at = (where: string, src: Expr | undefined, scope: Scope) => (src === undefined ? NaN : run(where, () => compile(src)(scope)));
  const m = modelOf(spec);
  const scope: Scope = { ...m.fixed, ...params };
  for (const d of m.dOrder) scope[d] = run(`derived.${d}`, () => m.fn(m.derived[d]!)(scope));
  const before = problems.length;
  switch (spec.type) {
    case "panels":
      evaluatePanels(spec, params, scope, run);
      break;
    case "scatter-fit": {
      const g = spec.generate;
      if (g) drawingFrom(rng(g.seed), () => at("generate.y", g.y, { ...scope, x: at("generate.x", g.x, scope) }));
      break;
    }
    case "distribution":
      for (const [k, v] of Object.entries(spec.dist ?? {})) at(`dist.${k}`, v, scope);
      break;
  }
  for (const s of [...(BUILTIN_SCALARS[spec.type] ?? []), ...samplerSummaries(spec)]) if (!(s in scope)) scope[s] = NaN;
  if (problems.length === before) {
    try {
      Object.assign(scope, builtinScalars(spec, params, scope, table));
    } catch (e) {
      if (e instanceof DatasetNotLoaded) complete = false;
      else problems.push(`${spec.type === "distribution" ? "dist" : "generate"}: ${(e as Error).message}`);
    }
  }
  for (const r of spec.readouts ?? []) scope[r.id] = at(`readouts.${r.id}`, r.expr, scope);
  if (spec.type === "scatter-fit" && problems.length === before) {
    spec.panels?.forEach((p, i) => {
      at(`panels[${i}].f`, p.f, scope);
      p.levels?.forEach((l, j) => at(`panels[${i}].levels[${j}]`, l, scope));
      for (const pt of p.points ?? []) for (const k of ["x", "y"] as const) at(`panels[${i}].points.${pt.id}.${k}`, pt[k], scope);
    });
  }
  return { problems, scope, complete };
}

/** Builtins of a scatter-fit that do not move with the line, so a contour sweeping its parameters may read them. */
const FIT_DATA_SCALARS = ["n", "xbar", "ybar", "slope_ols", "intercept_ols", "ssr_min", ...DATA_SUMS];

/** A scatter-fit's contour panels: each axis sweeps a parameter (there are no model variables), and f, evaluated at
 *  every grid point with the parameters swept, reads only what does not move with them (b0-model-view.md §1.4). */
function fitPanelProblems(spec: Extract<WidgetSpec, { type: "scatter-fit" }>, base: string[], builtins: string[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>([...(BUILTIN_ELEMENTS_OF(spec)), ...(spec.readouts ?? []).map((r) => r.id)]);
  const check = (where: string, src: Expr | undefined, names: string[]) => {
    if (src === undefined) return;
    for (const e of checkExpr(src, names).errors) errors.push(`${where}: ${e}`);
  };
  (spec.panels ?? []).forEach((p, i) => {
    const where = `panels[${i}]`;
    for (const id of [p.id, ...panelMarks(p)]) {
      if (seen.has(id)) errors.push(`${where}: id '${id}' is already an element of this widget`);
      seen.add(id);
    }
    for (const k of ["x", "y"] as const) {
      const a = p[k];
      if (a.var !== undefined) errors.push(`${where}.${k}: a scatter-fit has no model variables; sweep a parameter (${k}: {sweep: <param>})`);
      else if (!(a.sweep! in (spec.params ?? {}))) errors.push(`${where}.${k}.sweep '${a.sweep}' is not a parameter`);
    }
    check(`${where}.f`, p.f, [...base, ...FIT_DATA_SCALARS]);
    p.levels?.forEach((l, j) => check(`${where}.levels[${j}]`, l, [...base, ...builtins]));
    for (const pt of p.points ?? []) {
      for (const k of ["x", "y"] as const) check(`${where}.points.${pt.id}.${k}`, pt[k], [...base, ...builtins]);
      for (const v of Object.values(pt.drag ?? {})) if (!(v in (spec.params ?? {}))) errors.push(`${where}.points.${pt.id}.drag: '${v}' is not a parameter`);
    }
    for (const l of p.lines ?? []) for (const e of [l.x, l.y, ...(l.from ?? []), ...(l.to ?? [])]) check(`${where}.lines.${l.id}`, e, [...base, ...builtins]);
    for (const a of p.arrows ?? []) for (const e of [...a.from, ...a.to]) check(`${where}.arrows.${a.id}`, e, [...base, ...builtins]);
  });
  return errors;
}

const BUILTIN_ELEMENTS_OF = (spec: WidgetSpec) => BUILTIN_ELEMENTS[spec.type] ?? [];

/** A `tests` key `id@t`: a time series' value in period t, counted as the notes count (from recurrence.t0, which may
 *  be negative). The forms match what vault_tool.py accepts, `k@-3` and `k@10.0` among them. */
const PERIOD_KEY = /^(\w+)@(-?\d+(?:\.\d+)?)$/;

function periodKeyProblems(spec: WidgetSpec, k: string): string[] {
  if (!k.includes("@")) return [];
  const m = PERIOD_KEY.exec(k);
  const it = iteration(spec);
  // A panels spec also takes '<curve>@<x>': a curve's value at x (a variable's value, or the swept parameter's).
  if (m && spec.type === "panels" && curveMark(spec, m[1]!)) return [];
  const t = m ? Number(m[2]) : NaN;
  if (!m || !Number.isInteger(t)) return [`'${k}' must name a series and a whole period, as id@t${spec.type === "panels" ? ", or a curve and an x value, as id@x" : ""}`];
  if (!it?.series.some((s) => s.id === m[1])) return [`'${k}': there is no series '${m[1]}'`];
  const first = it.t0 ?? 0;
  if (t < first || t > first + it.periods) return [`'${k}': period ${t} is outside ${first}..${first + it.periods}`];
  return [];
}

function curveMark(spec: PanelsSpec, id: string) {
  for (const p of spec.panels) {
    if (p.kind !== "curve") continue;
    const c = p.curves.find((x) => x.id === id);
    if (c) return { panel: p, curve: c };
  }
  return undefined;
}

function actuals(spec: WidgetSpec, params: Scope, keys: string[], table?: Table, at?: Scope): Record<string, number> {
  let scope = withDerived(spec, params);
  scope = { ...scope, ...builtinScalars(spec, params, scope, table), ...samplerRuns(spec, scope).summaries };
  if (at && spec.type === "panels") {
    // `at` binds model variables, so the equations that read only those can be checked.
    const m = modelOf(spec);
    const bound = new Set(Object.keys(at));
    scope = { ...scope, ...at };
    for (const e of m.eOrder) if ([...m.varsOf(e)].every((v) => bound.has(v))) scope[e] = m.fn(m.equations[e]!)(scope);
  }
  const extra: Record<string, number> = {};
  if (spec.type === "data-chart") {
    const asks = keys.filter((k) => !(k in scope) && !(spec.readouts ?? []).some((r) => r.id === k));
    if (asks.length) {
      const cd = chartData(spec, need(spec, table));
      for (const k of asks) {
        const v = chartValue(cd, k);
        if (v !== undefined) extra[k] = v;
      }
    }
  }
  const out: Record<string, number> = { ...scope, ...extra };
  for (const r of spec.readouts ?? []) out[r.id] = compile(r.expr)(scope);
  const it = iteration(spec);
  if (it && keys.some((k) => k.includes("@"))) {
    const sim = simulate(spec, params);
    for (const k of keys) {
      const m = PERIOD_KEY.exec(k);
      if (m && m[1]! in sim.series) out[k] = sim.series[m[1]!]![Number(m[2]) - (it.t0 ?? 0)] ?? NaN;
    }
  }
  if (spec.type === "panels") {
    for (const k of keys) {
      const m = PERIOD_KEY.exec(k);
      const found = m ? curveMark(spec, m[1]!) : undefined;
      if (found) out[k] = curveAt(spec, found.panel, found.curve.expr, params, scope, Number(m![2]));
    }
  }
  return out;
}

/** A curve's value at x: with the axis' variable bound to x, or with the swept parameter set to x. */
export function curveAt(spec: PanelsSpec, panel: Extract<Panel, { kind: "curve" }>, d: DerivedExpr, params: Scope, scope: Scope, x: number): number {
  const f = layer(spec, d);
  if (panel.x.sweep) return f(sweptScope(spec, params, panel.x.sweep, x));
  return f({ ...scope, [panel.x.var!]: x });
}

/** Every sampler panel run at `scope` (base values): their summaries by name, and each run by panel id. A run that
 *  fails throws. */
export function samplerRuns(spec: WidgetSpec, scope: Scope, redraw = 0) {
  const runs: Record<string, ReturnType<typeof runSampler>> = {};
  const summaries: Scope = {};
  if (spec.type !== "panels") return { runs, summaries };
  for (const p of spec.panels) {
    if (p.kind !== "sampler") continue;
    runs[p.id] = runSampler(p, scope, redraw);
    Object.assign(summaries, runs[p.id]!.summaries);
  }
  return { runs, summaries };
}

// ---------------------------------------------------------------- panels: names in scope, evaluation once

/** Static problems of a panels spec beyond derived values and readouts (scopes per place, b0-model-view.md §1.4). */
function panelsProblems(spec: PanelsSpec, base: string[]): string[] {
  const errors: string[] = [];
  const m = modelOf(spec);
  const vars = Object.keys(spec.vars ?? {});
  const derived = Object.keys(spec.derived ?? {});
  const eqNames = Object.keys(spec.equations ?? {});
  const paramish = [...Object.keys(spec.params ?? {}), ...Object.keys(spec.fixed ?? {})];
  const expr = (where: string, src: Expr | undefined, names: string[], fns: readonly string[] = FUNCTIONS.base) => {
    if (src === undefined) return;
    for (const e of checkExpr(src, names, fns).errors) errors.push(`${where}: ${e}`);
  };
  /** An expression or a rebinding, read in `names`; a rebinding may target `targets`. */
  const def = (where: string, d: DerivedExpr, names: string[], targets: string[], fns: readonly string[] = FUNCTIONS.base) => {
    if (!isRebind(d)) return expr(where, d, names, fns);
    if (!targets.includes(d.of)) errors.push(`${where}: rebinding 'of: ${d.of}' must name ${targets === derived ? "a derived value" : "a derived value or equation"}`);
    for (const [k, e] of Object.entries(d.with)) {
      if (!paramish.includes(k)) errors.push(`${where}.with: '${k}' is not a parameter of the model`);
      expr(`${where}.with.${k}`, e, names);
    }
  };
  /** Equations an expression may read where `bound` variables are bound. */
  const eqsFor = (bound: string[]) => eqNames.filter((e) => [...m.varsOf(e)].every((v) => bound.includes(v)));

  for (const n of [...vars, ...eqNames]) {
    if ([...paramish, ...derived].includes(n)) errors.push(`'${n}' is ${vars.includes(n) ? "a variable" : "an equation"} and also a parameter or derived value`);
  }
  for (const [d, src] of Object.entries(spec.derived ?? {})) def(`derived.${d}`, src, base, derived);
  for (const [e, src] of Object.entries(spec.equations ?? {})) def(`equations.${e}`, src, [...base, ...vars, ...eqNames], [...derived, ...eqNames]);
  const ecycle = derivedOrder(spec.equations ?? {}).cycle;
  if (ecycle.length) errors.push(`equations depend on each other in a cycle: ${ecycle.join(", ")}`);

  const rec = spec.recurrence;
  if (rec) {
    if ([...paramish, ...derived, ...eqNames].includes(rec.var)) errors.push(`recurrence.var '${rec.var}' clashes with a parameter, derived value or equation`);
    expr("recurrence.init", rec.init, base);
    def("recurrence.next", rec.next, [...base, rec.var, "t", ...eqsFor([rec.var])], [...derived, ...eqNames]);
    const first = rec.t0 ?? 0;
    for (const sh of rec.shocks ?? []) {
      if (sh.t < first || sh.t > first + rec.periods) errors.push(`recurrence.shocks: t=${sh.t} is outside periods ${first}..${first + rec.periods}`);
      for (const k of Object.keys(sh.set)) if (!(k in (spec.params ?? {}))) errors.push(`recurrence.shocks: '${k}' is not a parameter`);
    }
  }

  const seen = new Set<string>();
  // Marks are drawn at the current values, so they may read the samplers' summaries as well.
  const summaries = samplerSummaries(spec);
  const markNames = [...base, ...summaries];
  const marks = (where: string, p: { points?: { id: string; x: Expr; y: Expr }[]; lines?: { id: string; x?: Expr; y?: Expr; from?: [Expr, Expr]; to?: [Expr, Expr] }[]; arrows?: { id: string; from: [Expr, Expr]; to: [Expr, Expr] }[] }) => {
    for (const pt of p.points ?? []) (["x", "y"] as const).forEach((k) => expr(`${where}.points.${pt.id}.${k}`, pt[k], markNames));
    for (const l of p.lines ?? []) {
      expr(`${where}.lines.${l.id}.x`, l.x, markNames);
      expr(`${where}.lines.${l.id}.y`, l.y, markNames);
      [...(l.from ?? []), ...(l.to ?? [])].forEach((e, i) => expr(`${where}.lines.${l.id}[${i}]`, e, markNames));
    }
    for (const a of p.arrows ?? []) [...a.from, ...a.to].forEach((e, i) => expr(`${where}.arrows.${a.id}[${i}]`, e, markNames));
  };
  for (const x of summaries.filter((x, i) => summaries.indexOf(x) !== i || base.includes(x) || (spec.readouts ?? []).some((r) => r.id === x))) {
    errors.push(`summary '${x}' is defined twice, or shares its name with a parameter, derived value or readout`);
  }
  const axis = (where: string, a: { var?: string; sweep?: string }) => {
    if (a.var !== undefined && !vars.includes(a.var)) errors.push(`${where}.var '${a.var}' is not a variable of the model (vars: ${vars.join(", ") || "none"})`);
    if (a.sweep !== undefined && !(a.sweep in (spec.params ?? {}))) errors.push(`${where}.sweep '${a.sweep}' is not a slider of the view`);
  };
  spec.panels.forEach((p, i) => {
    const where = `panels[${i}]`;
    for (const id of [p.id, ...panelMarks(p)]) {
      if (seen.has(id)) errors.push(`${where}: id '${id}' is used twice in the view`);
      seen.add(id);
    }
    switch (p.kind) {
      case "curve": {
        axis(`${where}.x`, p.x);
        const bound = p.x.var ? [p.x.var] : [];
        const names = [...base, ...bound, ...eqsFor(bound)];
        for (const c of p.curves) {
          def(`${where}.curves.${c.id}`, c.expr, names, [...derived, ...eqNames]);
          c.domain?.forEach((d, j) => expr(`${where}.curves.${c.id}.domain[${j}]`, d, base));
          if (c.mark && !p.x.sweep) errors.push(`${where}.curves.${c.id}.mark needs a sweep axis (x: {sweep: <param>})`);
        }
        const curves = p.curves.map((c) => c.id);
        for (const r of p.regions ?? []) {
          if (r.between.some((b) => b !== "axis" && !curves.includes(b))) errors.push(`${where}.regions.${r.id}.between must name two curves of this panel (or a curve and 'axis')`);
          expr(`${where}.regions.${r.id}.from`, r.from, base);
          expr(`${where}.regions.${r.id}.to`, r.to, base);
        }
        for (const pt of p.points ?? []) {
          for (const v of Object.values(pt.drag ?? {})) if (!(v in (spec.params ?? {}))) errors.push(`${where}.points.${pt.id}.drag: '${v}' is not a slider of the view`);
        }
        marks(where, p);
        break;
      }
      case "path": {
        if (!rec) errors.push(`${where}: a path panel needs the view's recurrence`);
        const names = rec ? [...base, rec.var, "t", ...eqsFor([rec.var])] : base;
        for (const sr of p.series ?? []) def(`${where}.series.${sr.id}`, sr.expr, names, [...derived, ...eqNames], [...FUNCTIONS.base, ...FUNCTIONS.series]);
        break;
      }
      case "contour": {
        axis(`${where}.x`, p.x);
        axis(`${where}.y`, p.y);
        const bound = [p.x.var, p.y.var].filter((v): v is string => v !== undefined);
        expr(`${where}.f`, p.f, [...base, ...bound, ...eqsFor(bound)]);
        p.levels?.forEach((l, j) => expr(`${where}.levels[${j}]`, l, base));
        marks(where, p);
        break;
      }
      case "vector":
        marks(where, p);
        break;
      case "sampler":
        errors.push(...samplerChecks(spec, p, where, base, markNames, expr));
        marks(where, p);
        break;
    }
  });
  return errors;
}

/** A sampler's expressions read in their own scopes: columns the base values and earlier columns (with the seeded
 *  draws), summaries the per-replication statistics and earlier summaries (with the reductions). Its size is checked
 *  where the sliders make it largest. */
function samplerChecks(
  spec: PanelsSpec,
  p: Extract<Panel, { kind: "sampler" }>,
  where: string,
  base: string[],
  markNames: string[],
  expr: (where: string, src: Expr | undefined, names: string[], fns?: readonly string[]) => void,
): string[] {
  const errors: string[] = [];
  expr(`${where}.reps`, p.reps, base);
  expr(`${where}.rows`, p.rows, base);
  const cols: string[] = [];
  for (const [id, e] of Object.entries(p.columns)) {
    if (base.includes(id) || (SAMPLER_STATS as readonly string[]).includes(id)) errors.push(`${where}.columns.${id}: the name is already a parameter, derived value or statistic`);
    expr(`${where}.columns.${id}`, e, [...base, ...cols], [...FUNCTIONS.base, ...FUNCTIONS.generate]);
    cols.push(id);
  }
  for (const k of ["x", "y"] as const) if (!cols.includes(p.fit[k])) errors.push(`${where}.fit.${k} '${p.fit[k]}' is not one of the columns (${cols.join(", ")})`);
  const done: string[] = [];
  for (const [id, e] of Object.entries(p.summaries ?? {})) {
    expr(`${where}.summaries.${id}`, e, [...base, ...SAMPLER_STATS, ...done], [...FUNCTIONS.base, ...FUNCTIONS.aggregate]);
    done.push(id);
  }
  if (!(p.x.min < p.x.max)) errors.push(`${where}.x: min must be below max`);
  for (const d of p.densities ?? []) for (const k of ["mean", "sd"] as const) expr(`${where}.densities.${d.id}.${k}`, d[k], markNames);
  if (errors.length) return errors;
  // Reps and rows at the sliders' maxima (and minima, for an expression that falls as a slider rises).
  for (const end of ["max", "min"] as const) {
    const params = Object.fromEntries(Object.entries(spec.params ?? {}).map(([k, x]) => [k, x[end]]));
    try {
      const sc = withDerived(spec, params);
      const want = (e: Expr) => compile(e)(sc);
      const [reps, rows] = [want(p.reps), want(p.rows)];
      const { reps: r, rows: n } = samplerSize(p, sc);
      if (r < Math.round(reps) || n < Math.round(rows)) {
        errors.push(`${where}: at every slider's ${end}imum it asks for ${Math.round(reps)} replications of ${Math.round(rows)} rows, more than a redraw can afford (at most ${SAMPLER_LIMITS.reps} replications, ${SAMPLER_LIMITS.rows} rows, ${SAMPLER_LIMITS.cells.toLocaleString("en-US")} rows in all); lower the sliders' ranges`);
      }
    } catch (e) {
      errors.push(`${where}: reps or rows fail at the sliders' ${end}ima (${(e as Error).message})`);
    }
  }
  return errors;
}

/** Every panels expression evaluated once, at the middle of its axes: what only evaluation can find. */
function evaluatePanels(spec: PanelsSpec, params: Scope, scope: Scope, run: (where: string, f: () => number) => number) {
  const m = modelOf(spec);
  const at = (where: string, d: DerivedExpr | undefined, sc: Scope) => (d === undefined ? NaN : run(where, () => layer(spec, d)(sc)));
  const marks = (where: string, p: { points?: { id: string; x: Expr; y: Expr }[]; lines?: { id: string; x?: Expr; y?: Expr; from?: [Expr, Expr]; to?: [Expr, Expr] }[]; arrows?: { id: string; from: [Expr, Expr]; to: [Expr, Expr] }[] }) => {
    for (const pt of p.points ?? []) for (const k of ["x", "y"] as const) at(`${where}.points.${pt.id}.${k}`, pt[k], scope);
    for (const l of p.lines ?? []) {
      at(`${where}.lines.${l.id}.x`, l.x, scope);
      at(`${where}.lines.${l.id}.y`, l.y, scope);
      [...(l.from ?? []), ...(l.to ?? [])].forEach((e, i) => at(`${where}.lines.${l.id}[${i}]`, e, scope));
    }
    for (const a of p.arrows ?? []) [...a.from, ...a.to].forEach((e, i) => at(`${where}.arrows.${a.id}[${i}]`, e, scope));
  };
  const mid = (a: { var?: string; sweep?: string; min?: number; max?: number }): number => {
    const [lo, hi] = a.sweep ? sweepRange(spec, a) : [a.min ?? 0, a.max ?? 1];
    return (lo + hi) / 2;
  };
  // Summaries first: marks on any panel may read them, as readouts and goals do.
  const base: Scope = { ...scope };
  spec.panels.forEach((p, i) => {
    if (p.kind !== "sampler") return;
    run(`panels[${i}]`, () => {
      Object.assign(scope, runSampler(p, base).summaries);
      return 0;
    });
  });
  const rec = spec.recurrence;
  if (rec) {
    const here: Scope = { ...scope, [rec.var]: run("recurrence.init", () => compile(rec.init)(scope)), t: rec.t0 ?? 0 };
    for (const e of m.eOrder) here[e] = run(`equations.${e}`, () => m.fn(m.equations[e]!)(here));
    at("recurrence.next", rec.next, here);
  }
  spec.panels.forEach((p, i) => {
    const where = `panels[${i}]`;
    switch (p.kind) {
      case "curve": {
        const x = mid(p.x);
        const sc = p.x.sweep ? sweptScope(spec, params, p.x.sweep, x) : { ...scope, [p.x.var!]: x };
        for (const c of p.curves) {
          at(`${where}.curves.${c.id}`, c.expr, sc);
          c.domain?.forEach((d, j) => at(`${where}.curves.${c.id}.domain[${j}]`, d, scope));
        }
        for (const r of p.regions ?? []) {
          at(`${where}.regions.${r.id}.from`, r.from, scope);
          at(`${where}.regions.${r.id}.to`, r.to, scope);
        }
        marks(where, p);
        break;
      }
      case "path": {
        if (!rec) break;
        const here: Scope = { ...scope, [rec.var]: run("recurrence.init", () => compile(rec.init)(scope)), t: rec.t0 ?? 0 };
        for (const sr of p.series ?? []) {
          run(`${where}.series.${sr.id}`, () => {
            const { fn, inner } = seriesFns(sr.expr, spec);
            const eqs = m.needs(sr.expr);
            const sc: Scope = { ...here };
            for (const e of eqs) sc[e] = m.fn(m.equations[e]!)(sc);
            const growth: Scope = {};
            inner.forEach((f, j) => {
              f(sc);
              growth[`__growth${j}`] = 0;
            });
            return fn({ ...sc, ...growth });
          });
        }
        break;
      }
      case "contour": {
        const x = mid(p.x);
        const y = mid(p.y);
        let sc = scope;
        if (p.x.sweep || p.y.sweep) sc = withDerived(spec, { ...params, ...(p.x.sweep ? { [p.x.sweep]: x } : {}), ...(p.y.sweep ? { [p.y.sweep]: y } : {}) });
        sc = { ...sc, ...(p.x.var ? { [p.x.var]: x } : {}), ...(p.y.var ? { [p.y.var]: y } : {}) };
        at(`${where}.f`, p.f, sc);
        p.levels?.forEach((l, j) => at(`${where}.levels[${j}]`, l, scope));
        marks(where, p);
        break;
      }
      case "vector":
        marks(where, p);
        break;
      case "sampler":
        marks(where, p);
        for (const d of p.densities ?? []) for (const k of ["mean", "sd"] as const) at(`${where}.densities.${d.id}.${k}`, d[k], scope);
        break;
    }
  });
}

function round(x: number) {
  return Number(x.toPrecision(6));
}
