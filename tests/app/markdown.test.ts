import { describe, expect, it } from "vitest";
import { createMarkdown } from "../../src/content/markdown";

const md = createMarkdown({
  noteHref: (slug, anchor) => (slug === "missing" ? null : `#/note/${slug}${anchor ? `?at=${anchor}` : ""}`),
  assetUrl: (src) => `http://x/${src}`,
});

/** The TeX sources KaTeX was given, read back from its MathML annotations. */
const texOf = (html: string) => [...html.matchAll(/<annotation encoding="application\/x-tex">([^<]*)<\/annotation>/g)].map((m) => m[1]);

describe("math", () => {
  it("renders inline math with KaTeX and keeps subscripts away from emphasis", () => {
    const html = md.inline("Capital $k_{t}$ and $s_{t}$ grow, *not* $a_{b}c_d$");
    expect(html).toContain('class="katex"');
    expect(texOf(html)).toEqual(["k_{t}", "s_{t}", "a_{b}c_d"]);
    expect(html).toContain("<em>not</em>");
    expect(html).not.toMatch(/<em>\{t\}/);
  });

  it("keeps emphasis markers inside math as TeX", () => {
    const html = md.inline("$x_1 * y_2 * z$ then *word*");
    expect(texOf(html)).toEqual(["x_1 * y_2 * z"]);
    expect(html).toContain("<em>word</em>");
  });

  it("renders display math", () => {
    const html = md.block("Before $$\\bar{k} = \\left(\\frac{sA}{\\delta}\\right)^{2}$$ after");
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('class="math-display"');
  });

  it("treats escaped dollars as currency, also inside math", () => {
    const html = md.inline("costs \\$20/hr, and $-\\$97.19$ is the intercept");
    expect(html).toContain("costs $20/hr");
    expect(texOf(html)).toEqual(["-\\$97.19"]);
  });

  it("accepts a closing dollar after a space, as the exporter does", () => {
    const html = md.inline("Marginal effect $= 2(0.0154)(2000) = $ **\\$61.60**");
    expect(texOf(html)).toEqual(["= 2(0.0154)(2000) ="]);
    expect(html).toContain("<strong>$61.60</strong>");
  });

  it("leaves a lone dollar as text", () => {
    expect(md.inline("a $ sign")).toBe("a $ sign");
  });

  it("never throws on bad TeX", () => {
    expect(md.inline("$\\frac{1}{$")).toContain("katex-error");
  });
});

describe("links and assets", () => {
  it("turns note: links into app routes with data attributes", () => {
    const html = md.inline("See [Solow Diagram](note:solow-diagram).");
    expect(html).toContain('href="#/note/solow-diagram"');
    expect(html).toContain('data-note="solow-diagram"');
    expect(html).toContain('class="note-link"');
  });

  it("carries a note link's anchor", () => {
    const html = md.inline("[the definition](note:steady-state#Definition)");
    expect(html).toContain('href="#/note/steady-state?at=Definition"');
    expect(html).toContain('data-anchor="Definition"');
  });

  it("marks links to unknown notes", () => {
    expect(md.inline("[Gone](note:missing)")).toContain("note-link-missing");
  });

  it("resolves <assets/...> images against the content base", () => {
    const html = md.inline("![Solow diagram](<assets/Attachments/Solow diagram.png>)");
    expect(html).toContain('src="http://x/assets/Attachments/Solow%20diagram.png"');
    expect(html).toContain('alt="Solow diagram"');
    expect(html).toContain('loading="lazy"');
  });

  it("opens web links in a new tab and refuses javascript:", () => {
    expect(md.inline("[site](https://example.org)")).toContain('rel="noopener noreferrer"');
    expect(md.inline("[x](javascript:alert(1))")).not.toContain("href=");
  });

  it("does not pass raw HTML through", () => {
    expect(md.block("<script>alert(1)</script>")).not.toContain("<script>");
  });
});

describe("blocks", () => {
  it("renders tables inside a scroll box, with math in cells", () => {
    const html = md.block("| $k$ | $\\Delta k$ |\n| --- | --- |\n| 9 | +0.6 |");
    expect(html).toMatch(/^<div class="table-scroll" tabindex="0"><table>/);
    expect(html).toContain("<th>");
    expect(texOf(html)).toEqual(["k", "\\Delta k"]);
  });

  it("renders lists and bold", () => {
    const html = md.block("1. **First** $x$\n2. Second");
    expect(html).toContain("<ol>");
    expect(html).toContain("<strong>First</strong>");
  });

  it("caches by input", () => {
    expect(md.block("same text")).toBe(md.block("same text"));
  });
});
