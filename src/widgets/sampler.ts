// sampler: seeded Monte Carlo for a panels spec. Each replication draws `rows` rows column by column from its own
// substream (replication r of seed s uses rng(mix(s, r))), fits simple OLS of fit.y on fit.x, and records the
// statistics in SAMPLER_STATS; summaries then reduce those across replications. The same params and seed always
// give the same draws, and raising the number of rows extends each replication's sample without changing its first
// rows, so a `tests` entry is stable and a slider move changes only what it should.
//
// The column expressions run once per row (hundreds of thousands of times per redraw), too often for mathjs'
// evaluate, so they are compiled here into closures over a slot array. They come from the same allow-listed syntax
// expr.ts checks (`checkWidget` runs first), and the closures follow mathjs' number semantics for that syntax.
import type { MathNode } from "mathjs";
import { math, normalFrom } from "./math";
import type { z } from "zod";
import { type Expr, SAMPLER_STATS, type SamplerPanel } from "./spec";

export type SamplerSpec = z.infer<typeof SamplerPanel>;
export type Stat = (typeof SAMPLER_STATS)[number];
type Scope = Record<string, number>;

/** Bounds that keep a redraw near 100 ms on a laptop: replications, rows per replication, and their product. */
export const SAMPLER_LIMITS = { reps: 5000, rows: 2000, cells: 400_000 } as const;
/** Functions a summary may reduce the per-replication statistics with. */
export const AGGREGATES = ["mean", "sd", "quantile", "share"] as const;

export type Bar = { x0: number; x1: number; height: number };
export type SamplerResult = {
  reps: number;
  rows: number;
  stats: Record<Stat, Float64Array>;
  summaries: Scope;
  /** The histogram of `stat` as a density (bar areas sum to the share of replications inside the axis range). */
  bars: Bar[];
  /** Replications whose statistic falls outside the axis range (not drawn). */
  outside: number;
};

// ---------------------------------------------------------------- closures over slots

type Env = Float64Array;
type Fn = (env: Env) => number;

// The stream normal() and uniform() read, set per replication while its rows are drawn: mulberry32 (math.ts' rng,
// draw for draw) with its state held here, so a uniform costs no closure call.
let streaming = false;
let state = 0;
function u(): number {
  if (!streaming) throw new Error("normal() and uniform() only work in a sampler's columns");
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Runs `f` with the draws reading replication `r`'s stream of `seed`. */
function streamOf<T>(seed: number, r: number, f: () => T): T {
  const outer = [streaming, state] as const;
  streaming = true;
  state = mix(seed, r);
  try {
    return f();
  } finally {
    [streaming, state] = outer;
  }
}

const truth = (v: unknown) => (v ? 1 : 0);
/** mathjs' mod for numbers: the remainder takes the divisor's sign. */
const mod = (x: number, y: number) => (y === 0 ? x : x - y * Math.floor(x / y));
const erf = math.erf as (v: number) => number;

const UNARY: Record<string, (a: number) => number> = {
  unaryMinus: (a) => -a,
  unaryPlus: (a) => a,
  not: (a) => truth(!a),
};
const BINARY: Record<string, (a: number, b: number) => number> = {
  add: (a, b) => a + b,
  subtract: (a, b) => a - b,
  multiply: (a, b) => a * b,
  divide: (a, b) => a / b,
  pow: (a, b) => a ** b,
  mod,
  smaller: (a, b) => truth(a < b),
  larger: (a, b) => truth(a > b),
  smallerEq: (a, b) => truth(a <= b),
  largerEq: (a, b) => truth(a >= b),
  equal: (a, b) => truth(a === b),
  unequal: (a, b) => truth(a !== b),
  and: (a, b) => truth(a && b),
  or: (a, b) => truth(a || b),
};
const CALLS: Record<string, (...a: number[]) => number> = {
  log: (x, b) => (b === undefined ? Math.log(x) : Math.log(x) / Math.log(b)),
  exp: Math.exp,
  sqrt: Math.sqrt,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  normcdf: (x, mu = 0, sigma = 1) => 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2))),
  sin: Math.sin,
  cos: Math.cos,
  atan2: Math.atan2,
  uniform: (a = 0, b = 1) => a + (b - a) * u(),
  normal: (mu = 0, sigma = 1) => normalFrom(u, mu, sigma),
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

/** Where an aggregate (mean(b2), ...) reads the per-replication statistics: filled in before summaries run. */
type Across = { reps: number; stats: Partial<Record<Stat, Float64Array>>; slots: Partial<Record<Stat, number>> };

type Compiler = {
  has: (name: string) => boolean;
  slot: (name: string) => number;
  /** Set for summaries: the statistics, readable only inside an aggregate. */
  across?: Across;
};

const node = <T>(n: MathNode) => n as unknown as T;

// Closures that are constants, so arithmetic on them folds or takes a constant operand directly.
const constants = new WeakMap<Fn, number>();
function constant(v: number): Fn {
  const f: Fn = () => v;
  constants.set(f, v);
  return f;
}

/** The four arithmetic operators as closures of their own (a shared `op(a, b)` call would be megamorphic, and these
 *  run once per row): about twice as fast as the generic path on the C1 columns. */
function arithmetic(fn: string, a: Fn, b: Fn, ka: number | undefined, kb: number | undefined): Fn | undefined {
  switch (fn) {
    case "add":
      return kb !== undefined ? (e) => a(e) + kb : ka !== undefined ? (e) => ka + b(e) : (e) => a(e) + b(e);
    case "subtract":
      return kb !== undefined ? (e) => a(e) - kb : ka !== undefined ? (e) => ka - b(e) : (e) => a(e) - b(e);
    case "multiply":
      return kb !== undefined ? (e) => a(e) * kb : ka !== undefined ? (e) => ka * b(e) : (e) => a(e) * b(e);
    case "divide":
      return kb !== undefined ? (e) => a(e) / kb : ka !== undefined ? (e) => ka / b(e) : (e) => a(e) / b(e);
    default:
      return undefined;
  }
}

function compileNode(n: MathNode, c: Compiler, inAggregate: boolean): Fn {
  switch (n.type) {
    case "ConstantNode":
      return constant(Number(node<{ value: unknown }>(n).value));
    case "ParenthesisNode":
      return compileNode(node<{ content: MathNode }>(n).content, c, inAggregate);
    case "SymbolNode": {
      const name = node<{ name: string }>(n).name;
      if (c.across && (SAMPLER_STATS as readonly string[]).includes(name) && !inAggregate) {
        throw new Error(`'${name}' differs across replications: reduce it with ${AGGREGATES.map((a) => `${a}()`).join(", ")}`);
      }
      if (name in CONSTANTS && !c.has(name)) return constant(CONSTANTS[name]!);
      const i = c.slot(name);
      return (env) => env[i]!;
    }
    case "OperatorNode": {
      const { fn, args } = node<{ fn: string; args: MathNode[] }>(n);
      const fs = args.map((a) => compileNode(a, c, inAggregate));
      if (fs.length === 1) {
        const op = UNARY[fn];
        if (!op) throw new Error(`operator '${fn}' is not allowed`);
        const [a] = fs as [Fn];
        return (env) => op(a(env));
      }
      const op = BINARY[fn];
      if (!op || fs.length !== 2) throw new Error(`operator '${fn}' is not allowed`);
      const [a, b] = fs as [Fn, Fn];
      const [ka, kb] = [constants.get(a), constants.get(b)];
      if (ka !== undefined && kb !== undefined) return constant(op(ka, kb));
      return arithmetic(fn, a, b, ka, kb) ?? ((env) => op(a(env), b(env)));
    }
    case "ConditionalNode": {
      const { condition, trueExpr, falseExpr } = node<{ condition: MathNode; trueExpr: MathNode; falseExpr: MathNode }>(n);
      const [k, t, f] = [condition, trueExpr, falseExpr].map((x) => compileNode(x, c, inAggregate)) as [Fn, Fn, Fn];
      return (env) => (k(env) ? t(env) : f(env));
    }
    case "FunctionNode": {
      const { fn, args } = node<{ fn: { name: string }; args: MathNode[] }>(n);
      if ((AGGREGATES as readonly string[]).includes(fn.name)) return aggregate(fn.name as (typeof AGGREGATES)[number], args, c, inAggregate);
      const call = CALLS[fn.name];
      if (!call) throw new Error(`function ${fn.name}() is not allowed here`);
      const fs = args.map((a) => compileNode(a, c, inAggregate));
      // The draws run once per row: give them direct closures rather than the generic call path.
      if (fn.name === "normal" || fn.name === "uniform") {
        const a: Fn = fs[0] ?? (() => 0);
        const b: Fn = fs[1] ?? (() => 1);
        // Box-Muller as math.ts' normalFrom has it, inlined.
        if (fn.name === "normal") return (env) => a(env) + b(env) * Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
        return (env) => {
          const lo = a(env);
          return lo + (b(env) - lo) * u();
        };
      }
      if (fs.length === 1) {
        const [a] = fs as [Fn];
        return (env) => call(a(env));
      }
      if (fs.length === 2) {
        const [a, b] = fs as [Fn, Fn];
        return (env) => call(a(env), b(env));
      }
      return (env) => call(...fs.map((f) => f(env)));
    }
    default:
      throw new Error(`${n.type.replace(/Node$/, "").toLowerCase()} syntax is not allowed`);
  }
}

/** mean(e), sd(e), quantile(e, p) and share(cond): e is evaluated once per replication, with the statistics in scope. */
function aggregate(name: (typeof AGGREGATES)[number], args: MathNode[], c: Compiler, inAggregate: boolean): Fn {
  const across = c.across;
  if (!across) throw new Error(`function ${name}() is not allowed here`);
  if (inAggregate) throw new Error(`${name}() cannot sit inside another of ${AGGREGATES.join(", ")}`);
  const want = name === "quantile" ? 2 : 1;
  if (args.length !== want) throw new Error(`${name}() takes ${want} argument${want === 1 ? "" : "s"}, not ${args.length}`);
  const inner = compileNode(args[0]!, c, true);
  const p = name === "quantile" ? compileNode(args[1]!, c, false) : null;
  const stats = SAMPLER_STATS.filter((s) => across.slots[s] !== undefined);
  return (env) => {
    const n = across.reps;
    const values = new Float64Array(n);
    for (let r = 0; r < n; r++) {
      for (const s of stats) env[across.slots[s]!] = across.stats[s]![r]!;
      values[r] = inner(env);
    }
    switch (name) {
      case "mean":
        return meanOf(values);
      case "share":
        return meanOf(values.map((v) => truth(v)));
      case "sd":
        return sdOf(values);
      case "quantile":
        return quantileOf(values, p!(env));
    }
  };
}

function meanOf(xs: Float64Array): number {
  let s = 0;
  for (const x of xs) s += x;
  return xs.length ? s / xs.length : NaN;
}

/** Sample standard deviation (divisor n - 1). */
function sdOf(xs: Float64Array): number {
  const m = meanOf(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return xs.length > 1 ? Math.sqrt(s / (xs.length - 1)) : NaN;
}

/** Linear interpolation between order statistics (R's type 7). */
function quantileOf(xs: Float64Array, p: number): number {
  if (!xs.length || !(p >= 0 && p <= 1)) return NaN;
  const sorted = Float64Array.from(xs).sort();
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  return sorted[lo]! + (h - lo) * ((sorted[Math.min(lo + 1, sorted.length - 1)] ?? NaN) - sorted[lo]!);
}

// ---------------------------------------------------------------- one run

/** The seed of replication r: a 32-bit mix, so neighbouring replications (and draws) get unrelated streams. */
export function mix(seed: number, r: number): number {
  let h = (seed + Math.imul(r + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Replications and rows at these values, clamped to SAMPLER_LIMITS (replications give way to rows). */
export function samplerSize(panel: SamplerSpec, scope: Scope): { reps: number; rows: number } {
  const at = (e: Expr) => (typeof e === "number" ? e : Number(math.evaluate(e, { ...scope })));
  const rows = Math.round(Math.min(SAMPLER_LIMITS.rows, Math.max(3, at(panel.rows))));
  const reps = Math.round(Math.min(SAMPLER_LIMITS.reps, Math.floor(SAMPLER_LIMITS.cells / rows), Math.max(2, at(panel.reps))));
  if (!Number.isFinite(rows) || !Number.isFinite(reps)) throw new Error("reps and rows must be finite numbers");
  return { reps, rows };
}

type Compiled = { names: string[]; columns: [number, Fn][]; x: number; y: number; summaries: [string, number, Fn][]; across: Across };
const compiledFor = new WeakMap<SamplerSpec, Map<string, Compiled>>();

/** The panel's expressions compiled against one set of scope names (the names, not the values: a slider move reuses it). */
function compiled(panel: SamplerSpec, base: string[]): Compiled {
  const key = base.join(",");
  let byNames = compiledFor.get(panel);
  if (!byNames) compiledFor.set(panel, (byNames = new Map()));
  let made = byNames.get(key);
  if (made) return made;
  const names = [...base];
  const index = new Map(names.map((n, i) => [n, i]));
  const add = (n: string) => {
    if (!index.has(n)) {
      index.set(n, names.length);
      names.push(n);
    }
    return index.get(n)!;
  };
  const known = new Set(base);
  const has = (n: string) => known.has(n);
  const slot = (n: string) => {
    if (!known.has(n)) throw new Error(`unknown name '${n}'`);
    return index.get(n)!;
  };
  const columns: [number, Fn][] = [];
  for (const [id, e] of Object.entries(panel.columns)) {
    columns.push([add(id), compileNode(math.parse(String(e)), { has, slot }, false)]);
    known.add(id);
  }
  if (!(panel.fit.x in panel.columns) || !(panel.fit.y in panel.columns)) throw new Error("fit.x and fit.y must name columns");
  const across: Across = { reps: 0, stats: {}, slots: {} };
  for (const s of SAMPLER_STATS) {
    across.slots[s] = add(s);
    known.add(s);
  }
  const summaries: [string, number, Fn][] = [];
  for (const [id, e] of Object.entries(panel.summaries ?? {})) {
    summaries.push([id, add(id), compileNode(math.parse(String(e)), { has, slot, across }, false)]);
    known.add(id);
  }
  made = { names, columns, x: index.get(panel.fit.x)!, y: index.get(panel.fit.y)!, summaries, across };
  byNames.set(key, made);
  return made;
}

/** Run the sampler at `scope` (params, fixed params, derived values). `redraw` > 0 shifts every replication to fresh
 *  streams ("Draw again"); tests and goals at a view's start use 0. Throws on a bad expression. */
export function runSampler(panel: SamplerSpec, scope: Scope, redraw = 0): SamplerResult {
  const base = Object.keys(scope).filter((k) => !(k in panel.columns) && !(SAMPLER_STATS as readonly string[]).includes(k));
  const c = compiled(panel, base);
  const env = new Float64Array(c.names.length);
  base.forEach((k, i) => (env[i] = scope[k]!));
  const { reps, rows } = samplerSize(panel, scope);
  const stats = Object.fromEntries(SAMPLER_STATS.map((s) => [s, new Float64Array(reps)])) as Record<Stat, Float64Array>;
  const xs = new Float64Array(rows);
  const ys = new Float64Array(rows);
  const seed = seedOf(panel, redraw);
  // The hot loop: plain indexed arrays, no iterators (a redraw runs it up to SAMPLER_LIMITS.cells times).
  const at = c.columns.map(([i]) => i);
  const fs = c.columns.map(([, f]) => f);
  const k = fs.length;
  for (let r = 0; r < reps; r++) {
    streamOf(seed, r, () => {
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < k; j++) env[at[j]!] = fs[j]!(env);
        xs[i] = env[c.x]!;
        ys[i] = env[c.y]!;
      }
    });
    fitInto(stats, r, xs, ys);
  }
  c.across.reps = reps;
  c.across.stats = stats;
  const summaries: Scope = {};
  for (const [id, at, f] of c.summaries) summaries[id] = env[at] = f(env);
  const { bars, outside } = histogram(stats[panel.stat], panel.x.min, panel.x.max, panel.bins ?? 40);
  return { reps, rows, stats, summaries, bars, outside };
}

/** The rows replication `r` draws, column by column (what runSampler fits): for tests, and to show that raising the
 *  number of rows extends a replication's sample without changing its first rows. */
export function replicationRows(panel: SamplerSpec, scope: Scope, r: number, rows: number, redraw = 0): Record<string, number[]> {
  const base = Object.keys(scope).filter((k) => !(k in panel.columns) && !(SAMPLER_STATS as readonly string[]).includes(k));
  const c = compiled(panel, base);
  const env = new Float64Array(c.names.length);
  base.forEach((k, i) => (env[i] = scope[k]!));
  const out: Record<string, number[]> = Object.fromEntries(Object.keys(panel.columns).map((k) => [k, []]));
  const ids = Object.keys(panel.columns);
  streamOf(seedOf(panel, redraw), r, () => {
    for (let i = 0; i < rows; i++) {
      c.columns.forEach(([at, f], j) => {
        env[at] = f(env);
        out[ids[j]!]!.push(env[at]!);
      });
    }
  });
  return out;
}

const seedOf = (panel: SamplerSpec, redraw: number) => (panel.seed + Math.imul(redraw, 0x632be5ab)) >>> 0;

/** Simple OLS of y on x: slope, intercept, the textbook and HC1 standard errors of the slope, its t ratio and R². */
function fitInto(stats: Record<Stat, Float64Array>, r: number, xs: Float64Array, ys: Float64Array) {
  const n = xs.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  const xbar = sx / n;
  const ybar = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - xbar;
    const dy = ys[i]! - ybar;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const b2 = sxy / sxx;
  const b1 = ybar - b2 * xbar;
  let ssr = 0;
  let meat = 0;
  for (let i = 0; i < n; i++) {
    const e = ys[i]! - b1 - b2 * xs[i]!;
    const dx = xs[i]! - xbar;
    ssr += e * e;
    meat += dx * dx * e * e;
  }
  const se = Math.sqrt(ssr / (n - 2) / sxx);
  stats.b1[r] = b1;
  stats.b2[r] = b2;
  stats.se_b2[r] = se;
  stats.se_b2_hc1[r] = Math.sqrt((n / (n - 2)) * meat) / sxx;
  stats.t_b2[r] = b2 / se;
  stats.r2[r] = 1 - ssr / syy;
}

/** Equal-width bins over [lo, hi], scaled as a density so a normal curve with the same mean and sd overlays it. */
function histogram(values: Float64Array, lo: number, hi: number, bins: number): { bars: Bar[]; outside: number } {
  const w = (hi - lo) / bins;
  const counts = new Array<number>(bins).fill(0);
  let outside = 0;
  for (const v of values) {
    const k = Math.floor((v - lo) / w);
    if (k >= 0 && k < bins) counts[k]!++;
    else if (v === hi) counts[bins - 1]!++;
    else outside++;
  }
  const n = values.length || 1;
  return { bars: counts.map((c, k) => ({ x0: lo + k * w, x1: lo + (k + 1) * w, height: c / (n * w) })), outside };
}

/** The normal density, for the overlays. */
export function normalPdf(x: number, mean: number, sd: number): number {
  return Math.exp(-0.5 * ((x - mean) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
}
