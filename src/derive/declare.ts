// Symbol declarations as an author writes them in a `[!derive]-` callout. Names may be typed or LaTeX (with or
// without $…$), so the same line reads cleanly in Obsidian:
//   symbols:  $s \in (0.05, 0.95)$, $A$, $\alpha \in (0.2, 0.8)$, $k_t$, $k_{t+1}$, $\bar{k}$
//   unknowns: $\bar{k}$                 (or: $b_1$ real, $b_2$ real)
//   dims:     $n > K$
//   data:     $x_i$, $y_i$
//   matrices: $\mathbf{X}$ is $n \times K$
//   define:   $\mathbf{P} = \mathbf{X}(\mathbf{X}'\mathbf{X})^{-1}\mathbf{X}'$
// Undeclared unknowns are added as scalars; a data symbol x also declares x̄ (its mean).
import type { InheritedSymbol } from "./notation";
import { keyOf, type Name, parseName } from "./names";
import { parseExpression } from "./parse";
import { type Domain, type Sym, SymbolTable } from "./symbols";

export interface Declarations {
  symbols?: string;
  unknowns?: string;
  dims?: string;
  data?: string;
  matrices?: string;
  define?: string | string[];
  /** Scalars from linked Notation tables (notation.ts). Added only for names the callout does not declare, so an
   *  explicit `symbols:` entry, an unknown, a data vector, a matrix or a definition always wins. */
  inherited?: InheritedSymbol[];
}

/** Split on commas outside brackets. */
export function splitList(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of src) {
    if ("({[".includes(c)) depth++;
    else if (")}]".includes(c)) depth--;
    if (c === "," && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const RANGE = /\s*(?:\\in|∈|\bin\b)\s*[([]\s*(-?[0-9.]+)\s*,\s*(-?[0-9.]+)\s*[)\]]\s*$/;
const KIND_WORD = /\s+(real|positive)\s*$/;

/** `alpha in (0.2, 0.8)`, `b_1 real`, `kbar` → name and domain. */
function item(src: string): { name: Name; domain: Domain; explicit: boolean } {
  let s = src.replace(/\$/g, " ").trim();
  let domain: Domain = { kind: "positive" };
  let explicit = false;
  const range = RANGE.exec(s);
  if (range) {
    domain = { kind: "range", lo: Number(range[1]), hi: Number(range[2]) };
    s = s.slice(0, range.index);
    explicit = true;
  }
  const word = KIND_WORD.exec(s);
  if (word) {
    domain = { kind: word[1] as "real" | "positive" };
    s = s.slice(0, word.index);
    explicit = true;
  }
  return { name: parseName(s), domain, explicit };
}

export function declare(d: Declarations): SymbolTable {
  const t = new SymbolTable();
  for (const src of splitList(d.dims ?? "")) {
    // `n > K`: K small, n = K + 2..6.
    const gt = /^(.+?)\s*>\s*(.+)$/.exec(src.replace(/\$/g, ""));
    if (gt) {
      const small = parseName(gt[2]!);
      const big = parseName(gt[1]!);
      if (!t.get(keyOf(small))) t.add({ ...small, kind: "dim", domain: { kind: "positive" }, min: 1, max: 4 });
      t.add({ ...big, kind: "dim", domain: { kind: "positive" }, gt: keyOf(small), min: 2, max: 6 });
    } else {
      const { name, domain } = item(src);
      t.add({ ...name, kind: "dim", domain, ...(domain.kind === "range" ? { min: domain.lo, max: domain.hi } : { min: 5, max: 12 }) });
    }
  }
  for (const src of splitList(d.symbols ?? "")) {
    const { name, domain } = item(src);
    t.add({ ...name, kind: "scalar", domain });
  }
  for (const src of splitList(d.unknowns ?? "")) {
    const { name, domain, explicit } = item(src);
    const key = keyOf(name);
    const existing = t.get(key);
    if (!existing) t.add({ ...name, kind: "scalar", domain });
    else if (explicit) existing.domain = domain;
    t.unknowns.push(key);
  }
  const dataDim = t.get("n")?.kind === "dim" ? "n" : t.ofKind("dim")[0]?.key;
  for (const src of splitList(d.data ?? "")) {
    const { name, domain } = item(src);
    const index = name.sub ?? "i";
    const data: Omit<Sym, "key"> & { key: string } = { key: name.base, base: name.base, kind: "data", domain, index, ...(dataDim ? { size: dataDim } : {}) };
    t.add(data);
    t.add({ base: name.base, accent: "bar", kind: "mean", domain, of: name.base });
  }
  for (const src of splitList(d.matrices ?? "")) {
    const m = /^(.*?)\s*(?::|\bis\b|\()?\s*\$?\s*([A-Za-z]\w*)\s*(?:×|\\times|\bx\b|\*)\s*([A-Za-z]\w*)\s*\$?\s*\)?\s*(?:,?\s*full rank)?\s*$/.exec(src.replace(/\$/g, " ").trim());
    if (!m) throw new Error(`can't read the matrix declaration "${src}"; write it as X: n×K`);
    const rows = keyOf(parseName(m[2]!));
    const cols = keyOf(parseName(m[3]!));
    for (const dim of [rows, cols]) if (t.get(dim)?.kind !== "dim") throw new Error(`${dim} in "${src}" is not a declared dimension`);
    t.add({ ...parseName(m[1]!), kind: "matrix", domain: { kind: "real" }, rows, cols });
  }
  for (const { name, domain, from } of d.inherited ?? []) {
    const hit = t.lookup(name.base, name.accent, name.sub);
    if (!hit || hit.kind === "const") t.add({ ...name, kind: "scalar", domain, from });
  }
  const defs = typeof d.define === "string" ? splitList(d.define) : (d.define ?? []);
  for (const src of defs) {
    const eq = src.indexOf("=");
    if (eq < 0) throw new Error(`a definition needs "=": ${src}`);
    const name = parseName(src.slice(0, eq));
    const def = parseExpression(src.slice(eq + 1), t);
    t.add({ ...name, kind: "defined", domain: { kind: "real" }, def });
  }
  return t;
}
