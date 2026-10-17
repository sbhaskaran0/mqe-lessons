// The `t: "derive"` IR block, written structurally from docs/proposals/phase2-contracts.md §1 so `src/derive` does not
// depend on `src/ir.ts` (the zod schema lives there). Field names match the spec exactly; any value that satisfies the
// zod type satisfies these interfaces.
//
// The exporter only splits structure (keys, steps, `$…$`); all TeX is interpreted here, by `fromIR`.

export interface DeriveJustifyIR {
  prompt: string;
  options: { md: string; correct: boolean }[];
}

export interface DeriveStepIR {
  /** The whole numbered item as inline Markdown (prose + maths). */
  md: string;
  /** Its last `$…$`: what the checker compares. */
  tex: string;
  /** Inline Markdown, shown on request. */
  hint?: string;
  /** A justify step is shown (not typed), answered by multiple choice, and never checked numerically. */
  justify?: DeriveJustifyIR;
}

/** A Notation-table row whose keys occur in the derivation's maths: `tex` is the row's Symbol cell
 *  ("$s$, $\delta$", "$x = X/L$"), `typical` its Typical-value cell, `from` the note's slug. */
export interface DeriveInheritedIR {
  tex: string;
  typical: string;
  from: string;
}

export interface DeriveBlockIR {
  t: "derive";
  title: string;
  objectives?: number[];
  /** The callout's `symbols:` items, raw TeX ("s \\in (0.05, 0.95)"). */
  symbols: string[];
  inherited: DeriveInheritedIR[];
  unknowns: string[];
  dims: string[];
  data: string[];
  matrices: string[];
  define: string[];
  given: string[];
  steps: DeriveStepIR[];
  accept: string[];
  /** `md` is the author's message (why the form is wrong). */
  reject: { tex: string; md: string }[];
}
