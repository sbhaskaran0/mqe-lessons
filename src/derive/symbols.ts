// The symbols a derivation step may use, with what each one is (scalar, data vector, matrix, dimension, definition)
// and where its random values come from. The tokenizer splits `sAk_t` against this table, and the equivalence engine
// samples from it.
import type { Node } from "./ast";
import { type Accent, keyOf, type Name, nameLatex, typedName } from "./names";

/** Where a scalar's random values come from. `positive` and `real` sample a moderate range but are searched over all
 *  magnitudes when solving for the symbol. */
export type Domain = { kind: "positive" } | { kind: "real" } | { kind: "range"; lo: number; hi: number };

export type Kind =
  /** A number: a parameter or an unknown. */
  | "scalar"
  /** A positive integer size: n, K. */
  | "dim"
  /** A data vector x_i, i = 1..n; bare `x` inside a sum means x_i. */
  | "data"
  /** x̄ for a data vector x. */
  | "mean"
  /** A random full-rank matrix of a declared shape. */
  | "matrix"
  /** I or I_n. */
  | "identity"
  /** Defined by an expression in other symbols: P = X(X'X)^{-1}X'. */
  | "defined"
  | "const";

export interface Sym extends Name {
  key: string;
  kind: Kind;
  domain: Domain;
  /** matrix: dimension keys. */
  rows?: string;
  cols?: string;
  /** data: the index letter (i); mean: the data key it averages. */
  index?: string;
  of?: string;
  /** identity: the dimension key of its size, if written (I_n). */
  size?: string;
  /** defined: the expression. */
  def?: Node;
  /** dim: sampling range, or `gt` another dimension by 2..6. */
  min?: number;
  max?: number;
  gt?: string;
  /** Inherited from a Notation table: the slug of the note. */
  from?: string;
}

export class SymbolTable {
  readonly syms = new Map<string, Sym>();
  /** Declared unknowns, in order; the solved-for variable when a step's form matters. */
  unknowns: string[] = [];

  add(sym: Omit<Sym, "key"> & { key?: string }): Sym {
    const key = sym.key ?? keyOf(sym);
    const full: Sym = { ...sym, key };
    this.syms.set(key, full);
    return full;
  }

  get(key: string): Sym | undefined {
    return this.syms.get(key);
  }

  /** Resolve a spelled name. A data symbol answers to its bare base and to its index (x, x_i); I_n is an identity of
   *  size n when n is a dimension; π and e are constants unless declared as something else. */
  lookup(base: string, accent: Accent | undefined, sub: string | undefined): Sym | undefined {
    const direct = this.syms.get(keyOf({ base, accent, sub }));
    if (direct && direct.kind !== "identity") return direct;
    if (!accent) {
      const data = this.syms.get(base);
      if (data?.kind === "data" && (sub === undefined || sub === data.index)) return data;
    }
    if (this.hasMatrices && base === "I" && !accent) {
      if (sub === undefined) return this.identity();
      if (this.syms.get(sub)?.kind === "dim") return this.identity(sub);
    }
    if (direct) return direct;
    if ((base === "pi" || base === "e") && !accent && sub === undefined) return { key: base, base, kind: "const", domain: { kind: "real" } };
    return undefined;
  }

  private identity(size?: string): Sym {
    const key = size ? `I_${size}` : "I";
    return this.syms.get(key) ?? this.add({ key, base: "I", ...(size ? { sub: size, size } : {}), kind: "identity", domain: { kind: "real" } });
  }

  get hasMatrices(): boolean {
    for (const s of this.syms.values()) if (s.kind === "matrix") return true;
    return false;
  }

  /** Every symbol a student may type, for suggestions. */
  all(): Sym[] {
    return [...this.syms.values()];
  }

  ofKind(...kinds: Kind[]): Sym[] {
    return this.all().filter((s) => kinds.includes(s.kind));
  }

  typed(key: string): string {
    const s = this.syms.get(key);
    if (!s) return key;
    return s.kind === "data" ? typedName({ ...s, sub: s.index }) : typedName(s);
  }

  latex(key: string): string {
    const s = this.syms.get(key);
    if (!s) return key === "pi" ? "\\pi" : key;
    const bold = s.kind === "matrix" || s.kind === "identity" || (s.kind === "defined" && /^[A-Z]$/.test(s.base));
    if (s.kind === "data") return nameLatex({ ...s, sub: s.index }, false);
    return nameLatex(s, bold);
  }
}
