// Notation matching: the TypeScript port must key symbols exactly as vault_tool.py does, so a slider finds the
// row the exporter attached for it.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { NotationRow } from "../../src/ir";
import { notationFor, rowKeys, texNorm, texSymbols } from "../../src/widgets/notation";
import { exportFixture, REPO } from "../helpers";

const SAMPLES = [
  "k", "k_t", "k_t^*", "k^*", "k^{*}", "\\bar{k}", "\\bar k", "\\overline{y}", "\\hat{\\beta}_1", "\\tilde{\\gamma}",
  "\\mathbf{X}", "\\boldsymbol{\\beta}", "\\mathbb{E}", "\\alpha", "α", "ᾱ", "k′", "y'", "sf(k)", "\\delta k", "(n+\\delta)k",
  "\\ln y_t", "g_y", "\\text{SSR}", "R^2", "y = Ak^{\\alpha}", "\\frac{s}{n+\\delta}", "\\sigma^2_\\varepsilon", "x_{t+1}",
  "\\left( \\frac{sA}{\\delta} \\right)^{1/(1-\\alpha)}", "c^\\ast", "\\bar{k}^*",
];
const CELLS = [
  "$k$", "$\\bar{k}$, $\\bar{c}$", "$sf(k)$", "$\\delta k$", "$f(k) = Ak^{\\alpha}$", "$Y_t = K_t^{\\alpha}(A_t L_t)^{1-\\alpha}$", "$\\hat\\beta_0$, $\\hat\\beta_1$", "s", "Saving rate $s$ (share)",
  // One math run listing several symbols splits on its top-level commas only, never inside (), [], {} or a subscript.
  "$k^*, y^*, c^*$", "$a,b$", "$\\bar{k}, \\tilde{k}$", "$\\hat\\beta_0, \\hat\\beta_1$", "$\\sigma^2, \\sigma$", "$s, \\delta$ (rates)",
  "$\\alpha, \\beta = 1$", "$f(x, y)$", "$f(k, h) = k$", "$\\{a, b\\}$", "$[a, b)$, $c$", "$x_{i,t}$, $y$", "$\\varepsilon_i, u_i$",
];

function python(): { symbols: string[][]; norms: string[]; keys: string[][] } | null {
  const cfg = JSON.parse(readFileSync(path.join(REPO, "mqe.config.json"), "utf8")) as { vault: string; python?: string };
  const meta = path.join(process.env.MQE_VAULT ?? cfg.vault, "_meta");
  const code = [
    "import json, sys",
    "sys.path.insert(0, sys.argv[1])",
    "import vault_tool as v",
    "d = json.loads(sys.stdin.read())",
    "print(json.dumps({'symbols': [list(v.tex_symbols(t)) for t in d['tex']], 'norms': [v.tex_norm(t) for t in d['tex']], 'keys': [list(v.row_keys(c)) for c in d['cells']]}))",
  ].join("\n");
  const r = spawnSync(process.env.MQE_PYTHON ?? cfg.python ?? "python", ["-c", code, meta], {
    input: JSON.stringify({ tex: SAMPLES, cells: CELLS }),
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" },
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

describe("TeX symbol keys", () => {
  it("normalizes decorations, stars, Greek and subscripts", () => {
    expect(texSymbols("k_t^*")).toEqual(["k*"]);
    expect(texSymbols("\\bar{k}")).toEqual(["bar(k)"]);
    expect(texSymbols("ᾱ")).toEqual(["bar(alpha)"]);
    expect(texSymbols("\\mathbf{X}")).toEqual(["bold(X)"]);
    expect(texSymbols("\\text{SSR} + R^2")).toEqual(["R"]);
    expect(texNorm("\\delta  k")).toBe("\\deltak");
    expect(rowKeys("$f(k) = Ak^{\\alpha}$")).toEqual(["f"]);
    expect(rowKeys("$\\bar{k}$, $\\bar{c}$")).toEqual(["bar(k)", "bar(c)"]);
    expect(rowKeys("$sf(k)$")).toEqual(["~sf(k)"]);
  });

  it("matches vault_tool.py on every sample", () => {
    const py = python()!;
    expect(SAMPLES.map(texSymbols)).toEqual(py.symbols);
    expect(SAMPLES.map(texNorm)).toEqual(py.norms);
    expect(CELLS.map(rowKeys)).toEqual(py.keys);
  });

  it("re-derives the keys the exporter wrote for the fixture's notation rows", () => {
    const index = JSON.parse(readFileSync(path.join(exportFixture(), "index.json"), "utf8")) as { widgets: Record<string, { notation: NotationRow[] }> };
    const rows = Object.values(index.widgets).flatMap((w) => w.notation);
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) expect(rowKeys(r.tex), r.tex).toEqual(r.keys);
  });
});

describe("notationFor", () => {
  const row = (tex: string, meaning: string): NotationRow => ({ tex, meaning, kind: "Parameter", typical: "—", keys: rowKeys(tex) });
  const rows = [
    row("$k$", "Capital per worker"),
    row("$s$", "Saving rate"),
    row("$\\delta$", "Depreciation rate"),
    row("$\\bar{k}$, $\\bar{c}$", "Steady-state capital and consumption"),
    row("$sf(k)$", "Investment per worker"),
    row("$\\delta k$", "Depreciation per worker"),
    row("$f(k) = Ak^{\\alpha}$", "Output as a function of capital"),
  ];
  const meaning = (tex: string) => notationFor(rows, tex)?.meaning;

  it("finds a parameter's row by its symbol", () => {
    expect(meaning("s")).toBe("Saving rate");
    expect(meaning("\\delta")).toBe("Depreciation rate");
    expect(meaning("k_t")).toBe("Capital per worker");
    expect(meaning("\\bar{c}")).toBe("Steady-state capital and consumption");
  });

  it("prefers the row keyed by a whole expression or its head symbol over one it merely mentions", () => {
    expect(meaning("\\delta k")).toBe("Depreciation per worker");
    expect(meaning("sf(k)")).toBe("Investment per worker");
    expect(meaning("f(k)")).toBe("Output as a function of capital");
  });

  it("returns nothing for an unknown or missing symbol", () => {
    expect(meaning("\\gamma")).toBeUndefined();
    expect(notationFor(rows, undefined)).toBeUndefined();
  });
});
