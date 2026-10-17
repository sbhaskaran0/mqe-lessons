// Symbol names: Greek letters, accents and subscripts, in every spelling a student or author might use, reduced to
// one canonical key. `kbar`, `k̄`, `\bar{k}` and `\overline{k}` are all "bar:k"; `k_(t+1)`, `k_{t+1}` and `k_{t + 1}`
// are all "k_t+1".

export type Accent = "bar" | "hat" | "tilde";

export const ACCENTS: readonly Accent[] = ["bar", "hat", "tilde"];

export const GREEK = [
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu", "xi",
  "pi", "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega",
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
] as const;

const GREEK_SET = new Set<string>(GREEK);
export const isGreekName = (s: string): boolean => GREEK_SET.has(s);

/** LaTeX spellings that name the same letter. */
export const GREEK_ALIASES: Record<string, string> = { varepsilon: "epsilon", varphi: "phi", vartheta: "theta", varrho: "rho", varsigma: "sigma" };

/** Unicode Greek → name. Capital Σ is not here: it is the summation sign. */
export const GREEK_UNICODE: Record<string, string> = {
  "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "epsilon", "ϵ": "epsilon", "ζ": "zeta", "η": "eta",
  "θ": "theta", "ϑ": "theta", "ι": "iota", "κ": "kappa", "λ": "lambda", "μ": "mu", "ν": "nu", "ξ": "xi", "π": "pi",
  "ρ": "rho", "σ": "sigma", "τ": "tau", "υ": "upsilon", "φ": "phi", "ϕ": "phi", "χ": "chi", "ψ": "psi", "ω": "omega",
  "Γ": "Gamma", "Δ": "Delta", "Θ": "Theta", "Λ": "Lambda", "Ξ": "Xi", "Π": "Pi", "Υ": "Upsilon", "Φ": "Phi",
  "Ψ": "Psi", "Ω": "Omega",
};

/** Combining marks placed after a letter: k̄, β̂, k̃. */
export const COMBINING: Record<string, Accent> = { "̄": "bar", "̅": "bar", "̂": "hat", "̃": "tilde" };

/** LaTeX accent commands. */
export const ACCENT_COMMANDS: Record<string, Accent> = {
  bar: "bar", overline: "bar", hat: "hat", widehat: "hat", tilde: "tilde", widetilde: "tilde",
};

const SUPERSCRIPT: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-",
  "⁺": "+", "⁽": "(", "⁾": ")", "ⁿ": "n", "ⁱ": "i", "ᵀ": "T",
};
const SUBSCRIPT: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "₊": "+",
  "₋": "-", "₍": "(", "₎": ")", "ᵢ": "i", "ⱼ": "j", "ₜ": "t", "ₙ": "n", "ₖ": "k", "ₘ": "m",
};
const SUP_RUN = new RegExp(`[${Object.keys(SUPERSCRIPT).join("")}]+`, "g");
const SUB_RUN = new RegExp(`[${Object.keys(SUBSCRIPT).join("")}]+`, "g");

/** Rewrite Unicode operators, super/subscript digits and math delimiters into the ASCII/LaTeX the lexer reads. */
export function normalize(src: string): string {
  return src
    .normalize("NFD")
    .replace(/\$/g, " ")
    .replace(SUP_RUN, (m) => `^{${[...m].map((c) => SUPERSCRIPT[c]).join("")}}`)
    .replace(SUB_RUN, (m) => `_{${[...m].map((c) => SUBSCRIPT[c]).join("")}}`)
    .replace(/\*\*/g, "^")
    .replace(/[−–—]/g, "-")
    .replace(/[·⋅∙×]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[′’‘]/g, "'")
    .replace(/[Σ∑]/g, "\\sum ")
    .replace(/√/g, "\\sqrt ")
    .replace(/⊤/g, "\\top ")
    .replace(/[   ]/g, " ");
}

/** Canonical subscript text: no spaces, no grouping braces. */
export function canonicalSub(sub: string): string {
  let s = sub.replace(/\s+/g, "");
  while (/^[({].*[)}]$/.test(s) && balanced(s.slice(1, -1))) s = s.slice(1, -1);
  return s.replace(/[{}]/g, "");
}

function balanced(s: string): boolean {
  let depth = 0;
  for (const c of s) {
    if (c === "(" || c === "{") depth++;
    else if (c === ")" || c === "}") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

export interface Name {
  base: string;
  accent?: Accent;
  sub?: string;
}

export function keyOf(n: Name): string {
  return `${n.accent ? `${n.accent}:` : ""}${n.base}${n.sub !== undefined ? `_${n.sub}` : ""}`;
}

/** The ASCII spelling a student would type: kbar, k_t, k_{t+1}, alpha. */
export function typedName(n: Name): string {
  const sub = n.sub === undefined ? "" : /^[A-Za-z0-9]$/.test(n.sub) ? `_${n.sub}` : `_{${n.sub}}`;
  return `${n.base}${n.accent ?? ""}${sub}`;
}

export function baseLatex(base: string, bold = false): string {
  if (isGreekName(base)) return bold ? `\\boldsymbol{\\${base}}` : `\\${base}`;
  if (base.length > 1) return `\\mathrm{${base}}`;
  return bold ? `\\mathbf{${base}}` : base;
}

export function nameLatex(n: Name, bold = false): string {
  let s = baseLatex(n.base, bold);
  if (n.accent) s = `\\${n.accent}{${s}}`;
  if (n.sub !== undefined) s += `_{${n.sub}}`;
  return s;
}

/** Split a trailing accent word off an ASCII spelling: "kbar" → k + bar, "betahat" → beta + hat. */
export function splitAccentSuffix(text: string): { base: string; accent: Accent } | undefined {
  for (const a of ACCENTS) {
    if (text.length > a.length && text.endsWith(a)) return { base: text.slice(0, -a.length), accent: a };
  }
  return undefined;
}

/** Read one symbol name as an author declares it (`\bar{k}`, `k_{t+1}`, `\alpha`, `kbar`, `\mathbf{X}`). Unlike
 *  student input, a declared name is never split into a product: `MPK` is one symbol. */
export function parseName(src: string): Name {
  let s = normalize(src).trim();
  let accent: Accent | undefined;
  let sub: string | undefined;
  const subAt = findSubscript(s);
  if (subAt >= 0) {
    sub = canonicalSub(s.slice(subAt + 1));
    s = s.slice(0, subAt);
  }
  // Peel wrappers: \bar{...}, \mathbf{...}, \boldsymbol{...}
  for (;;) {
    const m = /^\\([A-Za-z]+)\s*(?:\{(.*)\}|\s+(\S+)|(\\[A-Za-z]+|[A-Za-z]))$/.exec(s);
    if (!m) break;
    const cmd = m[1]!;
    const inner = (m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (ACCENT_COMMANDS[cmd]) accent = ACCENT_COMMANDS[cmd];
    else if (!["mathbf", "boldsymbol", "bm", "mathrm", "mathit", "operatorname", "text"].includes(cmd)) break;
    s = inner;
  }
  const last = s.at(-1);
  if (last && COMBINING[last]) {
    accent = COMBINING[last];
    s = s.slice(0, -1);
  }
  if (s.startsWith("\\")) s = s.slice(1);
  s = GREEK_UNICODE[s] ?? GREEK_ALIASES[s] ?? s;
  if (!accent) {
    const split = splitAccentSuffix(s);
    if (split && (split.base.length === 1 || isGreekName(split.base))) {
      s = split.base;
      accent = split.accent;
    }
  }
  if (!/^[A-Za-z]+$/.test(s)) throw new Error(`"${src}" is not a symbol name`);
  return { base: s, ...(accent ? { accent } : {}), ...(sub !== undefined ? { sub } : {}) };
}

/** Index of the `_` that starts the subscript, outside any braces. */
function findSubscript(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "_" && depth === 0) return i;
  }
  return -1;
}

/** Edit distance, for "did you mean" suggestions. */
export function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}
