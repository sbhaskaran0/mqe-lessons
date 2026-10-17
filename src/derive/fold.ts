// Structural comparison and definition folding, used only where numbers can't tell statements apart.
//
// Every true matrix identity evaluates to zero, so MX = 0, PX = X and trace(M) = n − K are numerically all "true".
// To tell which one a student reached, the checker relaxes the innermost definition (sample.ts) and compares how the
// statements fail. That only works if the student's spelled-out X(X'X)⁻¹X' counts as P, so before relaxing, any
// occurrence of a definition's right-hand side is folded back into its symbol.
import { children, type Node, type Statement, withChildren } from "./ast";
import type { SymbolTable } from "./symbols";

/** Canonical spelling: x^{-1} → inv(x), −(number) → number, and transposes pushed down to the symbols
 *  ((AB)' → B'A', (A⁻¹)' → (A')⁻¹, (A')' → A, s' → s for a scalar), so a transposed spelling of a definition's
 *  right-hand side reads the same as the plain one. Every rewrite is an identity, so structural equality stays sound. */
export function canon(n: Node, table: SymbolTable): Node {
  const c = withChildren(n, children(n).map((k) => canon(k, table)));
  switch (c.t) {
    case "pow": {
      const b = c.b;
      if (b.t === "num" && b.v === -1) return { t: "fn", fn: "inv", a: c.a };
      return c;
    }
    case "neg":
      return c.a.t === "num" ? { t: "num", v: -c.a.v } : c;
    case "tr":
      return pushTranspose(c.a, table);
    default:
      return c;
  }
}

const SCALAR_KINDS = new Set(["scalar", "dim", "mean", "const", "data"]);

/** The canonical form of a' for an already-canonical a. */
function pushTranspose(a: Node, table: SymbolTable): Node {
  switch (a.t) {
    case "tr":
      return a.a;
    case "num":
      return a;
    case "sym": {
      const kind = table.get(a.key)?.kind;
      return kind && (SCALAR_KINDS.has(kind) || kind === "identity") ? a : { t: "tr", a };
    }
    case "neg":
      return { t: "neg", a: pushTranspose(a.a, table) };
    case "add":
    case "sub":
      return { t: a.t, a: pushTranspose(a.a, table), b: pushTranspose(a.b, table) };
    case "mul":
      return { t: "mul", a: pushTranspose(a.b, table), b: pushTranspose(a.a, table) };
    case "fn":
      if (a.fn === "inv") return { t: "fn", fn: "inv", a: pushTranspose(a.a, table) };
      if (a.fn === "trace") return a;
      return { t: "tr", a };
    default:
      return { t: "tr", a };
  }
}

/** Structural equality, with products and sums compared as flattened chains (grouping doesn't matter) and I the
 *  same as I_n. */
export function same(a: Node, b: Node, table: SymbolTable): boolean {
  if (a.t === "mul" && b.t === "mul") return chainEq(flatMul(a), flatMul(b), table);
  if ((a.t === "add" || a.t === "sub") && (b.t === "add" || b.t === "sub")) {
    const ta = flatAdd(a);
    const tb = flatAdd(b);
    return ta.length === tb.length && ta.every((t, i) => t.sign === tb[i]!.sign && same(t.node, tb[i]!.node, table));
  }
  if (a.t !== b.t) return false;
  switch (a.t) {
    case "num":
      return a.v === (b as typeof a).v;
    case "sym": {
      const kb = (b as typeof a).key;
      return a.key === kb || (table.get(a.key)?.kind === "identity" && table.get(kb)?.kind === "identity");
    }
    case "fn":
      return a.fn === (b as typeof a).fn && same(a.a, (b as typeof a).a, table);
    default: {
      const ca = children(a);
      const cb = children(b);
      return ca.length === cb.length && ca.every((x, i) => same(x, cb[i]!, table));
    }
  }
}

export function sameStatement(a: Statement, b: Statement, table: SymbolTable): boolean {
  if (a.t === "eq" || b.t === "eq") {
    if (a.t !== "eq" || b.t !== "eq") return false;
    const [al, ar, bl, br] = [a.l, a.r, b.l, b.r].map((n) => canon(n, table)) as [Node, Node, Node, Node];
    return (same(al, bl, table) && same(ar, br, table)) || (same(al, br, table) && same(ar, bl, table));
  }
  return same(canon(a, table), canon(b, table), table);
}

function flatMul(n: Node): Node[] {
  return n.t === "mul" ? [...flatMul(n.a), ...flatMul(n.b)] : [n];
}

function flatAdd(n: Node, sign = 1): { sign: number; node: Node }[] {
  if (n.t === "add") return [...flatAdd(n.a, sign), ...flatAdd(n.b, sign)];
  if (n.t === "sub") return [...flatAdd(n.a, sign), ...flatAdd(n.b, -sign)];
  if (n.t === "neg") return flatAdd(n.a, -sign);
  return [{ sign, node: n }];
}

/** A product split into commuting scalar factors (numbers, scalar symbols, −1 for each negation) and the ordered
 *  remaining factors. */
function factors(n: Node, table: SymbolTable): { coef: Node[]; chain: Node[] } {
  const coef: Node[] = [];
  const chain: Node[] = [];
  const walk = (m: Node) => {
    if (m.t === "mul") {
      walk(m.a);
      walk(m.b);
    } else if (m.t === "neg") {
      coef.push({ t: "num", v: -1 });
      walk(m.a);
    } else if (m.t === "num" || (m.t === "sym" && SCALAR_KINDS.has(table.get(m.key)?.kind ?? ""))) coef.push(m);
    else chain.push(m);
  };
  walk(n);
  return { coef, chain };
}

function chainEq(a: Node[], b: Node[], table: SymbolTable): boolean {
  return a.length === b.length && a.every((x, i) => same(x, b[i]!, table));
}

function buildMul(ns: Node[]): Node {
  return ns.reduce((acc, n) => ({ t: "mul", a: acc, b: n }));
}

function buildAdd(terms: { sign: number; node: Node }[]): Node {
  const [first, ...rest] = terms;
  let acc: Node = first!.sign > 0 ? first!.node : { t: "neg", a: first!.node };
  for (const t of rest) acc = { t: t.sign > 0 ? "add" : "sub", a: acc, b: t.node };
  return acc;
}

interface Def {
  key: string;
  rhs: Node;
}

function foldOnce(n: Node, def: Def, table: SymbolTable): Node {
  const c = withChildren(n, children(n).map((k) => foldOnce(k, def, table)));
  const r = def.rhs;
  const symbol: Node = { t: "sym", key: def.key };
  if (r.t === "mul" && (c.t === "mul" || (c.t === "neg" && c.a.t === "mul"))) {
    // Numbers and scalars commute, so they are set aside before matching: 2X(X'X)⁻¹X' and −X(X'X)⁻¹X' fold to
    // 2P and −P.
    // A definition with scalar factors of its own (y = Ak^α) is matched as a plain contiguous chain.
    const pat = factors(r, table);
    const { coef, chain } = pat.coef.length ? { coef: [], chain: flatMul(c) } : factors(c, table);
    if (pat.coef.length) pat.chain = flatMul(r);
    for (let i = 0; i + pat.chain.length <= chain.length; i++) {
      if (pat.chain.every((p, j) => same(p, chain[i + j]!, table))) {
        const rest = [...coef, ...chain.slice(0, i), symbol, ...chain.slice(i + pat.chain.length)];
        return buildMul(rest);
      }
    }
    return c;
  }
  if ((r.t === "add" || r.t === "sub") && (c.t === "add" || c.t === "sub")) {
    const terms = flatAdd(c);
    const pat = flatAdd(r);
    for (const flip of [1, -1]) {
      const used = new Set<number>();
      const ok = pat.every((p) => {
        const k = terms.findIndex((t, i) => !used.has(i) && t.sign === p.sign * flip && same(t.node, p.node, table));
        if (k < 0) return false;
        used.add(k);
        return true;
      });
      if (ok) {
        const rest = terms.filter((_, i) => !used.has(i));
        return buildAdd([{ sign: flip, node: symbol }, ...rest]);
      }
    }
    return c;
  }
  return same(c, r, table) ? symbol : c;
}

/** Replace spelled-out definitions by their symbols, innermost first, until nothing changes. */
export function foldDefinitions(s: Statement, table: SymbolTable): Statement {
  const defs: Def[] = table.ofKind("defined").map((d) => ({ key: d.key, rhs: canon(d.def!, table) }));
  if (!defs.length) return s;
  // Fold each definition's own right-hand side by the others, so M = I − X(X'X)⁻¹X' is matched as I − P.
  for (let pass = 0; pass < 3; pass++)
    for (const d of defs) for (const other of defs) if (other !== d) d.rhs = foldOnce(d.rhs, other, table);
  const run = (n: Node, except?: Node): Node => {
    // In M = I − P, folding I − P back into M would turn the definition into M = M.
    const skip = except?.t === "sym" ? except.key : undefined;
    let cur = canon(n, table);
    for (let pass = 0; pass < 4; pass++) {
      let next = cur;
      for (const d of defs) if (d.key !== skip) next = foldOnce(next, d, table);
      if (same(next, cur, table)) break;
      cur = next;
    }
    return cur;
  };
  return s.t === "eq" ? { t: "eq", l: run(s.l, s.r), r: run(s.r, s.l) } : run(s);
}
