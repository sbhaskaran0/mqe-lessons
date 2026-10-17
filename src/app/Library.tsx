// The library: every note, searchable and filterable by type, domain, tag, course, progress and content (has an
// interactive, has checkpoints). Filters are multi-select chips whose counts follow the other filters, and they
// live in the hash (#/library?type=concept&domain=labor) so a filtered view can be linked and survives a reload.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useContent } from "../content/context";
import { TYPE_PLURAL } from "../content/model";
import { NOTE_TYPES, type NoteMeta } from "../ir";
import { studyRanks } from "../map/graph";
import { useProgress } from "../progress";
import {
  facetCounts, filterNotes, HAS, HAS_LABEL, hasCustomTypes, isFiltered, noteStatus, parseFilters, SORT_LABEL, SORTS, sortNotes, STATUS_LABEL, STATUSES,
  toggle, toQuery, withSearch, type FacetKey, type Filters, type Sort,
} from "./libraryFacets";
import { navigate, type LibraryQuery } from "./router";
import { Icon, NoteCard, useDocumentTitle, useMediaQuery } from "./ui";
import "./library.css";

export function Library({ query }: { query: LibraryQuery }) {
  const content = useContent();
  const { index } = content;
  const data = useProgress();
  const filters = useMemo(() => parseFilters(query), [query]);
  const { q } = filters;
  useDocumentTitle(q ? `Search: ${q}` : "Library");

  const [draft, setDraft] = useState(q);
  // Back/forward and links change q; typing changes it too, so keep a draft's trailing space while it matches.
  useEffect(() => setDraft((d) => (d.trim() === q ? d : q)), [q]);

  const apply = (next: Filters) => navigate({ name: "library", query: toQuery(next) }, { replace: true });
  const clear = () => navigate({ name: "library", query: {} }, { replace: true });

  const all = useMemo(() => Object.values(index.notes), [index]);
  const ctx = useMemo(() => ({ status: (slug: string) => noteStatus(data, slug) }), [data]);
  // The pool is what the search finds (or everything); the facets then narrow it.
  const pool = useMemo(() => (q ? content.search(q, 200) : all), [q, content, all]);
  const ranks = useMemo(() => (filters.sort === "study" ? studyRanks(index) : new Map<string, number>()), [filters.sort, index]);
  const results = useMemo(() => {
    const kept = filterNotes(pool, filters, ctx);
    if (filters.sort) return sortNotes(kept, filters.sort, ranks);
    return q ? kept : sortNotes(kept, "title", ranks);
  }, [pool, filters, ctx, ranks, q]);

  const counts = (facet: FacetKey) => facetCounts(pool, filters, ctx, facet);
  const typeCounts = counts("type");
  const domainCounts = counts("domain");
  const tagCounts = counts("tag");
  const courseCounts = counts("course");
  const statusCounts = counts("status");
  const hasCounts = { interactive: counts("interactive").get("yes") ?? 0, checkpoints: counts("checkpoints").get("yes") ?? 0 };
  const anyType = filterNotes(pool, filters, ctx, "type").length;

  // Without a search or an explicit order the list reads best by domain; a search is ranked by relevance.
  const groups = useMemo(() => {
    if (q || (filters.sort && filters.sort !== "title")) return null;
    const byDomain = new Map<string, NoteMeta[]>();
    for (const m of results) byDomain.set(m.domain ?? "", [...(byDomain.get(m.domain ?? "") ?? []), m]);
    const label = (id: string) => index.domains.find((d) => d.id === id)?.label ?? "Other";
    return [...byDomain.entries()].sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || label(a[0]).localeCompare(label(b[0]))).map(([id, notes]) => ({ id, label: label(id), notes }));
  }, [q, filters.sort, results, index.domains]);

  const types = NOTE_TYPES.filter((t) => all.some((m) => m.type === t));
  const domains = index.domains.slice().sort((a, b) => a.label.localeCompare(b.label));
  const tags = Object.keys(index.tags).sort();

  const narrow = useMediaQuery("(max-width: 900px)");
  const [open, setOpen] = useState(false);
  const active = filters.domains.length + filters.tags.length + filters.courses.length + filters.has.length + filters.status.length + (hasCustomTypes(filters) ? 1 : 0);
  const filtered = isFiltered(filters);

  const sortChoices: { value: Sort | ""; label: string }[] = [
    q ? { value: "", label: "Relevance" } : { value: "", label: SORT_LABEL.title },
    ...SORTS.filter((s) => q || s !== "title").map((s) => ({ value: s, label: SORT_LABEL[s] })),
  ];

  return (
    <div className="page page-library">
      <header className="library-header">
        <h1>Library</h1>
        <form
          className="library-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            apply(withSearch(filters, draft));
          }}
        >
          <Icon name="search" size={18} />
          <input
            type="search"
            value={draft}
            placeholder="Search titles, aliases, summaries and tags"
            aria-label="Search the library"
            onChange={(e) => {
              setDraft(e.target.value);
              apply(withSearch(filters, e.target.value));
            }}
          />
        </form>
      </header>

      <div className="lib-layout">
        <section className="lib-filters" aria-label="Filters">
          {narrow ? (
            <button type="button" className="btn btn-secondary btn-small lib-filters-toggle" aria-expanded={open} aria-controls="lib-filter-groups" onClick={() => setOpen(!open)}>
              Filters{active > 0 ? ` (${active})` : ""}
            </button>
          ) : null}
          <div id="lib-filter-groups" className="lib-filter-groups" hidden={narrow && !open}>
            <Group label="Type">
              <Chip label="All" count={anyType} checked={filters.types.length === 0} onToggle={() => apply({ ...filters, types: [] })} />
              {types.map((t) => (
                <Chip
                  key={t}
                  label={TYPE_PLURAL[t]}
                  count={typeCounts.get(t) ?? 0}
                  checked={filters.types.includes(t)}
                  onToggle={() => apply({ ...filters, types: toggle(filters.types, t, NOTE_TYPES) })}
                />
              ))}
            </Group>
            <Group label="Domain">
              {domains
                .filter((d) => (domainCounts.get(d.id) ?? 0) > 0 || filters.domains.includes(d.id))
                .map((d) => (
                  <Chip key={d.id} label={d.label} count={domainCounts.get(d.id) ?? 0} checked={filters.domains.includes(d.id)} onToggle={() => apply({ ...filters, domains: toggle(filters.domains, d.id) })} />
                ))}
            </Group>
            <Group label="Course">
              {index.courses.map((c) => (
                <Chip key={c.code} label={c.code} count={courseCounts.get(c.code) ?? 0} checked={filters.courses.includes(c.code)} onToggle={() => apply({ ...filters, courses: toggle(filters.courses, c.code) })} />
              ))}
            </Group>
            <Group label="Tag">
              {tags
                .filter((t) => (tagCounts.get(t) ?? 0) > 0 || filters.tags.includes(t))
                .map((t) => (
                  <Chip key={t} label={t} count={tagCounts.get(t) ?? 0} checked={filters.tags.includes(t)} onToggle={() => apply({ ...filters, tags: toggle(filters.tags, t) })} />
                ))}
            </Group>
            <Group label="Your progress">
              {STATUSES.map((s) => (
                <Chip key={s} label={STATUS_LABEL[s]} count={statusCounts.get(s) ?? 0} checked={filters.status.includes(s)} onToggle={() => apply({ ...filters, status: toggle(filters.status, s, STATUSES) })} />
              ))}
            </Group>
            <Group label="Content">
              {HAS.map((h) => (
                <Chip key={h} label={HAS_LABEL[h]} count={hasCounts[h]} checked={filters.has.includes(h)} onToggle={() => apply({ ...filters, has: toggle(filters.has, h, HAS) })} />
              ))}
            </Group>
          </div>
        </section>

        <div className="lib-results">
          <div className="lib-bar">
            <p className="results-count" role="status">
              {results.length} {results.length === 1 ? "note" : "notes"}
              {q ? ` matching “${q}”` : ""}
            </p>
            <div className="lib-bar-actions">
              {filtered && results.length > 0 ? (
                <button type="button" className="btn btn-ghost btn-small" onClick={clear}>
                  Clear filters
                </button>
              ) : null}
              <label className="select select-inline">
                <span>Sort by</span>
                <select value={filters.sort ?? ""} onChange={(e) => apply({ ...filters, sort: SORTS.find((s) => s === e.target.value) })}>
                  {sortChoices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {results.length === 0 ? (
            <div className="empty-results lib-empty">
              <p>Nothing matches{q ? ` “${q}”` : ""} with these filters. Try fewer words, or take a filter off.</p>
              <button type="button" className="btn btn-secondary btn-small" onClick={clear}>
                Clear filters
              </button>
            </div>
          ) : groups ? (
            groups.map((g) => (
              <section key={g.id || "other"} className="library-group" aria-labelledby={`domain-${g.id || "other"}`}>
                <h2 id={`domain-${g.id || "other"}`} className="section-title">
                  {g.label} <span className="muted">{g.notes.length}</span>
                </h2>
                <div className="card-grid">
                  {g.notes.map((m) => (
                    <NoteCard key={m.slug} meta={m} />
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className="card-grid lib-flat">
              {results.map((m) => (
                <NoteCard key={m.slug} meta={m} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="lib-group">
      <legend>{label}</legend>
      <div className="lib-chips">{children}</div>
    </fieldset>
  );
}

/** A multi-select chip. A value that would leave nothing (and is not already chosen) cannot be picked. */
function Chip({ label, count, checked, onToggle }: { label: string; count: number; checked: boolean; onToggle(): void }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} className="chip" disabled={!checked && count === 0} onClick={onToggle}>
      {label}
      <span className="chip-count">{count}</span>
    </button>
  );
}
