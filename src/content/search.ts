// Full-text search over note metadata (title, vault name, aliases, summary, tags). Bodies are not indexed:
// they live in 160 separate files, and the summary is written to be the searchable gist.
import MiniSearch from "minisearch";
import type { Index, NoteMeta } from "../ir";

type Doc = { id: string; title: string; name: string; aliases: string; summary: string; tags: string };

export type Search = (query: string, limit?: number) => NoteMeta[];

// Strip diacritics and math delimiters so "Jorgensen" finds "Jørgensen" and "$k$" does not get in the way.
const normalize = (term: string) =>
  term
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ø/g, "o")
    .replace(/[$\\]/g, "")
    .toLowerCase();

export function buildSearch(index: Index): Search {
  const mini = new MiniSearch<Doc>({
    fields: ["title", "name", "aliases", "summary", "tags"],
    processTerm: (term) => normalize(term) || null,
    searchOptions: {
      boost: { title: 3, name: 3, aliases: 2.5, tags: 1.5, summary: 1 },
      prefix: true,
      fuzzy: (term) => (term.length > 4 ? 0.2 : false),
      combineWith: "AND",
    },
  });
  mini.addAll(
    Object.values(index.notes).map((m) => ({
      id: m.slug,
      title: m.title,
      name: m.name,
      aliases: m.aliases.join(" · "),
      summary: m.summary,
      tags: m.tags.join(" "),
    })),
  );
  return (query, limit = 50) => {
    const q = query.trim();
    if (!q) return [];
    let hits = mini.search(q);
    // A query with a typo in one word should still find something: fall back to OR.
    if (hits.length === 0) hits = mini.search(q, { combineWith: "OR" });
    return hits
      .slice(0, limit)
      .map((h) => index.notes[h.id as string])
      .filter((m): m is NoteMeta => m !== undefined);
  };
}
