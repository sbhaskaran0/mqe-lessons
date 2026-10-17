// The E1 interface the platform calls: fromIR, selfTest (run by `npm run validate` on every derive block), check and
// preview, plus Notation-table inheritance and the hardening of the prototype's failure modes.
import { describe, expect, it } from "vitest";
import {
  calloutToIR,
  check,
  classify,
  type DeriveBlockIR,
  DeriveIRError,
  domainFromTypical,
  fromIR,
  initialState,
  preview,
  rowNames,
  selfTest,
  type Verdict,
} from "../../src/derive";
import { fixtures, residualMaker, solow } from "./fixtures";

const label = (v: Verdict) => (v.kind === "milestone" ? `milestone ${v.step}` : v.kind);

/** A copy of a fixture's IR with some fields changed. */
function edit(ir: DeriveBlockIR, change: (ir: DeriveBlockIR) => void): DeriveBlockIR {
  const copy = structuredClone(ir);
  change(copy);
  return copy;
}

const solowWithHints = calloutToIR(String.raw`> [!derive]- Solve for the steady state $\bar{k}$
> objective: 4, 6
> symbols: $s \in (0.05, 0.95)$, $A$, $\alpha \in (0.2, 0.8)$, $\delta \in (0.02, 0.2)$, $k_t$, $k_{t+1}$
> unknowns: $\bar{k}$
> given: $k_{t+1} = sAk_t^{\alpha} + (1-\delta)k_t$
>
> 1. Set $k_{t+1} = k_t = \bar{k}$: $\bar{k} = sA\bar{k}^{\alpha} + (1-\delta)\bar{k}$
>    hint: In the steady state $k_{t+1} = k_t$.
> 2. Why can we divide by $\bar{k}$? $\bar{k} > 0$ so $sA\bar{k}^{\alpha - 1} = \delta$
>    justify: Why is dividing by $\bar{k}$ allowed?
>    - [ ] Because $\alpha < 1$
>    - [x] Because the steady state we want has $\bar{k} > 0$
> 3. Cancel $(1-\delta)\bar{k}$: $sA\bar{k}^{\alpha} = \delta\bar{k}$
>    hint: Subtract $(1-\delta)\bar{k}$ from both sides.
> 4. $\bar{k} = \left(\frac{sA}{\delta}\right)^{\frac{1}{1-\alpha}}$
>    hint: Divide by $\delta\bar{k}^{\alpha}$.
>
> accept: $\bar{k}^{1-\alpha} = \frac{sA}{\delta}$
> reject: $\bar{k} = (sA/\delta)^{1/\alpha}$ — dividing by $\bar{k}^{\alpha}$ leaves $\bar{k}^{1-\alpha}$`);

describe("fromIR", () => {
  it("builds every fixture, with one milestone per typed step and the target last", () => {
    for (const f of fixtures) {
      const rt = fromIR(f.ir);
      expect(rt.title).toBe(f.callout.title);
      expect(rt.milestones).toEqual(f.ir.steps.map((_, i) => i));
      expect(rt.derivation.steps).toHaveLength(f.ir.steps.length);
      expect(rt.derivation.reject.map((r) => r.message)).toEqual(f.ir.reject.map((r) => r.md));
    }
  });

  it("carries hints and justify steps, which are shown but are not milestones", () => {
    const rt = fromIR(solowWithHints);
    expect(rt.objectives).toEqual([4, 6]);
    expect(rt.milestones).toEqual([0, 2, 3]);
    expect(rt.steps.map((s) => s.milestone)).toEqual([1, undefined, 2, 3]);
    expect(rt.steps[1]!.justify).toEqual({
      prompt: String.raw`Why is dividing by $\bar{k}$ allowed?`,
      options: [
        { md: String.raw`Because $\alpha < 1$`, correct: false },
        { md: String.raw`Because the steady state we want has $\bar{k} > 0$`, correct: true },
      ],
    });
    expect(rt.steps[1]!.statement).toBeDefined();
    expect(rt.steps[0]!.hint).toBe(String.raw`In the steady state $k_{t+1} = k_t$.`);
    expect(selfTest(solowWithHints)).toEqual([]);
  });

  it("throws one DeriveIRError listing every problem", () => {
    const bad = edit(solow.ir, (ir) => {
      ir.steps[0]!.tex = "s = q";
      ir.accept.push("r = 1");
    });
    expect(() => fromIR(bad)).toThrow(DeriveIRError);
    try {
      fromIR(bad);
    } catch (e) {
      expect((e as DeriveIRError).problems).toEqual([
        'step 1 "s = q": I don\'t know the symbol "q". Did you mean A or s? — add it to symbols:',
        'accept 2 "r = 1": I don\'t know the symbol "r". Did you mean A or s? — add it to symbols:',
      ]);
    }
  });

  it("reads reject messages whether md is the message or the whole line", () => {
    const whole = edit(solow.ir, (ir) => {
      ir.reject[0]!.md = `$${ir.reject[0]!.tex}$ — ${ir.reject[0]!.md}`;
    });
    expect(fromIR(whole).derivation.reject[0]!.message).toBe(solow.ir.reject[0]!.md);
  });

  it("strips $…$ from fields an exporter may leave wrapped", () => {
    const wrapped = edit(solow.ir, (ir) => {
      ir.given = ir.given.map((g) => `$${g}$`);
      ir.steps = ir.steps.map((s) => ({ ...s, tex: `$${s.tex}$` }));
    });
    expect(selfTest(wrapped)).toEqual([]);
  });
});

describe("selfTest", () => {
  it("passes every fixture under several seeds", () => {
    for (const f of fixtures) for (const seed of [1, 2, 3, 4, 5]) expect(selfTest(f.ir, { seed }), `${f.name} seed ${seed}`).toEqual([]);
  });

  it("fails on an accept form that does not reach the target", () => {
    const bad = edit(solow.ir, (ir) => ir.accept.push(String.raw`\bar{k}^{\alpha} = \frac{sA}{\delta}`));
    expect(selfTest(bad)).toEqual([String.raw`accept 2 "\bar{k}^{\alpha} = \frac{sA}{\delta}": should reach the target but classifies as error ("dividing by $\bar{k}^{\alpha}$ leaves $\bar{k}^{1-\alpha}$, so the power is $1/(1-\alpha)$")`]);
  });

  it("fails on an accept form that is a milestone, not the target", () => {
    const bad = edit(solow.ir, (ir) => ir.accept.push(String.raw`sA\bar{k}^{\alpha} = \delta\bar{k}`));
    expect(selfTest(bad)).toEqual([String.raw`accept 2 "sA\bar{k}^{\alpha} = \delta\bar{k}": is the same step as step 1, so typing step 1 would already count as reaching the target`]);
  });

  it("fails on reject forms that are true, equivalent to the target, or shadowed", () => {
    const bad = edit(solow.ir, (ir) => {
      ir.reject.push({ tex: String.raw`\bar{k}^{1-\alpha} = sA/\delta`, md: "wrong" });
      ir.reject.push({ tex: String.raw`sA\bar{k}^{\alpha} = \delta\bar{k}`, md: "wrong" });
      ir.reject.push({ tex: String.raw`\bar{k} = (sA/\delta)^{1/\alpha}`, md: "a second message" });
    });
    expect(selfTest(bad)).toEqual([
      String.raw`reject 6 "\bar{k}^{1-\alpha} = sA/\delta": is equivalent to the target, so it can never be shown — fix or remove it`,
      String.raw`reject 7 "sA\bar{k}^{\alpha} = \delta\bar{k}": is true (it classifies as milestone 2), so it can never be shown — fix or remove it`,
      String.raw`reject 8 "\bar{k} = (sA/\delta)^{1/\alpha}": shows the message of reject 1 instead, which matches it first — merge them or reorder`,
    ]);
  });

  it("fails on a step that does not follow from the lines before it", () => {
    const bad = edit(solow.ir, (ir) => ir.steps.splice(1, 0, { md: "", tex: String.raw`sA\bar{k}^{\alpha} = 2\delta\bar{k}` }));
    expect(selfTest(bad)).toEqual([
      String.raw`step 2 "sA\bar{k}^{\alpha} = 2\delta\bar{k}": doesn't follow from the givens and the steps before it — check the algebra, or add the missing fact as a given:`,
    ]);
  });

  it("names unknown symbols and points at the Notation table when rows are inherited", () => {
    const bad = edit(solow.ir, (ir) => {
      ir.steps[1]!.tex = "s = q";
      ir.inherited = [{ tex: "$A$", typical: "1", from: "solow-growth-model" }];
    });
    expect(selfTest(bad)).toEqual(['step 2 "s = q": I don\'t know the symbol "q". Did you mean A or s? — add it to symbols: or to the Notation table of a linked note']);
  });

  it("checks that domains can be sampled and steps evaluated", () => {
    expect(selfTest(edit(solow.ir, (ir) => (ir.symbols[2] = String.raw`\alpha \in (0.8, 0.2)`)))).toEqual(["symbols: alpha has an empty range (0.8, 0.2)"]);
    const shape = edit(residualMaker.ir, (ir) => ir.steps.splice(1, 0, { md: "", tex: String.raw`\mathbf{X}\mathbf{M} = \mathbf{0}` }));
    expect(selfTest(shape)).toEqual([expect.stringMatching(/^step 2 "\\mathbf\{X\}\\mathbf\{M\} = \\mathbf\{0\}": can't be evaluated: can't multiply a \d+×\d+ matrix by a \d+×\d+ matrix$/)]);
  });

  it("checks justify steps for a right answer, but not their maths", () => {
    const noRight = edit(solowWithHints, (ir) => ir.steps[1]!.justify!.options.forEach((o) => (o.correct = false)));
    expect(selfTest(noRight)).toEqual(["step 2: justify needs '- [x]' on the right option"]);
    // E[·] is not algebra the checker reads; on a justify step that is fine.
    const expectation = edit(solowWithHints, (ir) => (ir.steps[1]!.tex = String.raw`E[\bar{k} \mid s] = \bar{k}`));
    expect(selfTest(expectation)).toEqual([]);
  });

  it("reports declaration problems by line", () => {
    const bad = edit(residualMaker.ir, (ir) => (ir.define[1] = String.raw`\mathbf{M} = \mathbf{I}_n - \mathbf{Q}`));
    expect(selfTest(bad)).toEqual([expect.stringMatching(/^define 2 "\\mathbf\{M\} = \\mathbf\{I\}_n - \\mathbf\{Q\}": I don't know the symbol "Q"/)]);
  });
});

describe("check", () => {
  const rt = fromIR(solowWithHints);

  it("walks the path: milestone, no progress, error, target", () => {
    let state = initialState();
    let r = check(rt, state, "kbar = s A kbar^alpha + (1 - delta) kbar");
    // Rearrangements share a solution set, so step 1 reads as reaching the furthest equivalent step (memo limit 1).
    expect(r.verdict).toMatchObject({ kind: "milestone", step: 2, index: 2, stepHint: String.raw`Divide by $\delta\bar{k}^{\alpha}$.` });
    expect(r.state).toEqual({ lines: ["kbar = s A kbar^alpha + (1 - delta) kbar"], reached: 2, done: false });
    state = r.state;

    r = check(rt, state, "sAkbar^alpha = delta kbar");
    expect(r.verdict.kind).toBe("valid-no-progress");
    expect(r.state.lines).toHaveLength(2);
    state = r.state;

    r = check(rt, state, "kbar = (sA/delta)^(1/alpha)");
    expect(r.verdict).toMatchObject({ kind: "error", reject: 0, stepHint: String.raw`Divide by $\delta\bar{k}^{\alpha}$.` });
    expect(r.state).toBe(state);

    r = check(rt, state, "kbar = (sA/delta)^(1/(1-alpha))");
    expect(r.verdict).toMatchObject({ kind: "target", index: 3 });
    expect(r.state).toMatchObject({ reached: 3, done: true });
    expect(JSON.parse(JSON.stringify(r.state))).toEqual(r.state);
  });

  it("offers the next step's hint from the start", () => {
    expect(check(rt, initialState(), "kbar = 1").verdict).toMatchObject({ kind: "error", stepHint: String.raw`In the steady state $k_{t+1} = k_t$.` });
  });

  it("says when there is nothing to type", () => {
    const mcOnly = edit(solowWithHints, (ir) => (ir.steps = [ir.steps[1]!]));
    expect(check(fromIR(mcOnly), initialState(), "kbar = 1").verdict.kind).toBe("error");
  });

  it("agrees with classify on every fixture form", () => {
    for (const f of fixtures) {
      const r = fromIR(f.ir);
      for (const [src, want] of f.accept) expect(label(check(r, initialState(), src).verdict), src).toBe(want);
      for (const [src] of f.reject) expect(check(r, initialState(), src).verdict.kind, src).toBe("error");
    }
  });
});

describe("preview", () => {
  const rt = fromIR(solow.ir);

  it("reads a line with the runtime or its table", () => {
    expect(preview("sAkbar^alpha = delta kbar", rt)).toEqual({ ok: true, latex: String.raw`s\,A\,\bar{k}^{\alpha} = \delta\,\bar{k}` });
    expect(preview("sAkbar^alpha = delta kbar", rt.table)).toEqual(preview("sAkbar^alpha = delta kbar", rt));
  });

  it("gives did-you-mean suggestions", () => {
    expect(preview("kt = alpah", rt)).toEqual({ ok: false, error: 'I don\'t know the symbol "kt". Did you mean k_t?', suggestions: ["k_t"] });
  });

  it("notes an unbracketed fractional exponent", () => {
    expect(preview("kbar = (sA/δ)^1/(1−α)", rt)).toMatchObject({ ok: true, note: '^1/(1−α) reads as a power divided by what follows the "/"; write ^(1/(1−α)) for a fractional power.' });
  });
});

describe("symbol inheritance", () => {
  const rows = [
    { tex: "$A$", typical: "1", from: "solow-growth-model" },
    { tex: String.raw`$s$, $\delta$`, typical: "0.2, 0.05", from: "solow-growth-model" },
    { tex: "$k_t$", typical: "—", from: "solow-growth-model" },
    { tex: "$k_{t+1}$", typical: "—", from: "solow-growth-model" },
  ];
  const lean = edit(solow.ir, (ir) => {
    ir.symbols = [String.raw`s \in (0.05, 0.95)`, String.raw`\alpha \in (0.2, 0.8)`];
    ir.inherited = rows;
  });

  it("fills symbols from Notation rows, with the callout winning", () => {
    expect(selfTest(lean)).toEqual([]);
    const rt = fromIR(lean);
    expect(rt.inherited).toEqual([
      { key: "A", from: "solow-growth-model" },
      { key: "delta", from: "solow-growth-model" },
      { key: "k_t", from: "solow-growth-model" },
      { key: "k_t+1", from: "solow-growth-model" },
    ]);
    expect(rt.table.get("s")!.domain).toEqual({ kind: "range", lo: 0.05, hi: 0.95 });
    expect(rt.table.get("delta")!.domain).toEqual({ kind: "positive" });
    for (const [src, want] of solow.accept) expect(label(check(rt, initialState(), src).verdict), src).toBe(want);
  });

  it("merges caller-supplied rows after the block's, first claim winning", () => {
    const none = edit(lean, (ir) => (ir.inherited = []));
    expect(selfTest(none)[0]).toMatch(/I don't know the symbol/);
    expect(selfTest(none, { inherited: rows })).toEqual([]);
    const rt = fromIR(edit(lean, (ir) => (ir.inherited = [rows[0]!])), {
      inherited: [{ tex: "$A$", typical: "−1 to 1", from: "other" }, ...rows.slice(1)],
    });
    expect(rt.table.get("A")).toMatchObject({ domain: { kind: "positive" }, from: "solow-growth-model" });
  });

  it("takes plain scalars only from a row's Symbol cell", () => {
    const names = (cell: string) => rowNames(cell).map((n) => `${n.accent ?? ""}${n.base}${n.sub !== undefined ? `_${n.sub}` : ""}`);
    expect(names(String.raw`$s$, $\delta$`)).toEqual(["s", "delta"]);
    expect(names(String.raw`$\sigma^2$`)).toEqual(["sigma"]);
    expect(names(String.raw`$\widehat{\sigma}^2$`)).toEqual(["hatsigma"]);
    expect(names("$k = K/L$")).toEqual(["k"]);
    expect(names(String.raw`$\tilde{A} = A^{1/(1-\alpha)}$`)).toEqual(["tildeA"]);
    expect(names(String.raw`$\mathbf{X}$`)).toEqual([]);
    expect(names(String.raw`$\boldsymbol{\beta}$`)).toEqual([]);
    expect(names("$f(k) = Ak^{\\alpha}$")).toEqual([]);
    expect(names("$x_i$")).toEqual([]);
    expect(names("$y_{it}$")).toEqual([]);
    expect(names(String.raw`$\mathcal{L}$`)).toEqual([]);
    expect(names(String.raw`$\overline{\ln y}$`)).toEqual([]);
  });

  it("reads a sign from the typical value", () => {
    expect(domainFromTypical("0.1–0.3")).toEqual({ kind: "positive" });
    expect(domainFromTypical("—")).toEqual({ kind: "positive" });
    expect(domainFromTypical("≈ 1/3")).toEqual({ kind: "positive" });
    expect(domainFromTypical("−1 to 1")).toEqual({ kind: "real" });
    expect(domainFromTypical("≈ ±2 is the 5% threshold")).toEqual({ kind: "real" });
  });
});

describe("hardening of the prototype's failure modes", () => {
  const m = residualMaker.callout.derivation;

  it("folds transposed and scaled spellings of a definition, so they reach the target", () => {
    for (const src of [
      "(X(X'X)^{-1}X')'X = X",
      "X((X'X)^{-1})'X'X = X",
      "2X(X'X)^{-1}X'X = 2X",
      "-X(X'X)^{-1}X'X + X = 0",
      "X (X'X)^{-1} (2X') X = 2X",
      "(X(X'X)^{-1}X'X)' = X'",
      "(MX)' = 0",
    ])
      expect(classify(m, src).kind, src).toBe("target");
  });

  it("names a fixed extra solution in a one-way step", () => {
    const d = solow.callout.derivation;
    expect(classify(d, "(kbar-2)(s A kbar^alpha - delta kbar) = 0")).toMatchObject({
      kind: "error",
      message: String.raw`That holds at the answer, but it also allows other values: it is also true at $\bar{k} = 2$, which the derivation doesn't allow. Did you multiply both sides by something that is zero there?`,
    });
  });

  it("explains a one-way step whose extra solutions move, such as squaring", () => {
    const real = calloutToIR(String.raw`> [!derive]- Solve a line
> symbols: $a$, $c$
> unknowns: $x$ real
> 1. $x = c - a$`);
    expect(check(fromIR(real), initialState(), "x^2 = (c-a)^2").verdict).toMatchObject({
      kind: "error",
      message: "That holds at the answer, but it also allows other values, so the step only goes one way. Squaring both sides, or multiplying them by something that can be zero, does this.",
    });
  });

  it("says how a numeric exponent before / was read even when bracketing doesn't fix the line", () => {
    expect(classify(solow.callout.derivation, "kbar = (sA/δ)^1/(1+α)")).toMatchObject({
      kind: "error",
      message: 'That doesn\'t follow from the previous lines. (Note: ^1/(1+α) reads as a power divided by what follows the "/"; write ^(1/(1+α)) for a fractional power.)',
    });
  });
});
