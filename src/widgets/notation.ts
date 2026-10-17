// Which Notation row explains a widget symbol. A port of the parts of vault_tool.py's TeX tokenizer that the
// exporter uses to key rows (tex_symbols, tex_norm, row_keys, row_matches), so a slider's `tex` finds the same row
// in the player that `vault_tool.py check` found when it enforced the notation rule. Keep the two in step.
import type { NotationRow } from "../ir";

const GREEK = "alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Sigma|Phi|Psi|Omega";
const GREEK_NAMES = new Set([...GREEK.split("|"), "vartheta", "varrho", "varsigma", "varpi", "upsilon", "Xi", "Pi", "Upsilon", "ell"]);
const UNICODE_GREEK: Record<string, string> = (() => {
  const chars = [..."αβγδεϵζηθϑικλμνξπϖρϱσςτυφϕχψωΓΔΘΛΞΠΣΥΦΨΩ"];
  const names = ("alpha beta gamma delta varepsilon epsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho " +
    "sigma varsigma tau upsilon varphi phi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega").split(" ");
  return Object.fromEntries(chars.map((c, i) => [c, names[i]!]));
})();
const COMBINING: Record<string, string> = { "̄": "bar", "̅": "bar", "̃": "tilde", "̂": "hat", "̇": "dot", "̈": "ddot" };
const TEX_DECOR: Record<string, string> = {
  bar: "bar", overline: "bar", hat: "hat", widehat: "hat", tilde: "tilde", widetilde: "tilde",
  dot: "dot", ddot: "ddot", vec: "vec", check: "check", breve: "breve", acute: "acute", grave: "grave",
};
const TEX_STYLE: Record<string, string> = {
  mathbf: "bold", boldsymbol: "bold", bm: "bold", pmb: "bold", mathbb: "bb", mathcal: "cal",
  mathscr: "scr", mathfrak: "frak", mathit: "", mathsf: "", mathnormal: "",
};
const TEX_SKIP = new Set(["text", "textrm", "textit", "textbf", "textsf", "texttt", "mathrm", "operatorname", "mbox", "hbox", "begin",
  "end", "label", "tag", "hspace", "vspace", "color", "textcolor", "htmlClass", "href", "phantom"]);
const TEX_SPACE = new Set([",", ";", ":", "!", " ", "quad", "qquad", "left", "right", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr"]);

type Tok = [kind: "cmd" | "chr" | "{" | "}", val: string];

const isLetter = (s: string) => /^\p{L}$/u.test(s);
const isSpace = (s: string) => /^\s$/.test(s);
const isAsciiLetter = (s: string) => /^[A-Za-z]$/.test(s);

function texUnicode(s: string): string {
  const out: string[] = [];
  for (const ch of s.normalize("NFD")) {
    const last = out[out.length - 1];
    if (ch in COMBINING && last !== undefined && ((last.length === 1 && isLetter(last)) || (last.startsWith("\\") && last.endsWith(" ")))) {
      out[out.length - 1] = `\\${COMBINING[ch]}{${last.trim()}}`;
    } else if (ch in UNICODE_GREEK) {
      out.push(`\\${UNICODE_GREEK[ch]} `);
    } else if (ch === "∗" || ch === "⋆") {
      out.push("*");
    } else if (ch === "′") {
      out.push("'");
    } else {
      out.push(ch);
    }
  }
  return out.join("");
}

function lex(s: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\\") {
      const m = /^\\([A-Za-z]+|[\s\S])/.exec(s.slice(i));
      if (!m) break;
      toks.push(["cmd", m[1]!]);
      i += m[0].length;
    } else {
      const ch = s[i]!;
      toks.push([ch === "{" || ch === "}" ? ch : "chr", ch]);
      i += 1;
    }
  }
  return toks;
}

/** The argument starting at toks[i] (a braced group or one token) and the index after it. */
function arg(toks: Tok[], i: number): [Tok[], number] {
  while (i < toks.length && toks[i]![0] === "chr" && isSpace(toks[i]![1])) i++;
  if (i >= toks.length) return [[], i];
  if (toks[i]![0] !== "{") return [[toks[i]!], i + 1];
  let depth = 1;
  let j = i + 1;
  while (j < toks.length && depth) {
    const k = toks[j]![0];
    depth += k === "{" ? 1 : k === "}" ? -1 : 0;
    j++;
  }
  return [toks.slice(i + 1, depth === 0 ? j - 1 : j), j];
}

const sameTok = (t: Tok, kind: Tok[0], val: string) => t[0] === kind && t[1] === val;

function walk(toks: Tok[]): string[] {
  const keys: string[] = [];
  let last: number | null = null;
  let i = 0;
  while (i < toks.length) {
    const [kind, val] = toks[i]!;
    if (kind === "cmd") {
      if (val in TEX_DECOR || val in TEX_STYLE) {
        const [sub, next] = arg(toks, i + 1);
        i = next;
        const inner = walk(sub);
        if (val in TEX_DECOR && inner.length !== 1) {
          keys.push(...inner);
          last = null;
          continue;
        }
        const wrap = TEX_DECOR[val] ?? TEX_STYLE[val];
        keys.push(...inner.map((x) => (wrap ? `${wrap}(${x})` : x)));
        last = inner.length === 1 ? keys.length - 1 : null;
      } else if (TEX_SKIP.has(val)) {
        i = arg(toks, i + 1)[1];
        last = null;
      } else if (GREEK_NAMES.has(val)) {
        keys.push(val);
        last = keys.length - 1;
        i++;
      } else {
        last = TEX_SPACE.has(val) || val === "prime" ? last : null;
        i++;
      }
    } else if (kind === "chr") {
      if (isAsciiLetter(val)) {
        keys.push(val);
        last = keys.length - 1;
        i++;
      } else if (val === "_") {
        // Subscripts are indices; a star may still follow (k_t^*).
        i = arg(toks, i + 1)[1];
      } else if (val === "^") {
        const [sub, next] = arg(toks, i + 1);
        i = next;
        const core = sub.filter((t) => !(t[0] === "chr" && isSpace(t[1])));
        const starred = core.every((t) => sameTok(t, "chr", "*") || sameTok(t, "cmd", "ast") || sameTok(t, "cmd", "star"));
        const primed = core.every((t) => sameTok(t, "chr", "'") || sameTok(t, "cmd", "prime"));
        if (core.length && last !== null && starred) keys[last] += "*";
        else if (!(core.length && primed)) keys.push(...walk(sub));
        last = null;
      } else {
        if (!(val === "'" || isSpace(val))) last = null;
        i++;
      }
    } else if (kind === "{") {
      const [sub, next] = arg(toks, i);
      i = next;
      const inner = walk(sub);
      keys.push(...inner);
      last = inner.length === 1 ? keys.length - 1 : null;
    } else {
      i++;
    }
  }
  return keys;
}

const symCache = new Map<string, string[]>();

/** Symbols in a TeX string as normalized keys ('k', 'alpha', 'bar(k)', 'k*'), in order, repeats kept. */
export function texSymbols(tex: string): string[] {
  let v = symCache.get(tex);
  if (!v) {
    v = walk(lex(texUnicode(tex)));
    symCache.set(tex, v);
  }
  return v;
}

/** TeX with spacing, sizing and braces removed, for matching whole expressions like '\delta k'. */
export function texNorm(tex: string): string {
  let s = texUnicode(tex);
  s = s.replace(/\\(?:left|right|[bB]igg?[lr]?)(?![A-Za-z])/g, "");
  s = s.replace(/\\(?:qquad|quad)(?![A-Za-z])|\\[,;:! ]/g, "");
  return s.replace(/[\s{}]/g, "");
}

const MATH_INLINE = /(?<![\\$])\$(?!\$)((?:\\\$|[^$\n])+?)\$(?!\$)/g;

/** TeX inside the $…$ groups of a markdown string (an escaped \$ is currency, not math). */
export function mathGroups(text: string): string[] {
  return [...text.matchAll(MATH_INLINE)].map((m) => m[1]!);
}

/** Keys a notation cell answers to: per $…$ group, the symbol left of any '=' ('f(k) = Ak^α' -> f); a group that
 *  is an expression ('sf(k)', '\delta k') is keyed '~' + its normalized TeX and matches as a substring. */
/** 'k^*, y^*, c^*' -> three symbols; commas inside braces or brackets ('f(x, y)') do not split. Mirrors vault_tool.py. */
function topLevelParts(group: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < group.length; i++) {
    const c = group[i]!;
    if (c === "\\") {
      cur += group.slice(i, i + 2);
      i++;
      continue;
    }
    depth += Number("{([".includes(c)) - Number("})]".includes(c));
    if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  return [...parts, cur].map((p) => p.trim()).filter(Boolean);
}

export function rowKeys(cell: string): string[] {
  const keys: string[] = [];
  const groups = mathGroups(cell);
  for (const g of (groups.length ? groups : [cell]).flatMap(topLevelParts)) {
    const lhs = g.split("=")[0]!.trim();
    const syms = texSymbols(lhs.replace(/\([^()]*\)\s*$/, ""));
    const key = syms.length === 1 ? syms[0]! : syms.length ? `~${texNorm(lhs)}` : null;
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

export function rowMatches(keys: readonly string[], syms: ReadonlySet<string>, norm: string): boolean {
  return keys.some((k) => (k.startsWith("~") ? norm.includes(k.slice(1)) : syms.has(k)));
}

/** The notation row that explains `tex` (a slider, curve or readout symbol). The row keyed the way `tex` itself
 *  would be keyed as a Symbol cell wins ('f(k)' -> the f row, not the k row); otherwise the first row it mentions. */
export function notationFor(rows: readonly NotationRow[], tex: string | undefined): NotationRow | undefined {
  if (!tex) return undefined;
  const keyed = rows.map((r) => ({ r, keys: r.keys.length ? r.keys : rowKeys(r.tex) }));
  const own = rowKeys(`$${tex}$`);
  const head = keyed.find(({ keys }) => keys.some((k) => own.includes(k)));
  if (head) return head.r;
  const syms = new Set(texSymbols(tex));
  const norm = texNorm(tex);
  return keyed.find(({ keys }) => rowMatches(keys, syms, norm))?.r;
}
