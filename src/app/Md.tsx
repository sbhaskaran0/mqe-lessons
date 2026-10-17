// Renders IR markdown. Note links are real hash hrefs, so they work with no JavaScript handler at all; inside a
// lesson a NoteLinkHandler can take them over (to open the deep-dive panel instead of leaving the lesson).
import { createContext, useContext, type MouseEvent } from "react";
import { useContent } from "../content/context";

/** Returns true when it handled the link (the default navigation is then cancelled). */
export type NoteLinkHandler = (slug: string, anchor: string | undefined) => boolean;

const NoteLinkContext = createContext<NoteLinkHandler | null>(null);
export const NoteLinkProvider = NoteLinkContext;

export function useNoteLinkHandler(): NoteLinkHandler | null {
  return useContext(NoteLinkContext);
}

/** Click handler for any element whose subtree holds note links (rendered markdown, link cards). */
export function useNoteLinkClick() {
  const handler = useContext(NoteLinkContext);
  return (e: MouseEvent<HTMLElement>) => {
    if (!handler || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest?.("a[data-note]");
    if (!a || !e.currentTarget.contains(a)) return;
    const slug = a.getAttribute("data-note")!;
    if (handler(slug, a.getAttribute("data-anchor") ?? undefined)) e.preventDefault();
  };
}

type MdProps = { md: string; inline?: boolean; className?: string; as?: "div" | "span" | "p" | "h2" | "h3" | "h4" | "figcaption" | "td" };

export function Md({ md, inline = false, className, as }: MdProps) {
  const { md: render } = useContent();
  const onClick = useNoteLinkClick();
  const Tag = as ?? (inline ? "span" : "div");
  const html = inline ? render.inline(md) : render.block(md);
  return <Tag className={className ? `md ${className}` : "md"} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
