// The input layer: typed syntax, the notation-aware tokenizer, the LaTeX subset, the preview and its errors.
import { describe, expect, it } from "vitest";
import { declare, parseDeriveCallout, preview, type SymbolTable } from "../../src/derive";

const solow = declare({ symbols: "s, A, alpha in (0.2,0.8), delta, k_t, k_{t+1}, kbar" });
const ols = declare({ dims: "n", data: "x_i, y_i", unknowns: "b_1 real, b_2 real" });
const mx = declare({ dims: "n > K", matrices: "X: n×K", define: ["P = X(X'X)^{-1}X'", "M = I_n - P"] });
const accents = declare({ symbols: String.raw`\hat{\beta}, \tilde{k}, \sigma, e, g` });

function reads(table: SymbolTable, cases: [string, string][]) {
  for (const [input, latex] of cases) expect(preview(input, table), input).toEqual({ ok: true, latex });
}

describe("typed syntax", () => {
  it("reads the scope's examples", () => {
    reads(solow, [
      ["k_(t+1) = s A k_t^alpha + (1-delta) k_t", String.raw`k_{t+1} = s\,A\,k_{t}^{\alpha} + \left(1 - \delta\right)\,k_{t}`],
      ["kbar = (s*A/δ)^(1/(1-α))", String.raw`\bar{k} = \left(\frac{s\,A}{\delta}\right)^{\frac{1}{1 - \alpha}}`],
    ]);
    reads(ols, [
      ["b_2 = sum((x_i - xbar)*(y_i - ybar))/sum((x_i-xbar)^2)", String.raw`b_{2} = \frac{\sum_{i} \left(\left(x_{i} - \bar{x}\right)\,\left(y_{i} - \bar{y}\right)\right)}{\sum_{i} \left(x_{i} - \bar{x}\right)^{2}}`],
    ]);
    reads(mx, [
      ["M X = 0", String.raw`\mathbf{M}\,\mathbf{X} = 0`],
      ["X'X", String.raw`\mathbf{X}'\,\mathbf{X}`],
    ]);
  });

  it("splits implicit products against the declared symbols", () => {
    reads(solow, [
      ["sAk_t", String.raw`s\,A\,k_{t}`],
      ["sAkbar^alpha", String.raw`s\,A\,\bar{k}^{\alpha}`],
      ["alphak_t", String.raw`\alpha\,k_{t}`],
      ["δk̄", String.raw`\delta\,\bar{k}`],
    ]);
    reads(mx, [["MX", String.raw`\mathbf{M}\,\mathbf{X}`]]);
    reads(ols, [["sum(b_2x_i)", String.raw`\sum_{i} \left(b_{2}\,x_{i}\right)`]]);
  });

  it("accepts every spelling of bars, accents, Greek and subscripts", () => {
    reads(solow, [
      ["kbar", String.raw`\bar{k}`],
      ["k̄", String.raw`\bar{k}`],
      [String.raw`\bar{k}`, String.raw`\bar{k}`],
      [String.raw`\bar k`, String.raw`\bar{k}`],
      [String.raw`\overline{k}`, String.raw`\bar{k}`],
      ["k_t", "k_{t}"],
      ["k_(t+1)", "k_{t+1}"],
      ["k_{t+1}", "k_{t+1}"],
      ["k_{t + 1}", "k_{t+1}"],
      ["alpha", String.raw`\alpha`],
      ["α", String.raw`\alpha`],
      [String.raw`\alpha`, String.raw`\alpha`],
    ]);
    reads(accents, [
      [String.raw`\hat{\beta}`, String.raw`\hat{\beta}`],
      ["betahat", String.raw`\hat{\beta}`],
      ["β̂", String.raw`\hat{\beta}`],
      ["ktilde", String.raw`\tilde{k}`],
      ["k̃", String.raw`\tilde{k}`],
      ["σ^2", String.raw`\sigma^{2}`],
    ]);
    reads(ols, [["b₂", "b_{2}"]]);
  });

  it("takes the usual typing shortcuts", () => {
    reads(solow, [
      ["s**2", "s^{2}"],
      ["e^s", "e^{s}"],
    ]);
    reads(ols, [["b2", "b_{2}"]]);
    reads(mx, [["M X = 0_n", String.raw`\mathbf{M}\,\mathbf{X} = 0`]]);
  });

  it("shows the reading where precedence could surprise", () => {
    reads(solow, [
      ["1/2k_t", String.raw`\frac{1}{2k_{t}}`],
      ["s A/delta kbar", String.raw`\frac{s\,A}{\delta\,\bar{k}}`],
      ["k_t+1", String.raw`k_{t} + 1`],
      ["-k_t^2", String.raw`-k_{t}^{2}`],
      ["ln(kbar)^2", String.raw`\ln\left(\bar{k}\right)^{2}`],
      [String.raw`\ln \bar{k}^2`, String.raw`\ln\left(\bar{k}^{2}\right)`],
    ]);
    reads(ols, [
      ["sum(x)^2", String.raw`\left(\sum_{i} x_{i}\right)^{2}`],
      [String.raw`\sum (x_i - \bar{x})^2`, String.raw`\sum_{i} \left(x_{i} - \bar{x}\right)^{2}`],
      ["nsum(x)", String.raw`n\,\left(\sum_{i} x_{i}\right)`],
    ]);
  });
});

describe("unknown symbols", () => {
  const error = (table: SymbolTable, input: string) => {
    const p = preview(input, table);
    if (p.ok) throw new Error(`${input} parsed`);
    return p;
  };
  it("suggests the symbol the student probably meant", () => {
    expect(error(solow, "kt")).toMatchObject({ suggestions: ["k_t"], error: expect.stringMatching(/Did you mean k_t\?/) });
    expect(error(solow, "k").suggestions).toEqual(["k_{t+1}", "k_t", "kbar"]);
    expect(error(solow, "alpah").suggestions).toEqual(["alpha"]);
    expect(error(solow, "Kbar").suggestions).toEqual(["kbar"]);
  });
  it("isolates the unknown letters inside an implicit product", () => {
    expect(error(solow, "sAq").error).toBe('I don\'t know the symbol "q" (in "sAq"). Did you mean A or s?');
  });
  it("explains data symbols used outside a sum", () => {
    expect(error(ols, "b_2 x_i").error).toMatch(/x_i only makes sense inside a sum/);
  });
  it("reports malformed lines", () => {
    expect(error(solow, "(s").error).toBe('a "(" is not closed');
    expect(error(solow, "s)").error).toBe('an extra ")"');
    expect(error(solow, "s = A = k_t").error).toMatch(/one equation per line/);
    expect(error(solow, "").error).toBe("the line is empty");
    expect(error(solow, String.raw`\int s`).error).toMatch(/isn't supported/);
  });
});

describe("LaTeX subset", () => {
  it("reads every construct authors use", () => {
    reads(solow, [
      [String.raw`\frac{sA}{\delta}`, String.raw`\frac{s\,A}{\delta}`],
      [String.raw`k_t^{\alpha}`, String.raw`k_{t}^{\alpha}`],
      [String.raw`k_{t+1}`, "k_{t+1}"],
      [String.raw`\left(\frac{sA}{\delta}\right)^{\frac{1}{1-\alpha}}`, String.raw`\left(\frac{s\,A}{\delta}\right)^{\frac{1}{1 - \alpha}}`],
      [String.raw`\ln \bar{k}`, String.raw`\ln\left(\bar{k}\right)`],
      [String.raw`\exp\left(\frac{1}{1-\alpha}\right)`, String.raw`\exp\left(\frac{1}{1 - \alpha}\right)`],
      [String.raw`\sqrt{sA}`, String.raw`\sqrt{s\,A}`],
      [String.raw`s \cdot A`, String.raw`s\,A`],
      [String.raw`s\,A`, String.raw`s\,A`],
    ]);
    reads(ols, [
      [String.raw`\sum_{i=1}^{n} x_i^2`, String.raw`\sum_{i} x_{i}^{2}`],
      ["Σxᵢ²", String.raw`\sum_{i} x_{i}^{2}`],
      [String.raw`\bar{x}`, String.raw`\bar{x}`],
    ]);
    reads(mx, [
      [String.raw`(\mathbf{X}'\mathbf{X})^{-1}`, String.raw`\left(\mathbf{X}'\,\mathbf{X}\right)^{-1}`],
      [String.raw`\mathbf{X}^\top\mathbf{X}`, String.raw`\mathbf{X}'\,\mathbf{X}`],
      ["X^T X", String.raw`\mathbf{X}'\,\mathbf{X}`],
      ["X^{T}", String.raw`\mathbf{X}'`],
      [String.raw`\mathrm{trace}(\mathbf{M})`, String.raw`\operatorname{tr}\left(\mathbf{M}\right)`],
      [String.raw`\operatorname{tr}(M)`, String.raw`\operatorname{tr}\left(\mathbf{M}\right)`],
      [String.raw`\mathbf{I}_n - \mathbf{P}`, String.raw`\mathbf{I}_{n} - \mathbf{P}`],
      [String.raw`\mathbf{M}\mathbf{X} = \mathbf{0}`, String.raw`\mathbf{M}\,\mathbf{X} = 0`],
    ]);
  });
});

describe("derive callouts", () => {
  it("reads steps from the last $…$ on the line and attaches accept and reject lines", () => {
    const c = parseDeriveCallout(String.raw`> [!derive]- Solve for $\bar{k}$
> objective: 4
> symbols: $s$, $A$, $\alpha \in (0.2, 0.8)$, $\delta$
> unknowns: $\bar{k}$
> 1. Set $k_{t+1} = k_t = \bar{k}$ and cancel: $sA\bar{k}^{\alpha} = \delta\bar{k}$
> 2. $\bar{k} = (sA/\delta)^{1/(1-\alpha)}$
>
> accept: $\bar{k}^{1-\alpha} = sA/\delta$
> reject: $\bar{k} = (sA/\delta)^{1/\alpha}$ — the power is $1/(1-\alpha)$`);
    expect(c.title).toBe(String.raw`Solve for $\bar{k}$`);
    expect(c.objective).toBe(4);
    expect(c.derivation.steps).toHaveLength(2);
    expect(c.derivation.accept).toHaveLength(1);
    expect(c.derivation.reject[0]!.message).toBe(String.raw`the power is $1/(1-\alpha)$`);
    expect(c.derivation.table.get("alpha")!.domain).toEqual({ kind: "range", lo: 0.2, hi: 0.8 });
  });
  it("names the line that fails", () => {
    expect(() => parseDeriveCallout("> [!derive]- x\n> symbols: $s$\n> 1. $s = q$")).toThrow(/step 1 "s = q": I don't know the symbol "q"/);
    expect(() => parseDeriveCallout("> [!derive]- x\n> frobnicate: 1")).toThrow(/line 2: unknown key "frobnicate"/);
  });
});
