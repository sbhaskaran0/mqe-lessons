// Print a parsed statement back as LaTeX: the live "I read this as …" preview. It shows the reading, not the input:
// implicit products get a thin space (s\,A\,k_t), division becomes \frac, and brackets appear only where the tree
// needs them, so a misread like 1/2k = 1/(2k) is visible before the student submits.
import type { Node, Statement } from "./ast";
import type { SymbolTable } from "./symbols";

const PREC: Record<Node["t"], number> = { num: 9, sym: 9, fn: 9, tr: 8, pow: 7, neg: 3, mul: 4, div: 9, sum: 4, add: 2, sub: 2 };

function wrap(s: string): string {
  return `\\left(${s}\\right)`;
}

function number(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(6)));
}

export function toLatex(s: Statement, table: SymbolTable): string {
  if (s.t === "eq") return `${tex(s.l, table, 0)} = ${tex(s.r, table, 0)}`;
  return tex(s, table, 0);
}

function tex(n: Node, table: SymbolTable, parent: number): string {
  const out = body(n, table);
  return PREC[n.t] < parent ? wrap(out) : out;
}

function body(n: Node, table: SymbolTable): string {
  switch (n.t) {
    case "num":
      return number(n.v);
    case "sym":
      return table.latex(n.key);
    case "neg":
      return `-${tex(n.a, table, 4)}`;
    case "add":
      return `${tex(n.a, table, 2)} + ${tex(n.b, table, 2)}`;
    case "sub":
      return `${tex(n.a, table, 2)} - ${tex(n.b, table, 3.5)}`;
    case "mul": {
      // A sum on the left would swallow the right factor when read back, so it keeps its brackets.
      const left = n.a.t === "sum" ? wrap(body(n.a, table)) : tex(n.a, table, 4);
      const right = tex(n.b, table, 5);
      const sep = /^[0-9.]/.test(right) || right.startsWith("-") ? " \\cdot " : n.a.t === "num" ? "" : "\\,";
      return `${left}${sep}${right}`;
    }
    case "div":
      return `\\frac{${tex(n.a, table, 0)}}{${tex(n.b, table, 0)}}`;
    case "pow": {
      const base = n.a.t === "div" ? wrap(body(n.a, table)) : tex(n.a, table, 8);
      return `${base}^{${tex(n.b, table, 0)}}`;
    }
    case "tr":
      return `${tex(n.a, table, 9)}'`;
    case "sum":
      return `\\sum_{i} ${tex(n.a, table, 5)}`;
    case "fn":
      switch (n.fn) {
        case "sqrt":
          return `\\sqrt{${tex(n.a, table, 0)}}`;
        case "abs":
          return `\\left|${tex(n.a, table, 0)}\\right|`;
        case "inv":
          return `${tex(n.a, table, 9)}^{-1}`;
        case "trace":
          return `\\operatorname{tr}${wrap(tex(n.a, table, 0))}`;
        default:
          return `\\${n.fn}${wrap(tex(n.a, table, 0))}`;
      }
  }
}
