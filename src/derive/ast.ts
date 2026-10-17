// The derivation checker's syntax tree. Both readers (typed input and the LaTeX subset authors write) produce it,
// the evaluator walks it, and the preview prints it back as LaTeX. Symbols are canonical keys into a SymbolTable, so
// `kbar`, `k̄` and `\bar{k}` are the same node.

export type Fn = "ln" | "exp" | "sqrt" | "abs" | "trace" | "inv";

export type Node =
  | { t: "num"; v: number }
  | { t: "sym"; key: string }
  | { t: "neg"; a: Node }
  | { t: "add" | "sub" | "mul" | "div" | "pow"; a: Node; b: Node }
  | { t: "fn"; fn: Fn; a: Node }
  /** Transpose: `X'`, `X^T`, `X^\top`. */
  | { t: "tr"; a: Node }
  /** A sum over the data index: `sum(...)`, `\sum_{i=1}^n`, `Σ`. */
  | { t: "sum"; a: Node };

export interface Equation {
  t: "eq";
  l: Node;
  r: Node;
}

export type Statement = Node | Equation;

export const isEquation = (s: Statement): s is Equation => s.t === "eq";

/** Every symbol key a statement reads. */
export function symbolsOf(s: Statement, out = new Set<string>()): Set<string> {
  switch (s.t) {
    case "eq":
      symbolsOf(s.l, out);
      symbolsOf(s.r, out);
      break;
    case "sym":
      out.add(s.key);
      break;
    case "num":
      break;
    case "neg":
    case "fn":
    case "tr":
    case "sum":
      symbolsOf(s.a, out);
      break;
    default:
      symbolsOf(s.a, out);
      symbolsOf(s.b, out);
  }
  return out;
}

/** The node's direct children, in order. */
export function children(n: Node): Node[] {
  switch (n.t) {
    case "num":
    case "sym":
      return [];
    case "neg":
    case "fn":
    case "tr":
    case "sum":
      return [n.a];
    default:
      return [n.a, n.b];
  }
}

/** Rebuild a node with new children (same arity as `children`). */
export function withChildren(n: Node, c: Node[]): Node {
  switch (n.t) {
    case "num":
    case "sym":
      return n;
    case "neg":
    case "fn":
    case "tr":
    case "sum":
      return { ...n, a: c[0]! };
    default:
      return { ...n, a: c[0]!, b: c[1]! };
  }
}
