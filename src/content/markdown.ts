// Markdown for IR fields: markdown-it plus a math rule that hands $…$ / $$…$$ to KaTeX before any other inline
// rule sees it (so `k_{t}` is never read as emphasis), note: links rewritten to in-app routes, and <assets/...>
// images resolved against the content root. Output is cached per string: the same notation cell or link list
// renders many times across a lesson.
//
// Symbol hover: `withNotation(rows)` gives a renderer for one note whose math wraps every occurrence of a Notation
// symbol in \htmlClass{sym sym-<row>}{…}, so the page can explain it on hover or tap. It is memoized per rows array,
// which is stable for a loaded note, so each note's math is wrapped and rendered once.
import katex from "katex";
import MarkdownIt from "markdown-it";
import type { StateInline } from "markdown-it";
import type { NotationRow } from "../ir";
import { texToHtml } from "../lib/Tex";
import { rowKeys, texSymbols } from "../widgets/notation";

export type MarkdownOptions = {
  /** In-app href for a note link, or null when the slug is unknown (rendered as plain text). */
  noteHref: (slug: string, anchor: string | undefined) => string | null;
  /** Absolute URL for a content-relative path such as assets/Attachments/x.png. */
  assetUrl: (src: string) => string;
};

export type Markdown = {
  /** Block markdown: paragraphs, lists, tables. */
  block: (md: string) => string;
  /** One line of inline markdown, no wrapping <p>. */
  inline: (md: string) => string;
  /** A bare TeX string (a math block), as KaTeX HTML. */
  math: (tex: string, display: boolean) => string;
  /** The same renderer with this note's Notation symbols wrapped for hover (`.sym.sym-<row index>`). */
  withNotation: (rows: readonly NotationRow[]) => Markdown;
};

// Same shape as vault_tool.py MATH_INLINE, so the player and the exporter agree on where math is:
// no `$$`, escaped dollars allowed inside, no newline, closing `$` not followed by another `$`.
const INLINE_MATH = /\$(?!\$)((?:\\\$|[^$\n])+?)\$(?!\$)/y;
const DISPLAY_MATH = /\$\$([\s\S]+?)\$\$/y;
const NOTE_HREF = /^note:([a-z0-9-]+)(?:#(.*))?$/;
const CACHE_LIMIT = 4000;

function mathRule(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x24 /* $ */) return false;
  // `\$` is consumed by the escape rule before we get here, and a `$` right after another `$` is the second
  // half of `$$`, which the display branch below has already taken.
  if (state.pos > 0 && state.src.charCodeAt(state.pos - 1) === 0x24) return false;
  for (const [re, display] of [[DISPLAY_MATH, true], [INLINE_MATH, false]] as const) {
    re.lastIndex = state.pos;
    const m = re.exec(state.src);
    if (!m || m.index + m[0].length > state.posMax) continue;
    if (!silent) {
      const token = state.push(display ? "math_display" : "math_inline", "math", 0);
      token.content = m[1]!.trim();
      token.markup = display ? "$$" : "$";
    }
    state.pos += m[0].length;
    return true;
  }
  return false;
}

// ---------- symbol wrapping ----------

/** Normalized symbol key ('k', 'bar(k)', 'k*') -> index of the first Notation row that defines it. Compound keys
 *  ('~sf(k)', a whole expression matched as a normalized substring) are left out: their occurrences do not line up
 *  with token boundaries reliably enough to wrap. */
export type SymbolIndex = ReadonlyMap<string, number>;

export function symbolIndex(rows: readonly NotationRow[]): SymbolIndex {
  const index = new Map<string, number>();
  rows.forEach((row, n) => {
    for (const key of row.keys.length ? row.keys : rowKeys(row.tex)) if (!key.startsWith("~") && !index.has(key)) index.set(key, n);
  });
  return index;
}

type Tok = { kind: "cmd" | "chr" | "{" | "}"; val: string; start: number; end: number };

function lex(s: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\\") {
      const m = /^\\([A-Za-z]+|[\s\S])/.exec(s.slice(i, i + 64));
      const len = m ? m[0].length : 1;
      toks.push({ kind: "cmd", val: m ? m[1]! : "", start: i, end: i + len });
      i += len;
    } else {
      // One code point, so a non-BMP letter is never split.
      const ch = String.fromCodePoint(s.codePointAt(i)!);
      toks.push({ kind: ch === "{" || ch === "}" ? ch : "chr", val: ch, start: i, end: i + ch.length });
      i += ch.length;
    }
  }
  return toks;
}

type Arg = { lo: number; hi: number; end: number; braced: boolean; closed: boolean };

/** The argument starting at toks[i] (after spaces): a braced group's inner token range, or one token. */
function arg(toks: Tok[], i: number): Arg {
  while (isSpace(toks[i])) i++;
  if (i >= toks.length) return { lo: i, hi: i, end: i, braced: false, closed: true };
  if (toks[i]!.kind !== "{") return { lo: i, hi: i + 1, end: i + 1, braced: false, closed: true };
  let depth = 1;
  let j = i + 1;
  while (j < toks.length && depth) {
    depth += toks[j]!.kind === "{" ? 1 : toks[j]!.kind === "}" ? -1 : 0;
    j++;
  }
  return depth === 0 ? { lo: i + 1, hi: j - 1, end: j, braced: true, closed: true } : { lo: i + 1, hi: j, end: j, braced: true, closed: false };
}

type CmdKind = { kind: "symbol" } | { kind: "skip" } | { kind: "plain" } | { kind: "decor" } | { kind: "style"; wrap: string };

const cmdKinds = new Map<string, CmdKind>();

/** How the exporter's tokenizer (the TS port in widgets/notation.ts) treats a command, found by asking it rather
 *  than keeping a second copy of its tables: a symbol (\alpha), one that hides its argument (\text), a decoration
 *  that makes a new symbol of one (\bar), a font style that renames every symbol inside (\mathbf), or plain. */
function cmdKind(name: string): CmdKind {
  let k = cmdKinds.get(name);
  if (k) return k;
  const one = texSymbols(`\\${name}`);
  const x = texSymbols(`\\${name}{x}`);
  if (one.length === 1) k = { kind: "symbol" };
  else if (x.length === 0) k = { kind: "skip" };
  else if (x.length === 1 && x[0] !== "x") {
    const xy = texSymbols(`\\${name}{xy}`);
    k = xy[0] === "x" ? { kind: "decor" } : { kind: "style", wrap: x[0]!.slice(0, x[0]!.indexOf("(")) };
  } else k = { kind: "plain" };
  cmdKinds.set(name, k);
  return k;
}

// Environments whose first group is a column spec, not math.
const SPEC_ENVS = new Set(["array", "subarray", "darray", "tabular"]);
function isSpace(t: Tok | undefined): boolean {
  return t?.kind === "chr" && /^\s$/.test(t.val);
}
const isLetter = (t: Tok | undefined) => t?.kind === "chr" && /^\p{L}$/u.test(t.val);
const isLower = (t: Tok | undefined) => t?.kind === "chr" && /^[a-z]$/.test(t.val);

const WRAPPED = /\\htmlClass\{sym sym-\d+\}/;

/** `tex` with each Notation symbol wrapped as `{\htmlClass{sym sym-<row>}{…}}`. A symbol is matched the way the
 *  exporter keys it: decorations and font styles belong to it (\bar{k}, \mathbf{X}), so do its subscripts, a star
 *  or primes (k_t, k^*, f'), which therefore sit inside the wrapper; a superscript that holds symbols of its own
 *  (k^{\alpha}) stays outside and is wrapped separately. \text{…}-like arguments, column specs and existing
 *  \htmlClass groups are copied untouched, which also makes the function idempotent. Runs of three or more
 *  lowercase letters are words (wage, educ, sqft), not products of one-letter symbols. */
export function wrapSymbols(tex: string, index: SymbolIndex): string {
  if (index.size === 0) return tex;
  const t = lex(tex);
  const src = (a: number, b: number) => (a < b ? tex.slice(t[a]!.start, t[b - 1]!.end) : "");
  const wrap = (n: number, s: string) => `{\\htmlClass{sym sym-${n}}{${s}}}`;

  function group(a: Arg, pre: (k: string) => string): string {
    return a.braced ? `{${rw(a.lo, a.hi, pre)}${a.closed ? "}" : ""}` : rw(a.lo, a.hi, pre);
  }
  /** Source between an operator or command at `at` and its argument's content (spaces, and nothing else). */
  const lead = (at: number, a: Arg) => src(at + 1, a.braced ? a.lo - 1 : a.lo);

  /** A symbol starting at t[i] whose base ends at `baseEnd`: its rewrite and the index after it. */
  function unit(i: number, baseEnd: number, pre: (k: string) => string): [string, number] {
    const scripts: { at: number; a?: Arg; sup: boolean }[] = [];
    let j = baseEnd;
    for (;;) {
      let k = j;
      while (isSpace(t[k])) k++;
      const tok = t[k];
      if (tok?.kind === "chr" && (tok.val === "_" || tok.val === "^")) {
        const a = arg(t, k + 1);
        scripts.push({ at: k, a, sup: tok.val === "^" });
        j = a.end;
      } else if (tok?.kind === "chr" && tok.val === "'") {
        scripts.push({ at: k, sup: false });
        j = k + 1;
      } else break;
    }
    const key = (keys: string[]) => (keys.length === 1 ? index.get(pre(keys[0]!)) : undefined);
    const whole = texSymbols(src(i, j));
    if (whole.length <= 1) {
      const n = key(whole);
      return [n === undefined ? src(i, j) : wrap(n, src(i, j)), j];
    }
    // A superscript with symbols in it: wrap the base alone and keep the scripts attached to it, so subscript and
    // superscript still stack.
    const n = key(texSymbols(src(i, baseEnd)));
    let out = n === undefined ? src(i, baseEnd) : wrap(n, src(i, baseEnd));
    let at = baseEnd;
    for (const s of scripts) {
      out += src(at, s.at + 1);
      if (s.a) out += s.sup ? lead(s.at, s.a) + group(s.a, pre) : src(s.at + 1, s.a.end);
      at = s.a ? s.a.end : s.at + 1;
    }
    return [out, j];
  }

  function rw(lo: number, hi: number, pre: (k: string) => string): string {
    let out = "";
    let i = lo;
    while (i < hi) {
      const tok = t[i]!;
      let next = i + 1;
      if (tok.kind === "cmd" && /^[A-Za-z]+$/.test(tok.val)) {
        const kind = tok.val === "htmlClass" ? undefined : cmdKind(tok.val);
        if (!kind) {
          next = arg(t, arg(t, i + 1).end).end;
          out += src(i, next);
        } else if (kind.kind === "symbol") {
          [out, next] = append(out, unit(i, i + 1, pre));
        } else if (kind.kind === "skip") {
          const a = arg(t, i + 1);
          next = tok.val === "begin" && SPEC_ENVS.has(src(a.lo, a.hi).trim()) ? arg(t, a.end).end : a.end;
          out += src(i, next);
        } else if (kind.kind === "decor" || kind.kind === "style") {
          const a = arg(t, i + 1);
          if (texSymbols(src(i, a.end)).length === 1) {
            [out, next] = append(out, unit(i, a.end, pre));
          } else {
            const inner = kind.kind === "style" ? (k: string) => pre(`${kind.wrap}(${k})`) : pre;
            out += src(i, i + 1) + lead(i, a) + group(a, inner);
            next = a.end;
          }
        } else {
          out += src(i, next);
        }
      } else if (tok.kind === "cmd") {
        // `\\[4pt]` takes a length, not math.
        if (tok.val === "\\" && t[next]?.val === "[") {
          while (next < hi && t[next]!.val !== "]") next++;
          next = Math.min(hi, next + 1);
        }
        out += src(i, next);
      } else if (isLetter(tok)) {
        let run = i;
        while (run < hi && isLower(t[run])) run++;
        if (run - i >= 3 && !isLetter(t[run]) && !isLetter(t[i - 1])) {
          next = run;
          out += src(i, next);
        } else {
          [out, next] = append(out, unit(i, i + 1, pre));
        }
      } else if (tok.kind === "chr" && tok.val === "_") {
        // An index, never a symbol of its own (as in the exporter).
        next = arg(t, i + 1).end;
        out += src(i, next);
      } else if (tok.kind === "chr" && tok.val === "^") {
        const a = arg(t, i + 1);
        out += src(i, i + 1) + lead(i, a) + group(a, pre);
        next = a.end;
      } else if (tok.kind === "{") {
        const a = arg(t, i);
        out += group(a, pre);
        next = a.end;
      } else {
        out += src(i, next);
      }
      i = next;
    }
    return out;
  }
  const append = (out: string, [s, next]: [string, number]): [string, number] => [out + s, next];

  return rw(0, t.length, (k) => k);
}

// Only \htmlClass is trusted, and only the wrapper above uses it; anything else that needs trust (\href,
// \includegraphics, \htmlData) still renders as unsupported.
const KATEX_HOVER = {
  throwOnError: false,
  strict: "ignore",
  trust: (ctx: { command: string }) => ctx.command === "\\htmlClass",
  output: "htmlAndMathml",
} as const;

/** KaTeX HTML with symbols wrapped; the plain rendering when nothing matched or wrapping ever upsets KaTeX. */
export function mathWithSymbols(tex: string, display: boolean, index: SymbolIndex): string {
  const wrapped = wrapSymbols(tex, index);
  if (!WRAPPED.test(wrapped)) return texToHtml(tex, display);
  const html = katex.renderToString(wrapped, { ...KATEX_HOVER, displayMode: display });
  return html.includes("katex-error") ? texToHtml(tex, display) : html;
}

type Env = { symbols?: SymbolIndex };

export function createMarkdown(opts: MarkdownOptions): Markdown {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });
  md.inline.ruler.before("escape", "math", mathRule);
  const math = (tex: string, display: boolean, env: Env | undefined) => (env?.symbols ? mathWithSymbols(tex, display, env.symbols) : texToHtml(tex, display));
  md.renderer.rules.math_inline = (tokens, i, _o, env: Env) => math(tokens[i]!.content, false, env);
  md.renderer.rules.math_display = (tokens, i, _o, env: Env) => `<span class="math-display">${math(tokens[i]!.content, true, env)}</span>`;

  // note: is not a scheme markdown-it knows, and asset paths are relative; both are fine to let through.
  const defaultValidate = md.validateLink.bind(md);
  md.validateLink = (url) => NOTE_HREF.test(url) || defaultValidate(url);
  md.normalizeLink = ((normalize) => (url: string) => (NOTE_HREF.test(url) ? url : normalize(url)))(md.normalizeLink.bind(md));

  const renderToken = md.renderer.renderToken.bind(md.renderer);
  md.renderer.rules.link_open = (tokens, i, options, _env, self) => {
    const token = tokens[i]!;
    const href = token.attrGet("href") ?? "";
    const note = NOTE_HREF.exec(href);
    if (note) {
      const slug = note[1]!;
      const anchor = note[2] ? decodeURIComponent(note[2]) : undefined;
      const target = opts.noteHref(slug, anchor);
      token.attrSet("href", target ?? "#/library");
      token.attrSet("data-note", slug);
      if (anchor) token.attrSet("data-anchor", anchor);
      token.attrJoin("class", target ? "note-link" : "note-link note-link-missing");
    } else if (/^assets\//.test(href)) {
      token.attrSet("href", opts.assetUrl(href));
      token.attrSet("target", "_blank");
    } else if (/^https?:/i.test(href)) {
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noopener noreferrer");
      token.attrJoin("class", "external-link");
    }
    return self.renderToken(tokens, i, options);
  };
  md.renderer.rules.image = (tokens, i, options, env, self) => {
    const token = tokens[i]!;
    const src = token.attrGet("src") ?? "";
    if (/^assets\//.test(src)) token.attrSet("src", opts.assetUrl(src));
    token.attrSet("loading", "lazy");
    token.attrSet("decoding", "async");
    token.attrSet("alt", self.renderInlineAsText(token.children ?? [], options, env));
    return renderToken(tokens, i, options);
  };
  // Wide tables scroll inside their own box instead of widening the step column.
  md.renderer.rules.table_open = (tokens, i, options) => `<div class="table-scroll" tabindex="0">${renderToken(tokens, i, options)}`;
  md.renderer.rules.table_close = (tokens, i, options) => `${renderToken(tokens, i, options)}</div>`;

  const cached = (render: (s: string) => string) => {
    const cache = new Map<string, string>();
    return (s: string) => {
      let html = cache.get(s);
      if (html === undefined) {
        html = render(s);
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
        cache.set(s, html);
      }
      return html;
    };
  };

  const perNote = new WeakMap<readonly NotationRow[], Markdown>();
  const build = (env: Env): Markdown => {
    const inlineMath = cached((tex) => math(tex, false, env));
    const displayMath = cached((tex) => math(tex, true, env));
    return {
      block: cached((s) => md.render(s, env)),
      inline: cached((s) => md.renderInline(s, env)),
      math: (tex, display) => (display ? displayMath(tex) : inlineMath(tex)),
      withNotation,
    };
  };
  const plain = build({});
  function withNotation(rows: readonly NotationRow[]): Markdown {
    let m = perNote.get(rows);
    if (!m) {
      const symbols = symbolIndex(rows);
      m = symbols.size ? build({ symbols }) : plain;
      perNote.set(rows, m);
    }
    return m;
  }
  return plain;
}
