// One reader for both input styles: what a student types (`k_(t+1) = s A k_t^alpha + (1-delta) k_t`, `sAkbar^α`,
// `sum((x_i-xbar)^2)`) and the LaTeX subset authors write so Obsidian renders it (`\frac`, `\left(\right)`, `\bar`,
// `\sum_{i=1}^n`, `\mathbf{X}`, `^{-1}`, `'`). The two overlap enough that one grammar covers both, and a student may
// paste LaTeX.
//
// Runs of letters are split against the step's symbol table: with s, A and k_t declared, `sAk_t` reads as s·A·k_t,
// which mathjs (and any table-free tokenizer) reads as one name. A letter run that cannot be split is reported with
// "did you mean" suggestions.
//
// Grammar, loosest first:
//   statement := expr ("=" expr)?
//   expr      := term (("+" | "-") term)*
//   term      := chain (("*" | "/") chain)*          explicit * and / bind looser than juxtaposition, so
//   chain     := signed power*                        1/2k = 1/(2k) and sA/δk̄ = (sA)/(δk̄), as mathjs reads them
//   signed    := ("-" | "+") signed | power
//   power     := postfix ("^" exponent)?
//   exponent  := ("-" | "+") exponent | postfix ("^" exponent)?
//   postfix   := atom "'"*
// `\sum` and `Σ` take the following product (juxtaposed or *-joined factors, stopping at + - / =) as the summand, so
// \sum (x_i-\bar x)^2 is Σ(x_i−x̄)². A typed `sum(` is a function call instead: sum(x)^2 = (Σx)².
import type { Fn, Node, Statement } from "./ast";
import {
  ACCENT_COMMANDS,
  type Accent,
  canonicalSub,
  COMBINING,
  GREEK_ALIASES,
  GREEK_UNICODE,
  isGreekName,
  levenshtein,
  normalize,
  splitAccentSuffix,
  typedName,
} from "./names";
import type { Sym, SymbolTable } from "./symbols";

export class ParseError extends Error {
  constructor(
    message: string,
    readonly suggestions: string[] = [],
  ) {
    super(message);
    this.name = "ParseError";
  }
}

type Tok =
  | { k: "num"; v: number }
  | { k: "sym"; key: string }
  | { k: "fn"; fn: Fn }
  | { k: "sum"; call: boolean }
  | { k: "op"; v: "+" | "-" | "*" | "/" | "^" | "=" }
  | { k: "open"; v: string }
  | { k: "close"; v: string }
  | { k: "abs" }
  | { k: "frac" }
  | { k: "sqrt" }
  | { k: "prime" };

interface Glyph {
  text: string;
  accent?: Accent;
  /** A Greek letter or a \mathrm word: never merged with neighbouring letters. */
  atomic: boolean;
}

const FUNCTIONS: Record<string, Fn | "sum"> = {
  ln: "ln", log: "ln", exp: "exp", sqrt: "sqrt", abs: "abs", trace: "trace", tr: "trace", inv: "inv", sum: "sum",
};
const SPACES = new Set([",", ";", ":", "!", " ", "quad", "qquad", "displaystyle", "textstyle"]);
const SIZERS = new Set(["left", "right", "bigl", "bigr", "Bigl", "Bigr", "big", "Big", "bigg", "Bigg", "biggl", "biggr", "middle"]);
const BOLD = new Set(["mathbf", "boldsymbol", "bm", "mathbb", "mathit", "pmb"]);
const WORD = new Set(["mathrm", "operatorname", "text", "textrm", "textit"]);
const OPEN_CLOSE: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
const MAX_PIECE = 16;

class Lexer {
  private i = 0;
  private readonly s: string;
  readonly out: Tok[] = [];

  constructor(
    src: string,
    private readonly table: SymbolTable,
  ) {
    this.s = normalize(src);
  }

  run(): Tok[] {
    while (this.i < this.s.length) this.step();
    return this.out;
  }

  private get c(): string {
    return this.s[this.i] ?? "";
  }

  private step(): void {
    const c = this.c;
    if (/\s/.test(c)) {
      this.i++;
      return;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(this.s[this.i + 1] ?? ""))) {
      const m = /^[0-9]*\.?[0-9]+/.exec(this.s.slice(this.i))!;
      this.out.push({ k: "num", v: Number(m[0]) });
      this.i += m[0].length;
      // 0_n, 0_{n×K}: a zero matrix takes its size from what it is compared with.
      if (this.c === "_") this.skipSubscript();
      return;
    }
    if (c === "^") {
      this.i++;
      this.out.push(this.transposeMark() ? { k: "prime" } : { k: "op", v: "^" });
      return;
    }
    if ("+-*/=".includes(c)) {
      this.out.push({ k: "op", v: c as "+" });
      this.i++;
      return;
    }
    if (c in OPEN_CLOSE) {
      this.out.push({ k: "open", v: c });
      this.i++;
      return;
    }
    if (")]}".includes(c)) {
      this.out.push({ k: "close", v: c });
      this.i++;
      return;
    }
    if (c === "|") {
      this.out.push({ k: "abs" });
      this.i++;
      return;
    }
    if (c === "'") {
      this.out.push({ k: "prime" });
      this.i++;
      return;
    }
    if (c === "_") throw new ParseError("a subscript needs a symbol before it");
    if (this.glyphStart()) {
      this.glyphRun();
      return;
    }
    if (c === "\\") {
      this.command();
      return;
    }
    throw new ParseError(`I can't read "${c}"`);
  }

  /** After `^`: T, {T}, \top, {\prime} and ' mean transpose (T only when no symbol is called T). */
  private transposeMark(): boolean {
    const m = /^\s*(?:(T)(?![A-Za-z])|\{\s*(T|\\top|\\intercal|\\prime|')\s*\}|\\top|\\intercal|\\prime|')/.exec(this.s.slice(this.i));
    if (!m) return false;
    if ((m[1] === "T" || m[2] === "T") && this.table.lookup("T", undefined, undefined)) return false;
    this.i += m[0].length;
    return true;
  }

  private commandName(at: number): string {
    const m = /^\\([A-Za-z]+|.)/.exec(this.s.slice(at));
    return m ? m[1]! : "";
  }

  private command(): void {
    const name = this.commandName(this.i);
    this.i += name.length + 1;
    if (SPACES.has(name)) return;
    if (SIZERS.has(name)) {
      while (/\s/.test(this.c)) this.i++;
      if (this.c === ".") this.i++;
      return;
    }
    if (name === "{") return void this.out.push({ k: "open", v: "{" });
    if (name === "}") return void this.out.push({ k: "close", v: "}" });
    if (name === "|") return void this.out.push({ k: "abs" });
    if (["cdot", "times", "ast"].includes(name)) return void this.out.push({ k: "op", v: "*" });
    if (["frac", "dfrac", "tfrac"].includes(name)) return void this.out.push({ k: "frac" });
    if (name === "sqrt") return void this.out.push({ k: "sqrt" });
    if (["top", "intercal", "prime"].includes(name)) return void this.out.push({ k: "prime" });
    if (name === "sum") {
      this.out.push({ k: "sum", call: false });
      this.skipBounds();
      return;
    }
    if (name === "ln" || name === "log" || name === "exp") return void this.out.push({ k: "fn", fn: FUNCTIONS[name] as Fn });
    if (WORD.has(name) || BOLD.has(name)) {
      const arg = this.readArg();
      const word = arg.trim();
      const f = FUNCTIONS[word];
      if (f === "sum") {
        this.out.push({ k: "sum", call: this.c === "(" });
        if (this.c !== "(") this.skipBounds();
      } else if (f) this.out.push({ k: "fn", fn: f });
      else if (/^[0-9.]+$/.test(word)) this.out.push({ k: "num", v: Number(word) });
      else throw new ParseError(`I can't read \\${name}{${word}}`);
      return;
    }
    throw new ParseError(`\\${name} isn't supported here`);
  }

  /** The braced argument of a command, or the single token after it. */
  private readArg(): string {
    while (/\s/.test(this.c)) this.i++;
    if (this.c === "{") {
      const end = this.matching(this.i);
      const arg = this.s.slice(this.i + 1, end);
      this.i = end + 1;
      return arg;
    }
    if (this.c === "\\") {
      const name = this.commandName(this.i);
      this.i += name.length + 1;
      return `\\${name}`;
    }
    const ch = this.c;
    this.i++;
    return ch;
  }

  private matching(open: number): number {
    const o = this.s[open]!;
    const close = OPEN_CLOSE[o]!;
    let depth = 0;
    for (let j = open; j < this.s.length; j++) {
      if (this.s[j] === o) depth++;
      else if (this.s[j] === close && --depth === 0) return j;
    }
    throw new ParseError(`a "${o}" is not closed`);
  }

  private skipSubscript(): void {
    this.i++;
    const c: string = this.c;
    if (c === "{" || c === "(") this.i = this.matching(this.i) + 1;
    else if (c === "\\") this.i += this.commandName(this.i).length + 1;
    else this.i++;
  }

  /** Summation bounds are decoration: Σ always runs over the data index. */
  private skipBounds(): void {
    for (let pass = 0; pass < 2; pass++) {
      while (/\s/.test(this.c)) this.i++;
      if (this.c !== "_" && this.c !== "^") return;
      this.i++;
      while (/\s/.test(this.c)) this.i++;
      const c: string = this.c;
      if (c === "{" || c === "(") this.i = this.matching(this.i) + 1;
      else if (c === "\\") this.i += this.commandName(this.i).length + 1;
      else this.i++;
    }
  }

  /** Does a symbol glyph start here (a letter, a Greek letter, an accent or bold wrapper, a \mathrm word that is not
   *  a function)? */
  private glyphStart(): boolean {
    const c = this.c;
    if (/[A-Za-z]/.test(c) || GREEK_UNICODE[c]) return true;
    if (c !== "\\") return false;
    const name = this.commandName(this.i);
    if (isGreekName(name) || GREEK_ALIASES[name] || ACCENT_COMMANDS[name]) return true;
    if (BOLD.has(name) || WORD.has(name)) {
      const save = this.i;
      this.i += name.length + 1;
      const arg = this.readArg().trim();
      this.i = save;
      return !FUNCTIONS[arg] && !/^[0-9.]+$/.test(arg);
    }
    return false;
  }

  /** One glyph (or several, for \mathbf{XY}) with no whitespace before it. */
  private readGlyphs(): Glyph[] | null {
    const c = this.c;
    if (/[A-Za-z]/.test(c) || GREEK_UNICODE[c]) {
      this.i++;
      const g: Glyph = GREEK_UNICODE[c] ? { text: GREEK_UNICODE[c], atomic: true } : { text: c, atomic: false };
      const mark = COMBINING[this.c];
      if (mark) {
        g.accent = mark;
        this.i++;
      }
      return [g];
    }
    if (c !== "\\" || !this.glyphStart()) return null;
    const name = this.commandName(this.i);
    this.i += name.length + 1;
    if (isGreekName(name) || GREEK_ALIASES[name]) return [{ text: GREEK_ALIASES[name] ?? name, atomic: true }];
    const arg = this.readArg();
    const inner = new Lexer(arg, this.table).glyphsOnly();
    if (WORD.has(name)) return [{ text: inner.map((g) => g.text).join(""), atomic: true }];
    if (BOLD.has(name)) return inner;
    // An accent over one letter, or over a short word (\bar{xy}) taken as one symbol.
    const text = inner.map((g) => g.text).join("");
    return [{ text, accent: ACCENT_COMMANDS[name], atomic: inner.length === 1 ? inner[0]!.atomic : true }];
  }

  glyphsOnly(): Glyph[] {
    const out: Glyph[] = [];
    while (/\s/.test(this.c)) this.i++;
    for (let g = this.readGlyphs(); g; g = this.readGlyphs()) out.push(...g);
    while (/\s/.test(this.c)) this.i++;
    if (this.i < this.s.length) throw new ParseError(`"${this.s}" is not a symbol`);
    return out;
  }

  private glyphRun(): void {
    const glyphs: Glyph[] = [];
    for (let g = this.readGlyphs(); g; g = this.readGlyphs()) glyphs.push(...g);
    const word = glyphs.map((g) => g.text).join("");

    // `sum` typed as a word: a call when "(" follows, else an operator with optional bounds.
    if (this.c === "_" || this.c === "^") {
      const plain = segment(glyphs, undefined, this.table);
      if (plain.ok && plain.pieces.at(-1)?.fn === "sum") {
        this.emit(plain.pieces.slice(0, -1));
        this.out.push({ k: "sum", call: false });
        this.skipBounds();
        return;
      }
    }

    // b2, x1: digits straight after a letter are a subscript when that names a symbol, else a product (k2 = k·2).
    const underscore = this.c === "_";
    const options: ({ text: string; end: number } | undefined)[] = underscore
      ? this.subscriptOptions()
      : /[0-9]/.test(this.c)
        ? [...this.digitOptions(), undefined]
        : [undefined];
    let best: Segmentation | undefined;
    for (const opt of options) {
      const seg = segment(glyphs, opt?.text, this.table);
      if (seg.ok) {
        if (opt) this.i = opt.end;
        this.emit(seg.pieces);
        return;
      }
      if (!best || seg.unknownGlyphs < best.unknownGlyphs) best = seg;
    }
    const unknown = best!.unknown!;
    const sub = underscore ? options[0]?.text : undefined;
    const spelled = unknown.last && sub !== undefined ? `${unknown.text}_${sub.length > 1 ? `{${sub}}` : sub}` : unknown.text;
    const suggestions = suggest(this.table, unknown.text, unknown.last ? sub : undefined);
    const hint = suggestions.length ? ` Did you mean ${suggestions.join(" or ")}?` : "";
    throw new ParseError(`I don't know the symbol "${spelled}"${word !== unknown.text ? ` (in "${word}")` : ""}.${hint}`, suggestions);
  }

  private emit(pieces: Piece[]): void {
    pieces.forEach((p, n) => {
      if (p.fn === "sum") this.out.push({ k: "sum", call: n === pieces.length - 1 && this.c === "(" });
      else if (p.fn) this.out.push({ k: "fn", fn: p.fn });
      else this.out.push({ k: "sym", key: p.sym!.key });
    });
  }

  /** `_t`, `_{t+1}`, `_(t+1)`, `_\alpha`; for a bare run like `_2x`, every prefix, longest first, so `b_2x_i` can be
   *  b_2 · x_i when b_{2x} is not a symbol. */
  private subscriptOptions(): { text: string; end: number }[] {
    const j = this.i + 1;
    const c = this.s[j] ?? "";
    if (c === "{" || c === "(") {
      const end = this.matching(j);
      return [{ text: canonicalSub(this.s.slice(j + 1, end)), end: end + 1 }];
    }
    if (c === "\\") {
      const name = this.commandName(j);
      return [{ text: GREEK_ALIASES[name] ?? name, end: j + name.length + 1 }];
    }
    const m = /^[A-Za-z0-9]+/.exec(this.s.slice(j));
    if (!m) throw new ParseError("a subscript is empty");
    return prefixes(m[0], j);
  }

  private digitOptions(): { text: string; end: number }[] {
    return prefixes(/^[0-9]+/.exec(this.s.slice(this.i))![0], this.i);
  }
}

/** Every prefix of a run starting at `at`, longest first. */
function prefixes(run: string, at: number): { text: string; end: number }[] {
  return Array.from({ length: run.length }, (_, n) => ({ text: run.slice(0, run.length - n), end: at + run.length - n }));
}

interface Piece {
  sym?: Sym;
  fn?: Fn | "sum";
}

interface Segmentation {
  ok: boolean;
  pieces: Piece[];
  unknownGlyphs: number;
  unknown?: { text: string; last: boolean };
}

/** Split a letter run into the fewest known pieces; only the last piece takes the subscript. Unknown letters cost
 *  far more than extra pieces, so a failed split still isolates the letters nobody declared. */
function segment(glyphs: Glyph[], sub: string | undefined, table: SymbolTable): Segmentation {
  const n = glyphs.length;
  const best: { cost: number; from: number; piece?: Piece }[] = [{ cost: 0, from: -1 }];
  for (let i = 1; i <= n; i++) {
    best[i] = { cost: Infinity, from: -1 };
    for (let j = Math.max(0, i - MAX_PIECE); j < i; j++) {
      const prev = best[j]!;
      if (prev.cost === Infinity) continue;
      const piece = resolve(glyphs.slice(j, i), i === n ? sub : undefined, table);
      const cost = prev.cost + (piece ? 1 : i - j === 1 ? 1000 : Infinity);
      if (cost < best[i]!.cost) best[i] = { cost, from: j, ...(piece ? { piece } : {}) };
    }
  }
  const pieces: Piece[] = [];
  const unknownAt: number[] = [];
  for (let i = n; i > 0; i = best[i]!.from) {
    const b = best[i]!;
    if (b.piece) pieces.unshift(b.piece);
    else unknownAt.unshift(b.from);
  }
  if (!unknownAt.length) return { ok: true, pieces, unknownGlyphs: 0 };
  // Report the first stretch of consecutive unknown letters.
  let end = unknownAt[0]!;
  while (unknownAt.includes(end + 1)) end++;
  const text = glyphs
    .slice(unknownAt[0], end + 1)
    .map((g) => g.text + (g.accent ?? ""))
    .join("");
  return { ok: false, pieces, unknownGlyphs: unknownAt.length, unknown: { text, last: end === n - 1 } };
}

function resolve(glyphs: Glyph[], sub: string | undefined, table: SymbolTable): Piece | undefined {
  if (glyphs.length > 1 && glyphs.some((g) => g.atomic)) return undefined;
  if (glyphs.slice(0, -1).some((g) => g.accent)) return undefined;
  const text = glyphs.map((g) => g.text).join("");
  const accent = glyphs.at(-1)!.accent;
  if (sub === undefined && !accent && FUNCTIONS[text] && !table.lookup(text, undefined, undefined)) return { fn: FUNCTIONS[text] };
  const direct = table.lookup(text, accent, sub);
  if (direct) return { sym: direct };
  if (!accent) {
    const split = splitAccentSuffix(text);
    const viaSuffix = split && table.lookup(split.base, split.accent, sub);
    if (viaSuffix) return { sym: viaSuffix };
  }
  return undefined;
}

/** Declared symbols that look like what was typed: same letters without the underscore (kt → k_t), same base with a
 *  different subscript or accent, or a small edit away. */
export function suggest(table: SymbolTable, text: string, sub?: string): string[] {
  const squash = (s: string) => s.replace(/[_{}()\s\\]/g, "").toLowerCase();
  const typed = sub !== undefined ? `${text}_${sub}` : text;
  const split = splitAccentSuffix(text);
  const base = split && split.base.length === 1 ? split.base : text;
  const scored: { name: string; score: number }[] = [];
  for (const s of table.all()) {
    if (s.kind === "identity" || s.kind === "const") continue;
    const name = table.typed(s.key);
    let score = Infinity;
    if (squash(name) === squash(typed)) score = 0;
    else if (s.base === base) score = 1;
    else {
      const d = levenshtein(typed.toLowerCase(), name.toLowerCase());
      if (d <= (typed.length >= 4 ? 2 : 1)) score = 1 + d;
    }
    if (score < Infinity) scored.push({ name, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((s) => s.name);
}

class Parser {
  private p = 0;

  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.p];
  }

  private isOp(v: string): boolean {
    const t = this.peek();
    return t?.k === "op" && t.v === v;
  }

  private next(): Tok {
    const t = this.toks[this.p++];
    if (!t) throw new ParseError("the line ends too early");
    return t;
  }

  statement(): Statement {
    if (!this.toks.length) throw new ParseError("the line is empty");
    const l = this.expr();
    if (this.isOp("=")) {
      this.p++;
      const r = this.expr();
      if (this.isOp("=")) throw new ParseError("write one equation per line (only one =)");
      this.end();
      return { t: "eq", l, r };
    }
    this.end();
    return l;
  }

  private end(): void {
    const t = this.peek();
    if (t) throw new ParseError(t.k === "close" ? `an extra "${t.v}"` : `I didn't expect ${describe(t)} here`);
  }

  private expr(): Node {
    let n = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.next() as { v: string }).v;
      n = { t: op === "+" ? "add" : "sub", a: n, b: this.term() };
    }
    return n;
  }

  private term(): Node {
    let n = this.chain();
    while (this.isOp("*") || this.isOp("/")) {
      const op = (this.next() as { v: string }).v;
      n = { t: op === "*" ? "mul" : "div", a: n, b: this.chain() };
    }
    return n;
  }

  private chain(): Node {
    let n = this.signed();
    while (this.startsFactor()) n = { t: "mul", a: n, b: this.power() };
    return n;
  }

  private startsFactor(): boolean {
    const t = this.peek();
    if (!t) return false;
    return t.k === "num" || t.k === "sym" || t.k === "fn" || t.k === "sum" || t.k === "frac" || t.k === "sqrt" || (t.k === "open" && t.v !== "}");
  }

  private signed(): Node {
    if (this.isOp("-")) {
      this.p++;
      return { t: "neg", a: this.signed() };
    }
    if (this.isOp("+")) {
      this.p++;
      return this.signed();
    }
    return this.power();
  }

  private power(): Node {
    const base = this.postfix();
    if (!this.isOp("^")) return base;
    this.p++;
    return { t: "pow", a: base, b: this.exponent() };
  }

  private exponent(): Node {
    if (this.isOp("-")) {
      this.p++;
      return { t: "neg", a: this.exponent() };
    }
    if (this.isOp("+")) {
      this.p++;
      return this.exponent();
    }
    return this.power();
  }

  private postfix(): Node {
    let n = this.atom();
    while (this.peek()?.k === "prime") {
      this.p++;
      n = { t: "tr", a: n };
    }
    return n;
  }

  private group(): Node {
    const open = this.next() as { k: "open"; v: string };
    const inner = this.expr();
    const close = this.peek();
    if (close?.k !== "close") throw new ParseError(close ? `I didn't expect ${describe(close)} here` : `a "${open.v}" is not closed`);
    if (close.v !== OPEN_CLOSE[open.v]) throw new ParseError(`"${open.v}" is closed by "${close.v}"`);
    this.p++;
    return inner;
  }

  /** A command argument: a braced group or a single atom. */
  private arg(): Node {
    const t = this.peek();
    return t?.k === "open" ? this.group() : this.postfix();
  }

  private atom(): Node {
    const t = this.peek();
    if (!t) throw new ParseError("the line ends too early");
    switch (t.k) {
      case "num":
        this.p++;
        return { t: "num", v: t.v };
      case "sym":
        this.p++;
        return { t: "sym", key: t.key };
      case "open":
        return this.group();
      case "frac": {
        this.p++;
        const a = this.arg();
        return { t: "div", a, b: this.arg() };
      }
      case "sqrt":
        this.p++;
        return { t: "fn", fn: "sqrt", a: this.arg() };
      case "fn":
        this.p++;
        return { t: "fn", fn: t.fn, a: this.peek()?.k === "open" ? this.group() : this.power() };
      case "sum": {
        this.p++;
        if (t.call) return { t: "sum", a: this.group() };
        let a = this.chain();
        while (this.isOp("*")) {
          this.p++;
          a = { t: "mul", a, b: this.chain() };
        }
        return { t: "sum", a };
      }
      case "abs": {
        this.p++;
        const a = this.expr();
        if (this.peek()?.k !== "abs") throw new ParseError('a "|" is not closed');
        this.p++;
        return { t: "fn", fn: "abs", a };
      }
      default:
        throw new ParseError(`I expected a value but found ${describe(t)}`);
    }
  }
}

function describe(t: Tok): string {
  switch (t.k) {
    case "op":
    case "open":
    case "close":
      return `"${t.v}"`;
    case "prime":
      return "a transpose mark";
    default:
      return `"${t.k}"`;
  }
}

/** Data symbols mean x_i, which only exists inside a sum. */
function checkSums(n: Node, table: SymbolTable, inSum = false): void {
  if (n.t === "sym") {
    const s = table.get(n.key);
    if (s?.kind === "data" && !inSum) {
      const name = typedName({ base: s.base, sub: s.index });
      throw new ParseError(`${name} only makes sense inside a sum: did you mean sum(${name}) or ${s.base}bar?`);
    }
    return;
  }
  if (n.t === "num") return;
  const inner = inSum || n.t === "sum";
  checkSums(n.a, table, inner);
  if ("b" in n) checkSums(n.b, table, inner);
}

export function parseStatement(src: string, table: SymbolTable): Statement {
  const s = new Parser(new Lexer(src, table).run()).statement();
  if (s.t === "eq") {
    checkSums(s.l, table);
    checkSums(s.r, table);
  } else checkSums(s, table);
  return s;
}

export function parseExpression(src: string, table: SymbolTable): Node {
  const s = parseStatement(src, table);
  if (s.t === "eq") throw new ParseError("expected an expression, not an equation");
  return s;
}
