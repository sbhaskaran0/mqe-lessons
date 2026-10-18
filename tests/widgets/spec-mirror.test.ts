// The widget spec schema exists twice: zod in src/widgets/spec.ts (the player, `npm run validate`) and the key
// tables TYPE_KEYS / PART_KEYS in vault_tool.py (`check`, where authors see errors first). This reads the Python
// tables and checks that every key, whether it is required and what kind of value it takes match the zod schema.
// The same goes for a placement: BLOCK_KEYS / GOAL_KEYS / PREDICT_KEYS against the IR's interactive block.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { Block, Goal, Predict } from "../../src/ir";
import * as spec from "../../src/widgets/spec";

const { WidgetSpec } = spec;
import { REPO } from "../helpers";

/** {key: [required, kind]}, kind one of str, int, num, expr (a number or an expression), dict, list, bool. */
type Table = Record<string, [boolean, string]>;

type Python = { common: Table; types: Record<string, Table>; parts: Record<string, Table>; block: Table; goal: Table; predict: Table; authorOnly: string[] };

function python(): Python {
  const cfg = JSON.parse(readFileSync(path.join(REPO, "mqe.config.json"), "utf8")) as { vault: string; python?: string };
  const meta = path.join(process.env.MQE_VAULT ?? cfg.vault, "_meta");
  const code = [
    "import json, sys",
    "sys.path.insert(0, sys.argv[1])",
    "import vault_tool as v",
    "names = {str: 'str', int: 'int', bool: 'bool', dict: 'dict', list: 'list', v.NUM: 'num', v.EXPR: 'expr', v.DEXPR: 'rebind', v.OBJECTIVE_VALUE: 'objective'}",
    "table = lambda t: {k: [req, names[kind]] for k, (req, kind) in t.items()}",
    "print(json.dumps({'common': table(v.COMMON_KEYS), 'types': {t: table(k) for t, k in v.TYPE_KEYS.items()}, 'parts': {p: table(k) for p, k in v.PART_KEYS.items()},",
    "                  'block': table(v.BLOCK_KEYS), 'goal': table(v.GOAL_KEYS), 'predict': table(v.PREDICT_KEYS), 'authorOnly': list(v.AUTHOR_ONLY)}))",
  ].join("\n");
  const r = spawnSync(process.env.MQE_PYTHON ?? cfg.python ?? "python", ["-c", code, meta], {
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" },
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

// zod 4 keeps a schema's definition on `_zod.def`; refined objects stay objects.
type Def = { type: string; innerType?: Schema; element?: Schema; options?: Schema[]; shape?: Record<string, Schema>; valueType?: Schema };
type Schema = z.ZodType & { _zod: { def: Def }; format?: string | null };

const def = (s: Schema) => s._zod.def;
const unwrap = (s: Schema): [boolean, Schema] => (def(s).type === "optional" ? [false, def(s).innerType!] : [true, s]);

function kind(s: Schema): string {
  const d = def(s);
  switch (d.type) {
    case "string":
    case "literal":
    case "enum":
      return "str";
    case "number":
      return s.format === "safeint" ? "int" : "num";
    case "union": {
      const types = d.options!.map((o) => def(o).type).sort().join();
      // Expr is a number or an expression; DerivedExpr adds a rebinding {of, with}.
      return types === "number,string" ? "expr" : types === "number,object,string" ? "rebind" : `union of ${types}`;
    }
    case "object":
    case "record":
      return "dict";
    case "array":
    case "tuple":
      return "list";
    case "boolean":
      return "bool";
    default:
      return d.type;
  }
}

function table(shape: Record<string, Schema>): Table {
  return Object.fromEntries(
    Object.entries(shape).map(([k, s]) => {
      const [required, inner] = unwrap(s);
      return [k, [required, kind(inner)]];
    }),
  );
}

/** The object schema an item of a part has: a list's element, or the value itself. */
function itemShape(s: Schema): Record<string, Schema> {
  let inner = unwrap(s)[1];
  if (def(inner).type === "array") inner = def(inner).element!;
  if (def(inner).type === "record") inner = def(inner).valueType!;
  const shape = def(inner).shape;
  if (!shape) throw new Error(`not an object: ${def(inner).type}`);
  return shape;
}

const TYPES = Object.fromEntries((WidgetSpec as unknown as { options: Schema[] }).options.map((o) => [String((def(def(o).shape!.type!) as unknown as { values: string[] }).values[0]), def(o).shape!]));

/** The panels parts, which sit inside panels and marks rather than at '<type>.<key>'. */
const PANEL_PARTS: Record<string, unknown> = {
  rebind: spec.Rebind,
  var: (def(spec.Panels as unknown as Schema).shape!.vars as Schema),
  // a data-chart series' dragged point (inside series, which may sit inside panels)
  "data-chart.drag": def(spec.ChartSeries as unknown as Schema).shape!.drag,
  shock: spec.Shock,
  "panel.curve": spec.CurvePanel,
  "panel.path": spec.PathPanel,
  "panel.contour": spec.ContourPanel,
  "panel.vector": spec.VectorPanel,
  "panel.sampler": spec.SamplerPanel,
  fit: spec.SamplerFit,
  density: spec.DensityMark,
  "axis.curve": spec.CurveX,
  "axis.plane": spec.PlaneAxis,
  "axis.plain": spec.PlainAxis,
  axis: spec.YAxis,
  curve: spec.CurveMark,
  point: spec.PointMark,
  line: spec.LineMark,
  region: spec.RegionMark,
  arrow: spec.ArrowMark,
  series: spec.SeriesMark,
  phase: spec.PhaseSpec,
};

describe("spec.ts mirrors vault_tool.py's TYPE_KEYS and PART_KEYS", () => {
  const py = python();

  it("has the same widget types (model and view are author-only: the export flattens them into panels)", () => {
    expect(Object.keys(TYPES).sort()).toEqual(Object.keys(py.types).filter((t) => !py.authorOnly.includes(t)).sort());
  });

  it("each type takes the same top-level keys, equally required, of the same kind", () => {
    for (const [type, shape] of Object.entries(TYPES)) expect(table(shape), type).toEqual({ ...py.common, ...py.types[type] });
    // A model or view takes the common keys too, so its authored spec flattens into one.
    for (const t of py.authorOnly) if (py.types[t]) expect(Object.keys(py.types[t]!).every((k) => k in TYPES.panels! || k === "model" || k === "sliders"), t).toBe(true);
  });

  it("each part (param, readout, test, and every '<type>.<key>') has the same keys", () => {
    const common = TYPES.panels!;
    for (const [part, keys] of Object.entries(py.parts)) {
      if (py.authorOnly.includes(part)) continue;
      const shape =
        part in PANEL_PARTS
          ? itemShape(PANEL_PARTS[part] as Schema)
          : part === "param"
            ? itemShape(common.params!)
            : part === "readout"
              ? itemShape(common.readouts!)
              : part === "test"
                ? itemShape(common.tests!)
                : itemShape(TYPES[part.split(".")[0]!]![part.split(".")[1]!]!);
      expect(table(shape), part).toEqual(keys);
    }
  });

  it("every object-valued key in spec.ts has a part table in Python", () => {
    for (const [type, shape] of Object.entries(TYPES)) {
      for (const [key, s] of Object.entries(shape)) {
        if (key in py.common) continue;
        let inner = unwrap(s)[1];
        if (def(inner).type === "array") inner = def(inner).element!;
        if (def(inner).type === "object") expect(py.parts, `${type}.${key}`).toHaveProperty([`${type}.${key}`]);
      }
    }
  });
});

// Authoring keys that the exporter renames: `objective: 4, 6` becomes `objectives: [4, 6]`; a brief exports only its
// purpose. Their kinds differ by design, so only the names are compared.
const RENAMED: Record<string, string> = { objective: "objectives", brief: "purpose" };

describe("ir.ts mirrors vault_tool.py's BLOCK_KEYS, GOAL_KEYS and PREDICT_KEYS", () => {
  const py = python();
  const interactive = (Block as unknown as { options: Schema[] }).options.find((o) => (def(def(o).shape!.t!) as unknown as { values: string[] }).values[0] === "interactive")!;

  it("a placement takes the same keys as the interactive block", () => {
    const ir = table(def(interactive).shape!);
    delete ir.t;
    const authored = Object.fromEntries(Object.entries(py.block).map(([k, v]) => [RENAMED[k] ?? k, v]));
    expect(Object.keys(ir).sort()).toEqual(Object.keys(authored).sort());
    for (const [k, v] of Object.entries(py.block)) if (!(k in RENAMED)) expect(ir[k], k).toEqual(v);
  });

  it("goal and predict match key for key", () => {
    expect(table(def(Goal as unknown as Schema).shape!)).toEqual(py.goal);
    expect(table(def(Predict as unknown as Schema).shape!)).toEqual(py.predict);
  });
});
