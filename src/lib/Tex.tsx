// KaTeX for a single TeX string (slider labels, readouts, chips). Prose with $…$ goes through the
// markdown renderer instead. Bad TeX renders in the error colour rather than throwing.
import katex from "katex";
import { useMemo } from "react";

export function texToHtml(tex: string, display = false): string {
  return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore", output: "htmlAndMathml" });
}

export function Tex({ tex, display = false, className }: { tex: string; display?: boolean; className?: string }) {
  const html = useMemo(() => texToHtml(tex, display), [tex, display]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
