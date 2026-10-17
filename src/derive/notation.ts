// Symbols inherited from Notation tables (phase2-contracts.md §1, "Symbol inheritance"). The exporter passes the rows
// whose keys occur in the derivation's maths; here each row's Symbol cell is read into names and its Typical-value
// cell into a domain. The callout's own declarations always win (declare.ts adds these last, only for names nothing
// else declared).
//
// What a row can contribute is deliberately narrow: plain scalars. Shapes stay in the callout (P2 rule 2), so rows
// that name a matrix or vector (\mathbf, \boldsymbol), a function (f(k)), an expression (sf(k)) or a data vector
// (x_i, e_i, y_{it}) are skipped; declare those with `matrices:` / `data:` in the callout.
import type { DeriveInheritedIR } from "./ir-shape";
import { type Name, parseName } from "./names";
import type { Domain } from "./symbols";

export interface InheritedSymbol {
  name: Name;
  domain: Domain;
  /** The slug of the note whose Notation table supplied it. */
  from: string;
}

const MATH = /\$([^$]+)\$/g;
const BOLD = /\\(?:mathbf|boldsymbol|bm|pmb|mathcal|mathbb)\b/;
const DATA_INDEX = /^(?:i|j|it|ij)$/;

/** Split on commas outside braces and brackets: "k^*, y^*" → two; "f(x, y)" → one. */
function topLevel(group: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < group.length; i++) {
    const c = group[i]!;
    if (c === "\\") {
      cur += group.slice(i, i + 2);
      i++;
      continue;
    }
    if ("{([".includes(c)) depth++;
    else if ("})]".includes(c)) depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((p) => p.trim()).filter(Boolean);
}

/** The names a Symbol cell declares: per `$…$` group and comma part, the symbol left of any "=", with a trailing
 *  power dropped (σ² declares σ). Parts that are not a single plain scalar name are skipped. */
export function rowNames(cell: string): Name[] {
  const groups = [...cell.matchAll(MATH)].map((m) => m[1]!);
  const out: Name[] = [];
  for (const part of (groups.length ? groups : [cell]).flatMap(topLevel)) {
    let lhs = part.split("=")[0]!.trim();
    if (!lhs || BOLD.test(lhs) || /\)\s*$/.test(lhs)) continue;
    lhs = lhs.replace(/\^\s*(?:\{[^{}]*\}|\\?[A-Za-z0-9]+)\s*$/, "").trim();
    let name: Name;
    try {
      name = parseName(lhs);
    } catch {
      continue;
    }
    if (name.sub !== undefined && DATA_INDEX.test(name.sub)) continue;
    out.push(name);
  }
  return out;
}

/** Typical value → domain. Only the sign matters: a range such as "0.1–0.3" widens to the positive reals around it,
 *  a missing value ("—") means positive, and a negative number or "±" means real. Narrower ranges belong in the
 *  callout's `symbols:` line (`\alpha \in (0.2, 0.8)`), which overrides the row. */
export function domainFromTypical(typical: string): Domain {
  const t = typical.normalize("NFKC");
  if (/±|\\pm|negative/i.test(t) || /(?:^|[\s(,;:=≈~$])[-−]\s*\d/.test(t)) return { kind: "real" };
  return { kind: "positive" };
}

/** Every plain scalar the rows declare, first claim on each name winning (as the exporter orders rows). */
export function inheritedSymbols(rows: readonly DeriveInheritedIR[]): InheritedSymbol[] {
  const out: InheritedSymbol[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const domain = domainFromTypical(row.typical ?? "");
    for (const name of rowNames(row.tex)) {
      const id = `${name.accent ?? ""}:${name.base}_${name.sub ?? ""}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ name, domain, from: row.from });
    }
  }
  return out;
}
