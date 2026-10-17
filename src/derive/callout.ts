// Read a `> [!derive]-` callout (the approved authoring grammar, docs/proposals/e0-checker.md, plus the step keys
// `hint:` and `justify:` from phase2-contracts.md §1) into the same IR the exporter produces, then into a runtime
// derivation with `fromIR`. Every line reads as ordinary Markdown in Obsidian: maths sits in $…$, keys are short
// words before a colon, and the numbered list is the worked derivation.
//
//   > [!derive]- Solve for the steady state $\bar{k}$
//   > symbols: $s \in (0.05, 0.95)$, $A$, $\alpha \in (0.2, 0.8)$, $\delta \in (0.02, 0.2)$, $k_t$, $k_{t+1}$, $\bar{k}$
//   > given: $k_{t+1} = sAk_t^{\alpha} + (1-\delta)k_t$
//   > 1. Set $k_{t+1} = k_t = \bar{k}$: $\bar{k} = sA\bar{k}^{\alpha} + (1-\delta)\bar{k}$
//   >    hint: Steady state means $k_{t+1} = k_t$.
//   > 2. $sA\bar{k}^{\alpha} = \delta\bar{k}$
//   > 3. $\bar{k} = \left(\frac{sA}{\delta}\right)^{\frac{1}{1-\alpha}}$
//   > accept: $\bar{k}^{1-\alpha} = sA/\delta$
//   > reject: $\bar{k} = (sA/\delta)^{1/\alpha}$ — dividing by $\bar{k}^{\alpha}$ leaves $\bar{k}^{1-\alpha}$
//
// A numbered step's maths is its last $…$ span, so prose and inline maths may come before it. This reader is what
// the tests and the prototype fixtures use; in the app the exporter (`_meta/vault_tool.py`) produces the IR.
import type { Derivation } from "./classify";
import { splitList } from "./declare";
import type { DeriveBlockIR, DeriveStepIR } from "./ir-shape";
import { type DeriveRuntime, fromIR, type FromIROptions } from "./runtime";

export interface DeriveCallout {
  title: string;
  objective?: number;
  derivation: Derivation;
  runtime: DeriveRuntime;
}

const MATH = /\$([^$]+)\$/g;

function spans(line: string): string[] {
  return [...line.matchAll(MATH)].map((m) => m[1]!);
}

const items = (value: string) => splitList(value).map((v) => v.replace(/\$/g, " ").replace(/\s+/g, " ").trim());

/** The callout's structure as the exporter would emit it (keys split, steps and `$…$` extracted, nothing parsed). */
export function calloutToIR(markdown: string): DeriveBlockIR {
  const lines = markdown.split(/\r?\n/).map((l) => l.replace(/^\s*>\s?/, ""));
  const head = /^\[!derive\][-+]?\s*(.*)$/.exec(lines[0]?.trim() ?? "");
  if (!head) throw new Error("a derive callout starts with > [!derive]-");
  const ir: DeriveBlockIR = {
    t: "derive",
    title: head[1]!.trim(),
    symbols: [],
    inherited: [],
    unknowns: [],
    dims: [],
    data: [],
    matrices: [],
    define: [],
    given: [],
    steps: [],
    accept: [],
    reject: [],
  };
  let last: DeriveStepIR | undefined;

  lines.slice(1).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const where = `line ${i + 2}`;
    const step = /^(\d+)\.\s+(.*)$/.exec(line);
    if (step) {
      const math = spans(step[2]!).at(-1);
      if (!math) throw new Error(`${where}: step ${step[1]} has no $…$ maths`);
      last = { md: step[2]!.trim(), tex: math };
      ir.steps.push(last);
      return;
    }
    const option = /^-\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (option) {
      if (!last?.justify) throw new Error(`${where}: an option "- [ ]" belongs under a step's justify: line`);
      last.justify.options.push({ md: option[2]!.trim(), correct: option[1] !== " " });
      return;
    }
    const kv = /^([a-z]+):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`${where}: expected "key: value" or a numbered step`);
    const [, key, value] = kv as unknown as [string, string, string];
    switch (key) {
      case "objective":
        ir.objectives = value.split(",").map((v) => Number(v.trim()));
        break;
      case "notation":
        break;
      case "symbols":
      case "unknowns":
      case "dims":
      case "data":
      case "matrices":
        ir[key].push(...items(value));
        break;
      case "define":
        ir.define.push(value.replace(/\$/g, "").trim());
        break;
      case "given":
        ir.given.push(...spans(value));
        break;
      case "accept":
        ir.accept.push(...spans(value));
        break;
      case "reject": {
        const m = /^\$([^$]+)\$\s*(?:—|--|-)?\s*(.*)$/.exec(value);
        if (!m) throw new Error(`${where}: reject needs $…$ maths, then — and a message`);
        ir.reject.push({ tex: m[1]!, md: m[2]!.trim() });
        break;
      }
      case "hint":
        if (!last || raw === line) throw new Error(`${where}: hint: goes indented under a numbered step`);
        last.hint = value;
        break;
      case "justify":
        if (!last || raw === line) throw new Error(`${where}: justify: goes indented under a numbered step`);
        last.justify = { prompt: value, options: [] };
        break;
      default:
        throw new Error(`${where}: unknown key "${key}"`);
    }
  });

  if (!ir.steps.length) throw new Error("a derive callout needs at least one numbered step (the last is the target)");
  return ir;
}

export function parseDeriveCallout(markdown: string, opts: FromIROptions = {}): DeriveCallout {
  const ir = calloutToIR(markdown);
  const runtime = fromIR(ir, opts);
  return {
    title: ir.title,
    ...(ir.objectives?.length ? { objective: ir.objectives[0]! } : {}),
    derivation: runtime.derivation,
    runtime,
  };
}
