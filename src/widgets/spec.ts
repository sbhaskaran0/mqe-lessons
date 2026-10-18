// Widget specs: the YAML under '## Spec' in a vault note in Interactives/, passed through by `vault_tool.py export`.
// Mirrors the structural rules `vault_tool.py check` enforces (see TYPE_KEYS / PART_KEYS there); the semantic
// rules - expressions, scopes, derived-value order, `tests` - live in ./expr.ts and run in `npm run validate`.
import { z } from "zod";

/** A number, or a mathjs expression over the names in scope (see expr.ts). */
export const Expr = z.union([z.string().min(1), z.number()]);
export type Expr = z.infer<typeof Expr>;

const Id = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be a plain identifier");
const ElementId = z.string().min(1);
const Tex = z.string();

const Param = z
  .strictObject({
    tex: Tex,
    min: z.number(),
    max: z.number(),
    default: z.number(),
    step: z.number().positive().optional(),
    label: z.string().optional(),
    unit: z.string().optional(),
    format: z.string().optional(),
    /** Text for slider positions (1: normal, 2: lognormal). When every position has one, the slider is a segmented
     *  control; the value stays a number for goals and tests. JSON writes the numeric YAML keys as strings. */
    labels: z.record(z.string(), z.string()).optional(),
  })
  .refine((p) => p.min < p.max, "min must be below max")
  .refine((p) => p.min <= p.default && p.default <= p.max, "default must lie in [min, max]");

const Readout = z.strictObject({
  id: ElementId,
  expr: Expr,
  tex: Tex.optional(),
  label: z.string().optional(),
  format: z.string().optional(),
  /** Text shown for particular values (2: positive definite, 0: indefinite): the value stays a number for goals and
   *  tests. JSON writes the numeric YAML keys as strings. */
  labels: z.record(z.string(), z.string()).optional(),
});

/** Numbers checked in Python when the widget was authored; `npm run validate` recomputes them. `at` binds a model's
 *  free variables (k: 100), so a test can name an equation (f, next_k) as well as derived values. */
const Test = z.strictObject({
  params: z.record(z.string(), z.number()).optional(),
  at: z.record(z.string(), z.number()).optional(),
  expect: z.record(z.string(), z.number()),
  tol: z.number().nonnegative().optional(),
});

/** Rebinding: the model quantity `of` evaluated with some parameters replaced (`with: {s: s1}`); its derived chain is
 *  re-evaluated. The `with` values are expressions in the scope of the place the rebinding appears. */
export const Rebind = z.strictObject({ of: Id, with: z.record(Id, Expr) });
export type Rebind = z.infer<typeof Rebind>;
/** An expression or a rebinding (panels specs: derived values, equations, recurrence.next, curves and series). */
export const DerivedExpr = z.union([z.string().min(1), z.number(), Rebind]);
export type DerivedExpr = z.infer<typeof DerivedExpr>;

const common = {
  title: z.string().optional(),
  params: z.record(Id, Param).optional(),
  derived: z.record(Id, Expr).optional(),
  readouts: z.array(Readout).optional(),
  tests: z.array(Test).optional(),
  /** Asset path of the lecture figure this widget reproduces ("Compare with the lecture figure"). */
  compare_figure: z.string().optional(),
  /** The note whose Notation table labels the spec's symbols; the exporter has already filled tex and labels from it. */
  notation: z.string().optional(),
};

const Style = z.enum(["solid", "dashed", "dotted"]);
const Axis = {
  tex: Tex.optional(),
  label: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
};
const Point2 = z.tuple([Expr, Expr]);

// ---- panels: the flat spec the exporter writes for a view note (and for a model note's own page, with no panels).
// Element ids are flat and unique across the whole spec: panel ids and every mark id are show/highlight targets.

export const CurveMark = z.strictObject({
  id: ElementId,
  expr: DerivedExpr,
  tex: Tex.optional(),
  label: z.string().optional(),
  domain: Point2.optional(),
  style: Style.optional(),
  color: z.string().optional(),
  /** On a sweep panel: a dot at the current value of the swept parameter, draggable along x unless it is locked. */
  mark: z.boolean().optional(),
});
export const PointMark = z.strictObject({
  id: ElementId,
  x: Expr,
  y: Expr,
  tex: Tex.optional(),
  label: z.string().optional(),
  /** Dragging the point sets these parameters (e.g. an endowment point sets y1 and y2). */
  drag: z.strictObject({ x: Id.optional(), y: Id.optional() }).optional(),
  guides: z.boolean().optional(),
  color: z.string().optional(),
});
export const LineMark = z
  .strictObject({
    id: ElementId,
    x: Expr.optional(),
    y: Expr.optional(),
    from: Point2.optional(),
    to: Point2.optional(),
    tex: Tex.optional(),
    label: z.string().optional(),
    style: Style.optional(),
    color: z.string().optional(),
  })
  .refine(
    (l) => [l.x !== undefined, l.y !== undefined, l.from !== undefined && l.to !== undefined].filter(Boolean).length === 1,
    "a line needs exactly one of: x (vertical), y (horizontal), or from + to",
  );
export const RegionMark = z.strictObject({
  id: ElementId,
  /** Two curve ids of the same panel, or a curve id and "axis". */
  between: z.tuple([z.string(), z.string()]),
  from: Expr.optional(),
  to: Expr.optional(),
  tex: Tex.optional(),
  label: z.string().optional(),
  color: z.string().optional(),
});
export const ArrowMark = z.strictObject({
  id: ElementId,
  from: Point2,
  to: Point2,
  tex: Tex.optional(),
  label: z.string().optional(),
  style: Style.optional(),
  color: z.string().optional(),
});
/** A time series of the view's recurrence: an expression in the state variable, t, params, derived values and
 *  equations (growth() for period-on-period growth). */
export const SeriesMark = z.strictObject({
  id: ElementId,
  expr: DerivedExpr,
  tex: Tex.optional(),
  label: z.string().optional(),
  color: z.string().optional(),
});
export const Shock = z.strictObject({
  t: z.number().int().min(0),
  set: z.record(Id, z.number()),
  id: ElementId.optional(),
  label: z.string().optional(),
});

const oneOf = (a: unknown, b: unknown) => (a === undefined) !== (b === undefined);
/** A curve panel's x: a model variable (min and max required) or a swept parameter (its slider range by default). */
export const CurveX = z
  .strictObject({ var: Id.optional(), sweep: Id.optional(), ...Axis })
  .refine((x) => oneOf(x.var, x.sweep), "x needs exactly one of: var (a model variable), sweep (a parameter)")
  .refine((x) => x.var === undefined || (x.min !== undefined && x.max !== undefined), "x with a var needs min and max");
/** A contour axis: a model variable or a swept parameter, over [min, max]. */
export const PlaneAxis = z
  .strictObject({ var: Id.optional(), sweep: Id.optional(), tex: Tex.optional(), label: z.string().optional(), min: z.number(), max: z.number() })
  .refine((x) => oneOf(x.var, x.sweep), "an axis needs exactly one of: var (a model variable), sweep (a parameter)");
export const PlainAxis = z.strictObject({ tex: Tex.optional(), label: z.string().optional(), min: z.number(), max: z.number() });
export const YAxis = z.strictObject(Axis);
export const PhaseSpec = z.strictObject({ min: z.number().optional(), max: z.number().optional(), label: z.string().optional() });

const panelBase = { id: ElementId, title: z.string().optional() };
/** `equal`: one unit is as long on x as on y, with the authored ranges kept (the plot box takes their shape). */
const aspect = { aspect: z.enum(["equal"]).optional() };
const extraMarks = { points: z.array(PointMark).optional(), lines: z.array(LineMark).optional(), arrows: z.array(ArrowMark).optional() };

export const CurvePanel = z.strictObject({
  kind: z.literal("curve"),
  ...panelBase,
  ...aspect,
  x: CurveX,
  y: YAxis,
  curves: z.array(CurveMark).min(1),
  regions: z.array(RegionMark).optional(),
  ...extraMarks,
});
export const PathPanel = z
  .strictObject({
    kind: z.literal("path"),
    ...panelBase,
    /** Presentation only: "logs" labels the axis in log points, "growth" formats it as percentages. */
    scale: z.enum(["levels", "logs", "growth"]).optional(),
    y: YAxis.optional(),
    series: z.array(SeriesMark).optional(),
    /** A phase (cobweb) panel instead of a time panel: x_{t+1} against x_t. */
    phase: PhaseSpec.optional(),
  })
  .refine((p) => oneOf(p.series, p.phase), "a path panel needs exactly one of: series (a time panel), phase (a cobweb)");
export const ContourPanel = z.strictObject({
  kind: z.literal("contour"),
  ...panelBase,
  ...aspect,
  x: PlaneAxis,
  y: PlaneAxis,
  /** f(x, y), drawn as level sets. */
  f: Expr,
  /** Levels as expressions (current values); without them, `count` levels spread over the plotted values. */
  levels: z.array(Expr).optional(),
  count: z.number().int().min(1).max(30).optional(),
  /** Marching squares on grid x grid cells. */
  grid: z.number().int().min(4).max(120).optional(),
  ...extraMarks,
});
export const VectorPanel = z.strictObject({
  kind: z.literal("vector"),
  ...panelBase,
  ...aspect,
  x: PlainAxis,
  y: PlainAxis,
  /** Equal units on both axes. */
  square: z.boolean().optional(),
  ...extraMarks,
});
/** Statistics a sampler computes per replication from its simple OLS fit (a closed set). */
export const SAMPLER_STATS = ["b1", "b2", "se_b2", "se_b2_hc1", "t_b2", "r2"] as const;
/** A normal density over a sampler's histogram: what a standard error claims the spread is. */
export const DensityMark = z.strictObject({
  id: ElementId,
  mean: Expr,
  sd: Expr,
  tex: Tex.optional(),
  label: z.string().optional(),
  style: Style.optional(),
  color: z.string().optional(),
});
export const SamplerFit = z.strictObject({ y: Id, x: Id });
/** Seeded Monte Carlo: `reps` replications of `rows` rows drawn column by column, a simple OLS fit per replication,
 *  and a histogram of one statistic over [x.min, x.max]. Summaries are scalars across replications (mean(b2),
 *  sd(b2), quantile(t_b2, 0.975), share(abs(t_b2) > 2)) that readouts, goals, tests and the overlays read. */
export const SamplerPanel = z.strictObject({
  kind: z.literal("sampler"),
  ...panelBase,
  seed: z.number().int(),
  reps: Expr,
  rows: Expr,
  /** Per row, in order; normal() and uniform() draw from the replication's own seeded stream. */
  columns: z.record(Id, Expr),
  fit: SamplerFit,
  stat: z.enum(SAMPLER_STATS),
  bins: z.number().int().min(5).max(120).optional(),
  /** Fixed, so a narrower spread shows as a narrower histogram rather than a rescaled axis. */
  x: PlainAxis,
  y: YAxis.optional(),
  summaries: z.record(Id, Expr).optional(),
  lines: z.array(LineMark).optional(),
  densities: z.array(DensityMark).optional(),
});
export const Panel = z.discriminatedUnion("kind", [CurvePanel, PathPanel, ContourPanel, VectorPanel, SamplerPanel]);
export type Panel = z.infer<typeof Panel>;

/** The view's one simulation, shared by its path panels: x_{t+1} = next(x_t) for t = t0 .. t0 + periods. */
export const Recurrence = z.strictObject({
  var: Id,
  init: Expr,
  /** The first period's number (default 0); the notes often count from 1. */
  t0: z.number().int().optional(),
  periods: z.number().int().min(1),
  next: DerivedExpr,
  tex: Tex.optional(),
  label: z.string().optional(),
  shocks: z.array(Shock).optional(),
});

export const Panels = z.strictObject({
  type: z.literal("panels"),
  ...common,
  derived: z.record(Id, DerivedExpr).optional(),
  /** Model parameters the view holds at their value: not sliders, not state or lock targets. */
  fixed: z.record(Id, z.number()).optional(),
  /** The model's free variables, which panels bind to an axis or iterate. */
  vars: z.record(Id, z.strictObject({ tex: Tex.optional(), label: z.string().optional() })).optional(),
  /** Named expressions that read the variables, evaluated wherever a panel binds them. */
  equations: z.record(Id, DerivedExpr).optional(),
  recurrence: Recurrence.optional(),
  panels: z.array(Panel),
});

export const ScatterFit = z
  .strictObject({
    type: z.literal("scatter-fit"),
    ...common,
    dataset: z.string().optional(),
    /** Seeded synthetic data: x may use uniform()/normal(); y may use x and normal(). */
    generate: z.strictObject({ n: z.number().int().positive(), seed: z.number().int(), x: Expr, y: Expr }).optional(),
    x: z.strictObject({ column: z.string().optional(), ...Axis }),
    y: z.strictObject({ column: z.string().optional(), ...Axis }),
    /** The draggable line: parameter ids for its intercept and slope. */
    line: z.strictObject({ intercept: Id, slope: Id }),
    /** Contour panels beside the scatter whose axes sweep the line's parameters: SSR(b1, b2) written in the data-only
     *  sums (sum_y, sum_xy, ...), with the current line as a point that can be dragged. */
    panels: z.array(ContourPanel).optional(),
  })
  .refine((s) => (s.dataset === undefined) !== (s.generate === undefined), "needs exactly one of: dataset, generate");

export const CHART_MARKS = ["line", "bar", "area", "point", "rug"] as const;
const ChartMark = z.enum(CHART_MARKS);
/** A filter value: a literal the column must equal, or `{param: p}`: the slider position p is at (a blank cell matches
 *  any position). */
export const WhereValue = z.union([z.string(), z.number(), z.boolean(), z.strictObject({ param: Id })]);
export const ChartSeries = z.strictObject({
  id: ElementId,
  label: z.string().optional(),
  tex: Tex.optional(),
  column: z.string().optional(),
  where: z.record(z.string(), WhereValue).optional(),
  color: z.string().optional(),
  /** Overrides the panel's (or the spec's) mark for this series. */
  mark: ChartMark.optional(),
  /** One point at the params' values, no rows: dragging it sets them (snapped to their steps). */
  drag: z.strictObject({ x: Id, y: Id }).optional(),
});
export const ChartX = z.strictObject({ column: z.string(), kind: z.enum(["number", "time", "band"]).optional(), ...Axis });
export const ChartY = z.strictObject({ column: z.string(), ...Axis });
export const ChartAnnotation = z.strictObject({ id: ElementId, x: z.union([z.string(), z.number()]), y: z.number().optional(), label: z.string() });
/** One chart of a data-chart with `panels`: its own axes and series; params, readouts and goal are the widget's. */
export const ChartPanel = z.strictObject({
  id: ElementId,
  title: z.string().optional(),
  mark: ChartMark.optional(),
  x: ChartX,
  y: ChartY,
  series: z.array(ChartSeries).optional(),
  annotations: z.array(ChartAnnotation).optional(),
});

export const DataChart = z
  .strictObject({
    type: z.literal("data-chart"),
    ...common,
    dataset: z.string(),
    mark: ChartMark.optional(),
    x: ChartX.optional(),
    y: ChartY.optional(),
    series: z.array(ChartSeries).optional(),
    annotations: z.array(ChartAnnotation).optional(),
    /** 2-3 charts sharing the params; replaces x, y, series and annotations. */
    panels: z.array(ChartPanel).min(2).max(3).optional(),
  })
  .refine(
    (s) => (s.panels ? [s.x, s.y, s.series, s.annotations].every((v) => v === undefined) : s.x !== undefined && s.y !== undefined),
    "needs x and y, or panels (which replace x, y, series and annotations)",
  );

export const DIST_VIEWS = ["histogram", "density", "lorenz", "cdf"] as const;
export const DIST_MEASURES = ["gini", "p90p10", "p50p10", "p90p50", "varlog", "mean", "median", "cv", "top10"] as const;

export const Distribution = z
  .strictObject({
    type: z.literal("distribution"),
    ...common,
    dataset: z.string().optional(),
    column: z.string().optional(),
    weight: z.string().optional(),
    family: z.enum(["lognormal", "normal", "pareto", "uniform"]).optional(),
    dist: z
      .strictObject({
        mu: Expr.optional(),
        sigma: Expr.optional(),
        alpha: Expr.optional(),
        xmin: Expr.optional(),
        lo: Expr.optional(),
        hi: Expr.optional(),
      })
      .optional(),
    x: z.strictObject({ log: z.boolean().optional(), ...Axis }).optional(),
    views: z.array(z.enum(DIST_VIEWS)).optional(),
    measures: z.array(z.enum(DIST_MEASURES)).optional(),
  })
  .refine((s) => (s.dataset === undefined) !== (s.family === undefined), "needs exactly one of: dataset, family")
  .refine((s) => s.dataset === undefined || s.column !== undefined, "needs 'column' with a dataset");

export const Custom = z.strictObject({
  type: z.literal("custom"),
  ...common,
  /** A React component registered by this name in src/widgets/custom/. */
  component: z.string().regex(/^[A-Z][A-Za-z0-9]*$/),
  params: z.record(Id, Param),
  elements: z.array(z.string()).optional(),
  props: z.record(z.string(), z.unknown()).optional(),
});

export const WidgetSpec = z.discriminatedUnion("type", [Panels, ScatterFit, DataChart, Distribution, Custom]);
export type WidgetSpec = z.infer<typeof WidgetSpec>;
export type WidgetType = WidgetSpec["type"];

/** Scatter-fit sums that depend on the data alone, so a contour sweeping the line's parameters may read them. */
export const DATA_SUMS = ["sum_x", "sum_y", "sum_xx", "sum_xy", "sum_yy"] as const;

/** Built-in element ids (show/highlight/hide targets) and scalar names (tests, goals) per widget type. */
export const BUILTIN_ELEMENTS: Partial<Record<WidgetType, readonly string[]>> = {
  "scatter-fit": ["points", "line", "residuals", "squares", "ols", "ssr", "r2"],
  distribution: [...DIST_VIEWS, ...DIST_MEASURES, "equality"],
};
export const BUILTIN_SCALARS: Partial<Record<WidgetType, readonly string[]>> = {
  "scatter-fit": ["ssr", "ssr_min", "r2", "slope_ols", "intercept_ols", "n", "xbar", "ybar", ...DATA_SUMS],
  distribution: DIST_MEASURES,
};

/** Ids a block may name: params (state, lock), elements (show, highlight, predict.hide). */
export function widgetParts(spec: WidgetSpec): { params: string[]; elements: string[]; scalars: string[] } {
  const params = Object.keys(spec.params ?? {});
  const readouts = (spec.readouts ?? []).map((r) => r.id);
  const ids = (xs: { id?: string }[] | undefined) => (xs ?? []).flatMap((x) => (x.id === undefined ? [] : [x.id]));
  let elements: string[] = [];
  switch (spec.type) {
    case "panels":
      elements = [...spec.panels.flatMap((p) => [p.id, ...panelMarks(p)]), ...ids(spec.recurrence?.shocks)];
      break;
    case "scatter-fit":
      elements = (spec.panels ?? []).flatMap((p) => [p.id, ...panelMarks(p)]);
      break;
    case "data-chart":
      elements = spec.panels
        ? spec.panels.flatMap((p) => [p.id, ...ids(p.series), ...ids(p.annotations)])
        : [...ids(spec.series), ...ids(spec.annotations)];
      break;
    case "custom":
      elements = [...(spec.elements ?? [])];
      break;
  }
  elements = [...elements, ...readouts, ...(BUILTIN_ELEMENTS[spec.type] ?? [])];
  const scalars = [...Object.keys(spec.derived ?? {}), ...readouts, ...(BUILTIN_SCALARS[spec.type] ?? []), ...samplerSummaries(spec)];
  return { params, elements, scalars };
}

/** Names of the summaries a panels spec's samplers compute: scalars like derived values, for readouts, goals, tests
 *  and the marks drawn over the histograms. */
export function samplerSummaries(spec: WidgetSpec): string[] {
  if (spec.type !== "panels") return [];
  return spec.panels.flatMap((p) => (p.kind === "sampler" ? Object.keys(p.summaries ?? {}) : []));
}

/** Ids of the marks a panel draws (its show/highlight targets besides the panel itself). */
export function panelMarks(p: Panel): string[] {
  const ids = (xs: { id: string }[] | undefined) => (xs ?? []).map((x) => x.id);
  switch (p.kind) {
    case "curve":
      return [...ids(p.curves), ...ids(p.regions), ...ids(p.points), ...ids(p.lines), ...ids(p.arrows)];
    case "path":
      return ids(p.series);
    case "sampler":
      return [...ids(p.lines), ...ids(p.densities)];
    default:
      return [...ids(p.points), ...ids(p.lines), ...ids(p.arrows)];
  }
}
