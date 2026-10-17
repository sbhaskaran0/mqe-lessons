// Spec `color` values name design tokens, never raw colours: "1".."6" or "chart-3" pick a series colour,
// "accent", "success", "danger", "warn", "why", "highlight", "text-2" and so on pick the token of that name.
// Anything else falls back to the element's position in the series palette.

const TOKENS = new Set(["accent", "success", "danger", "warn", "why", "text", "text-2", "text-3", "highlight", "axis"]);

export function seriesColor(i: number): string {
  return `var(--chart-${(((i % 6) + 6) % 6) + 1})`;
}

export function resolveColor(color: string | undefined, fallbackIndex: number): string {
  if (color) {
    const c = color.trim().replace(/^--/, "");
    const n = /^(?:chart-)?([1-6])$/.exec(c);
    if (n) return `var(--chart-${n[1]})`;
    if (c === "highlight" || c === "axis") return `var(--chart-${c})`;
    if (TOKENS.has(c)) return `var(--${c})`;
  }
  return seriesColor(fallbackIndex);
}
