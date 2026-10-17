// A small d3-format: readouts and slider values use the same specifier strings authors know from d3/Observable
// ([[fill]align][sign][symbol][0][width][,][.precision][~][type]). Negative numbers use the typographic minus,
// and a value that rounds to zero never shows a sign. A specifier this module can't read falls back to the
// automatic format instead of throwing: a typo in a vault spec must not blank a widget.

type Spec = {
  fill: string;
  align: "<" | ">" | "^" | "=";
  sign: "-" | "+" | " " | "(";
  symbol: "" | "$" | "#";
  zero: boolean;
  width: number | undefined;
  comma: boolean;
  precision: number | undefined;
  trim: boolean;
  type: string;
};

const RE = /^(?:(.)?([<>=^]))?([+\-( ])?([$#])?(0)?(\d+)?(,)?(?:\.(\d+))?(~)?([efgrsdp%n])?$/;
const MINUS = "−";
const SI = ["y", "z", "a", "f", "p", "n", "µ", "m", "", "k", "M", "G", "T", "P", "E", "Z", "Y"];

function parse(specifier: string): Spec | null {
  const m = RE.exec(specifier);
  if (!m) return null;
  const [, fill, align, sign, symbol, zero, width, comma, precision, trim, type] = m;
  let t = type ?? "";
  let c = comma === ",";
  if (t === "n") {
    c = true;
    t = "g";
  }
  const spec: Spec = {
    fill: fill ?? (zero ? "0" : " "),
    align: (align as Spec["align"] | undefined) ?? (zero ? "=" : ">"),
    sign: (sign as Spec["sign"] | undefined) ?? "-",
    symbol: (symbol as Spec["symbol"] | undefined) ?? "",
    zero: zero === "0",
    width: width === undefined ? undefined : Number(width),
    comma: c,
    precision: precision === undefined ? undefined : Number(precision),
    trim: trim === "~",
    type: t,
  };
  return spec;
}

/** Trailing zeros of the fraction (and a bare point) removed: "2.500" -> "2.5", "3.000e+2" -> "3e+2". */
function trimZeros(s: string): string {
  return s.replace(/(\.\d*?)0+(?=$|e)/, "$1").replace(/\.(?=$|e)/, "");
}

/** Decimal notation rounded to `p` significant digits, never exponential. */
function rounded(x: number, p: number): string {
  if (x === 0) return (0).toFixed(Math.max(0, p - 1));
  const r = Number(x.toPrecision(p));
  const exp = Math.floor(Math.log10(Math.abs(r)));
  return r.toFixed(Math.min(100, Math.max(0, p - 1 - exp)));
}

function body(x: number, spec: Spec): { digits: string; suffix: string } {
  const p = spec.precision;
  switch (spec.type) {
    case "f":
      return { digits: x.toFixed(Math.min(100, p ?? 6)), suffix: "" };
    case "%":
      return { digits: (x * 100).toFixed(Math.min(100, p ?? 6)), suffix: "%" };
    case "p":
      return { digits: rounded(x * 100, Math.max(1, Math.min(21, p ?? 6))), suffix: "%" };
    case "e":
      return { digits: x.toExponential(Math.min(100, p ?? 6)), suffix: "" };
    case "g":
      return { digits: x.toPrecision(Math.max(1, Math.min(21, p ?? 6))), suffix: "" };
    case "r":
      return { digits: rounded(x, Math.max(1, Math.min(21, p ?? 6))), suffix: "" };
    case "d":
      return { digits: Math.round(x).toFixed(0), suffix: "" };
    case "s": {
      const sig = Math.max(1, Math.min(21, p ?? 6));
      const first = x === 0 ? 0 : Math.floor(Math.log10(Math.abs(Number(x.toPrecision(sig)))) / 3);
      const k = Math.max(-8, Math.min(8, first));
      return { digits: rounded(x / 10 ** (k * 3), sig), suffix: SI[k + 8]! };
    }
    default: {
      // No type: like "g" with insignificant zeros trimmed (d3's default is precision 12).
      return { digits: trimZeros(x.toPrecision(Math.max(1, Math.min(21, p ?? 12)))), suffix: "" };
    }
  }
}

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function apply(spec: Spec, value: number): string {
  if (Number.isNaN(value)) return "—";
  const negative = value < 0 || Object.is(value, -0);
  const abs = Math.abs(value);
  let digits: string;
  let suffix: string;
  if (!Number.isFinite(abs)) {
    digits = "∞";
    suffix = "";
  } else {
    ({ digits, suffix } = body(abs, spec));
    if (spec.trim || spec.type === "") digits = trimZeros(digits);
  }
  // -0.001 at .2f is "0.00", not "−0.00".
  const zero = Number.isFinite(abs) && !/[1-9]/.test(digits.replace(/e[+-]?\d+$/, ""));
  const neg = negative && !zero;
  if (spec.comma) {
    const i = digits.search(/[.e]/);
    digits = i < 0 ? group(digits) : group(digits.slice(0, i)) + digits.slice(i);
  }
  const prefixSign = neg ? (spec.sign === "(" ? "(" : MINUS) : spec.sign === "+" ? "+" : spec.sign === " " ? " " : "";
  const suffixSign = neg && spec.sign === "(" ? ")" : "";
  const symbol = spec.symbol === "$" ? "$" : "";
  const core = digits + suffix + suffixSign;
  const lead = prefixSign + symbol;
  const width = spec.width ?? 0;
  const padLen = width - lead.length - core.length;
  if (padLen <= 0) return lead + core;
  const pad = spec.fill.repeat(padLen);
  switch (spec.align) {
    case "<":
      return lead + core + pad;
    case "^": {
      const half = Math.floor(padLen / 2);
      return pad.slice(0, half) + lead + core + pad.slice(half);
    }
    case "=":
      return lead + pad + core;
    default:
      return pad + lead + core;
  }
}

const cache = new Map<string, Spec | null>();

/** Format a number with a d3-style specifier; no specifier (or an unreadable one) gives the automatic format. */
export function format(specifier: string | undefined, value: number): string {
  if (specifier === undefined || specifier === "") return auto(value);
  let spec = cache.get(specifier);
  if (spec === undefined) {
    spec = parse(specifier);
    cache.set(specifier, spec);
  }
  return spec ? apply(spec, value) : auto(value);
}

/** Four significant digits in plain decimals, with thousands grouped; exponential only for extreme magnitudes. */
export function auto(value: number): string {
  const a = Math.abs(value);
  if (a !== 0 && Number.isFinite(a) && (a >= 1e9 || a < 1e-4)) return format(".3~e", value);
  return format(",.4~r", value);
}

/** Decimal places a slider step implies: 0.005 -> 3, 0.25 -> 2, 5 -> 0. */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 2;
  const s = step.toString();
  if (s.includes("e-")) return Number(s.split("e-")[1]);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}
