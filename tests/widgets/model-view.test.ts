// Models and views end to end through vault_tool.py: a model note and a view of it, added to a copy of the fixture
// vault, check clean and export as one flat panels spec (the view) and a panels spec with no panels (the model's
// page); `npm run validate` then runs both sets of tests. Each authoring mistake the resolver catches is an error.
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Index } from "../../src/ir";
import { validateContent } from "../../src/validate";
import { REPO, scratchDir, vaultTool } from "../helpers";

const MODEL = `---
type: interactive
summary: A toy model for the model and view tests.
domain: macroeconomics
illustrates: ["[[Toy Growth Model]]"]
lessons: []
courses: []
---
# Toy Capital Model

## Spec

\`\`\`yaml
type: model
notation: "[[Toy Growth Model]]"
params:
  s:     {min: 0.05, max: 0.95, step: 0.01, default: 0.5}
  A:     {tex: "A", min: 0.5, max: 2, step: 0.05, default: 1}
  alpha: {tex: "\\\\alpha", min: 0.2, max: 0.8, step: 0.01, default: 0.5}
  delta: {tex: "\\\\delta", label: "Depreciation", min: 0.01, max: 0.2, step: 0.005, default: 0.1}
vars:
  k: {}
equations:
  f: "A*k^alpha"
  next_k: "s*f + (1-delta)*k"
derived:
  kbar: "(s*A/delta)^(1/(1-alpha))"
  cbar: "(1-s)*A*kbar^alpha"
tests:
  - params: {s: 0.5, A: 1, alpha: 0.5, delta: 0.1}
    at: {k: 100}
    expect: {kbar: 25, cbar: 2.5, f: 10, next_k: 95}
\`\`\`
`;

const VIEW = `---
type: interactive
summary: A toy view for the model and view tests.
domain: macroeconomics
illustrates: ["[[Toy Growth Model]]"]
---
# Toy Capital View

## Spec

\`\`\`yaml
type: view
model: "[[Toy Capital Model]]"
sliders: [s, delta]
params:
  s: {default: 0.3}
derived:
  kbar_lo: {of: kbar, with: {s: 0.2}}
panels:
  - kind: curve
    id: hill
    x: {sweep: s}
    y: {tex: "\\\\bar{c}", min: 0}
    curves:
      - {id: cbar_s, expr: cbar, tex: "\\\\bar{c}", mark: true}
tests:
  - params: {s: 0.5}
    expect: {kbar: 25, kbar_lo: 4, "cbar_s@0.5": 2.5}
    tol: 0.000001
\`\`\`
`;

let vault = "";
const write = (file: string, text: string) => writeFileSync(path.join(vault, "Interactives", file), text, "utf8");
const check = () => vaultTool("--vault", vault, "check");

beforeAll(() => {
  vault = path.join(scratchDir("mqe-model-view"), "vault");
  cpSync(path.join(REPO, "tests", "fixtures", "vault"), vault, { recursive: true });
  write("Toy Capital Model.md", MODEL);
  write("Toy Capital View.md", VIEW);
  const r = vaultTool("--vault", vault, "sync");
  if (r.status !== 0) throw new Error(r.out);
});

/** Check after one edit to a note, then put the note back. */
function checkWith(file: string, edit: (text: string) => string): string {
  const p = path.join(vault, "Interactives", file);
  const before = readFileSync(p, "utf8");
  writeFileSync(p, edit(before), "utf8");
  try {
    return check().out;
  } finally {
    writeFileSync(p, before, "utf8");
  }
}

describe("a model and a view of it", () => {
  it("check clean, export flat, and validate (both sets of tests run)", () => {
    const c = check();
    expect(c.out).toContain("0 error(s)");
    const out = path.join(path.dirname(vault), "content");
    const e = vaultTool("--vault", vault, "export", "--out", out);
    expect(e.status, e.out).toBe(0);
    const index = JSON.parse(readFileSync(path.join(out, "index.json"), "utf8")) as Index;
    const view = index.widgets["toy-capital-view"]!;
    expect(view.type).toBe("panels");
    expect(view.model).toBe("toy-capital-model");
    const spec = view.spec as Extract<Index["widgets"][string]["spec"], { type: "panels" }>;
    // sliders in the listed order; the others held at their default; the view overrides only the default
    expect(Object.keys(spec.params!)).toEqual(["s", "delta"]);
    expect(spec.fixed).toEqual({ A: 1, alpha: 0.5 });
    expect(spec.params!.s).toMatchObject({ min: 0.05, max: 0.95, default: 0.3 });
    // tex and label inherited from the notation note's row for s; the model's own label wins for delta
    expect(spec.params!.s).toMatchObject({ tex: "s", label: "Saving rate" });
    expect(spec.params!.delta).toMatchObject({ tex: "\\delta", label: "Depreciation" });
    expect(Object.keys(spec.derived!)).toEqual(["kbar", "cbar", "kbar_lo"]);
    expect(Object.keys(spec.equations!)).toEqual(["f", "next_k"]);
    const model = index.widgets["toy-capital-model"]!;
    expect(model.model).toBeUndefined();
    expect((model.spec as typeof spec).panels).toEqual([]);
    expect(validateContent(out).errors).toEqual([]);
  });

  it("a view overrides a model param's default, label or tex, never its range", () => {
    expect(checkWith("Toy Capital View.md", (t) => t.replace("s: {default: 0.3}", "s: {default: 0.3, max: 0.6}"))).toContain("params.s: unknown key 'max'");
    expect(checkWith("Toy Capital View.md", (t) => t.replace("s: {default: 0.3}", "s: {default: 1.5}"))).toContain("params.s: default 1.5 is outside the model's range [0.05, 0.95]");
  });

  it("a view adds names; it does not redefine the model's", () => {
    expect(checkWith("Toy Capital View.md", (t) => t.replace("  kbar_lo:", "  kbar: s\n  kbar_lo:"))).toContain("derived.kbar: the model already defines 'kbar'");
  });

  it("sliders name parameters of the view or its model", () => {
    expect(checkWith("Toy Capital View.md", (t) => t.replace("sliders: [s, delta]", "sliders: [s, zeta]"))).toContain("sliders: 'zeta' is not a parameter of the view or its model");
  });

  it("the model must exist and be a model note", () => {
    expect(checkWith("Toy Capital View.md", (t) => t.replace('model: "[[Toy Capital Model]]"', 'model: "[[Toy Nope]]"'))).toContain("model 'Toy Nope' has no note in Interactives/");
    expect(checkWith("Toy Capital View.md", (t) => t.replace('model: "[[Toy Capital Model]]"', 'model: "[[Toy Convergence]]"'))).toContain("model [[Toy Convergence]] is not a model note");
  });

  it("rebinding replaces model params only", () => {
    expect(checkWith("Toy Capital View.md", (t) => t.replace("with: {s: 0.2}", "with: {q: 0.2}"))).toContain("derived.kbar_lo.with: 'q' is not a parameter of the model");
  });

  it("a placement names a view, never the model itself", () => {
    const lecture = path.join(vault, "Courses", "Toy 101", "Lectures", "Toy 101 L1 Growth.md");
    const before = readFileSync(lecture, "utf8");
    writeFileSync(lecture, `${before}\n\`\`\`interactive\nwidget: Toy Capital Model\n\`\`\`\n`, "utf8");
    try {
      expect(check().out).toContain("names model 'Toy Capital Model', which is not placeable - place one of its views (Toy Capital View)");
    } finally {
      writeFileSync(lecture, before, "utf8");
    }
  });

  it("a param with no tex and no notation row is an error", () => {
    expect(checkWith("Toy Capital Model.md", (t) => t.replace("  s:     {min:", "  zeta:  {min:").replace("{s: 0.5, A: 1", "{A: 1"))).toContain("params.zeta needs tex (no row of [[Toy Growth Model]]'s Notation table matches 'zeta')");
  });
});
