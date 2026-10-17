// Everything a page needs about the export, built once when index.json arrives: lookups, the markdown renderer
// (which needs the index to route note links) and search.
import { createContext, useContext, type ReactNode } from "react";
import type { Index } from "../ir";
import { createMarkdown, type Markdown } from "./markdown";
import { buildModel, noteHref, type Model } from "./model";
import { buildSearch, type Search } from "./search";
import { assetUrl, CONTENT_BASE } from "./store";

export type Content = Model & { md: Markdown; search: Search; contentBase: string };

export function createContent(index: Index): Content {
  const model = buildModel(index);
  const md = createMarkdown({
    noteHref: (slug, anchor) => (model.note(slug) ? noteHref(model, slug, anchor) : null),
    assetUrl,
  });
  return { ...model, md, search: buildSearch(index), contentBase: CONTENT_BASE };
}

const ContentContext = createContext<Content | null>(null);

export function ContentProvider({ value, children }: { value: Content; children: ReactNode }) {
  return <ContentContext value={value}>{children}</ContentContext>;
}

export function useContent(): Content {
  const c = useContext(ContentContext);
  if (!c) throw new Error("useContent outside ContentProvider");
  return c;
}
