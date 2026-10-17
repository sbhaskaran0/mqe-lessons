// Symbol hover inside rendered math: which TeX gets wrapped in \htmlClass{sym sym-<row>}, and that KaTeX renders it.
import katex from "katex";
import { describe, expect, it } from "vitest";
import { createMarkdown, mathWithSymbols, symbolIndex, wrapSymbols } from "../../src/content/markdown";
import type { NotationRow } from "../../src/ir";

const row = (tex: string, keys: string[], meaning = "m"): NotationRow => ({ tex, meaning, kind: "k", typical: "—", keys });

// Index:              0      1           2        3        4                   5         6       7         8
const ROWS: NotationRow[] = [
  row("$k$", ["k"]),
  row("$\\bar{k}$, $\\bar{y}$", ["bar(k)", "bar(y)"], "Steady-state values"),
  row("$\\alpha$", ["alpha"]),
  row("$s$", ["s"]),
  row("$\\tilde{\\gamma}$", ["tilde(gamma)"]),
  row("$k^*$", ["k*"]),
  row("$sf(k)$", ["~sf(k)"]),
  row("$\\mathbf{X}$", ["bold(X)"]),
  row("$e$", ["e"]),
];
const IX = symbolIndex(ROWS);
const w = (tex: string) => wrapSymbols(tex, IX);
const sym = (n: number, s: string) => `{\\htmlClass{sym sym-${n}}{${s}}}`;

describe("symbolIndex", () => {
  it("maps each plain key to the first row that defines it and skips compound keys", () => {
    expect(IX.get("k")).toBe(0);
    expect(IX.get("bar(y)")).toBe(1);
    expect(IX.get("k*")).toBe(5);
    expect([...IX.keys()].some((k) => k.startsWith("~"))).toBe(false);
  });
});

describe("wrapSymbols", () => {
  it("wraps a decorated symbol as one unit", () => {
    expect(w("\\bar{k} = 25")).toBe(`${sym(1, "\\bar{k}")} = 25`);
    expect(w("\\tilde{\\gamma}")).toBe(sym(4, "\\tilde{\\gamma}"));
  });

  it("does not explain a decorated symbol with its base's row", () => {
    // \hat{k} is not k, and no row defines it.
    expect(w("\\hat{k}")).toBe("\\hat{k}");
  });

  it("wraps a subscripted base with its subscript", () => {
    expect(w("k_t")).toBe(sym(0, "k_t"));
    expect(w("k_{t+1} = s y_t")).toBe(`${sym(0, "k_{t+1}")} = ${sym(3, "s")} y_t`);
  });

  it("matches a starred symbol to its own row", () => {
    expect(w("k^*")).toBe(sym(5, "k^*"));
    expect(w("k_t^{*}")).toBe(sym(5, "k_t^{*}"));
  });

  it("wraps Greek commands, including inside \\frac", () => {
    expect(w("\\alpha")).toBe(sym(2, "\\alpha"));
    expect(w("\\frac{\\alpha}{1-\\alpha}")).toBe(`\\frac{${sym(2, "\\alpha")}}{1-${sym(2, "\\alpha")}}`);
    // A bare argument gets braces of its own, so \frac\alpha k stays a two-argument \frac.
    expect(w("\\frac\\alpha k")).toBe(`\\frac${sym(2, "\\alpha")} ${sym(0, "k")}`);
  });

  it("keeps an exponent that holds symbols outside the base's wrapper", () => {
    expect(w("k^{\\alpha}")).toBe(`${sym(0, "k")}^{${sym(2, "\\alpha")}}`);
    expect(w("k_t^\\alpha")).toBe(`${sym(0, "k")}_t^${sym(2, "\\alpha")}`);
    // A numeric exponent belongs to the symbol.
    expect(w("k^2")).toBe(sym(0, "k^2"));
  });

  it("does not wrap inside \\text{} and friends, or words", () => {
    expect(w("\\text{for all } k")).toBe(`\\text{for all } ${sym(0, "k")}`);
    expect(w("\\mathrm{e} + \\operatorname{Var}(e)")).toBe(`\\mathrm{e} + \\operatorname{Var}(${sym(8, "e")})`);
    expect(w("\\ln(wage) = 1.6 + 0.09\\,educ")).toBe("\\ln(wage) = 1.6 + 0.09\\,educ");
  });

  it("treats font styles as part of the symbol", () => {
    expect(w("\\mathbf{X}'\\mathbf{X}")).toBe(`${sym(7, "\\mathbf{X}'")}${sym(7, "\\mathbf{X}")}`);
  });

  it("leaves array column specs alone", () => {
    expect(w("\\begin{array}{ks} k \\end{array}")).toBe(`\\begin{array}{ks} ${sym(0, "k")} \\end{array}`);
  });

  it("is idempotent", () => {
    for (const tex of ["\\bar{k} = \\left(\\frac{s}{\\delta}\\right)^{1/(1-\\alpha)}", "k_t^*", "\\frac{\\alpha}{k}", "sf(k) = \\delta k"]) {
      const once = w(tex);
      expect(w(once)).toBe(once);
    }
  });

  it("leaves TeX with no notation symbols unchanged", () => {
    expect(w("1 + 2 = 3")).toBe("1 + 2 = 3");
    expect(wrapSymbols("k", new Map())).toBe("k");
  });
});

describe("rendering", () => {
  it("KaTeX renders the wrapper as a span with the row's class and no error", () => {
    const html = mathWithSymbols("\\bar{k} = \\left(\\frac{s A}{\\delta}\\right)^{\\frac{1}{1-\\alpha}}", true, IX);
    expect(html).toContain('class="enclosing sym sym-1"');
    expect(html).toContain("sym sym-2");
    expect(html).not.toContain("katex-error");
  });

  it("falls back to the plain rendering when nothing matches", () => {
    expect(mathWithSymbols("1+1", false, IX)).toBe(katex.renderToString("1+1", { throwOnError: false, strict: "ignore", output: "htmlAndMathml" }));
  });

  it("trusts \\htmlClass only", () => {
    const html = mathWithSymbols("k + \\href{https://example.com}{x}", false, IX);
    expect(html).toContain("sym sym-0");
    expect(html).not.toContain("<a ");
  });

  it("wraps math in prose, tables and display math for a note, and caches per note", () => {
    const md = createMarkdown({ noteHref: (s) => `#/note/${s}`, assetUrl: (s) => s });
    const note = md.withNotation(ROWS);
    expect(md.withNotation(ROWS)).toBe(note);
    expect(md.withNotation([])).toBe(md);
    expect(note.inline("Capital $k_t$ grows")).toContain("sym sym-0");
    expect(note.block("| a | b |\n| - | - |\n| $\\bar{k}$ | 1 |")).toContain("sym sym-1");
    expect(note.block("$$\\alpha k$$")).toContain("sym sym-2");
    expect(note.math("\\bar{y}", true)).toContain("sym sym-1");
    // The plain renderer is untouched.
    expect(md.inline("Capital $k_t$ grows")).not.toContain("sym-");
  });
});
