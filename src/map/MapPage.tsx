// #/map: the prerequisite map. Filters, search and the selected node live in the URL or the page; the graph
// itself is built and laid out once per filter (mapView) and drawn by MapCanvas, or by MapList on a phone.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Md } from "../app/Md";
import { href, navigate, type MapQuery } from "../app/router";
import { Icon, ProgressBar, Switch, useDocumentTitle, useMediaQuery } from "../app/ui";
import { useContent, type Content } from "../content/context";
import { courseLabel, noteHref } from "../content/model";
import { noteFraction, useProgress } from "../progress";
import { adjacency, colorKeys, type MapGraph } from "./graph";
import { mapView } from "./layout";
import { MapCanvas, type MapCanvasHandle } from "./MapCanvas";
import { MapList } from "./MapList";
import "./map.css";

/** Categorical colours, taken from the design tokens. Beyond the palette a group falls back to neutral. */
const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "var(--why)"];
const NEUTRAL = "var(--text-3)";
const PHONE = "(max-width: 720px)";

type ColorBy = "domain" | "course";
type Mode = "graph" | "list";

export default function MapPage({ query }: { query: MapQuery }) {
  const content = useContent();
  const { index } = content;
  const progress = useProgress();
  useDocumentTitle("Prerequisite map");

  const course = query.course && index.courses.some((c) => c.code === query.course) ? query.course : undefined;
  const domain = query.domain && index.domains.some((d) => d.id === query.domain) ? query.domain : undefined;
  const extra = query.extra === "1";
  const colorBy: ColorBy = query.color === "course" ? "course" : "domain";

  const update = (patch: Partial<MapQuery>) => {
    const next: MapQuery = { ...query, ...patch };
    for (const k of Object.keys(next) as (keyof MapQuery)[]) if (!next[k]) delete next[k];
    navigate({ name: "map", query: next }, { replace: true });
  };

  const view = useMemo(() => mapView(index, { course, domain, extra }), [index, course, domain, extra]);
  const { graph } = view;
  const adj = useMemo(() => adjacency(graph), [graph]);
  const selected = query.node && adj.preds.has(query.node) ? query.node : undefined;

  const keys = useMemo(() => colorKeys(graph, colorBy), [graph, colorBy]);
  const colors = useMemo(
    () => new Map(graph.nodes.map((n) => [n.slug, colorOfKeyIn(keys, colorBy === "domain" ? n.domain : n.courses[0])])),
    [graph, keys, colorBy],
  );

  // ---- search: highlights matches in this view and centres the best one ----
  const [text, setText] = useState("");
  const matchList = useMemo(() => {
    const inView = new Set(graph.nodes.map((n) => n.slug));
    return text.trim() ? content.search(text, 60).filter((m) => inView.has(m.slug)).map((m) => m.slug) : [];
  }, [content, graph, text]);
  const matches = useMemo(() => new Set(matchList), [matchList]);

  const [chosen, setMode] = useState<Mode | null>(null);
  const phone = useMediaQuery(PHONE);
  const mode: Mode = chosen ?? (phone ? "list" : "graph");

  const canvas = useRef<MapCanvasHandle>(null);
  const best = matchList[0];
  useEffect(() => {
    if (best && mode === "graph") canvas.current?.center(best, 0.9);
  }, [best, mode]);

  // A shared link with ?node= opens centred on it.
  const arrived = useRef(query.node);
  useEffect(() => {
    if (arrived.current && mode === "graph") canvas.current?.center(arrived.current, 0.9);
    arrived.current = undefined;
  }, [mode]);

  const select = (slug: string | undefined, centre = false) => {
    update({ node: slug });
    if (slug && centre) canvas.current?.center(slug);
  };
  const open = (slug: string) => navigate(noteHref(content, slug));

  const legend = keys.slice(0, PALETTE.length);
  const labelOfKey = (key: string) => (colorBy === "domain" ? (index.domains.find((d) => d.id === key)?.label ?? key) : key);
  const domains = index.domains.filter((d) => d.notes.some((s) => index.notes[s]?.type === "concept"));

  return (
    <div className="map-page" data-mode={mode}>
      <div className="map-toolbar">
        <h1 className="map-title">Prerequisite map</h1>
        <label className="select">
          <span>Course</span>
          <select value={course ?? ""} onChange={(e) => update({ course: e.target.value || undefined, node: undefined })}>
            <option value="">All courses</option>
            {index.courses.map((c) => (
              <option key={c.code} value={c.code}>
                {courseLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="select">
          <span>Domain</span>
          <select value={domain ?? ""} onChange={(e) => update({ domain: e.target.value || undefined, node: undefined })}>
            <option value="">All domains</option>
            {domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <div className="map-field">
          <span className="map-field-label" id="map-color-label">
            Colour by
          </span>
          <div className="map-segmented" role="radiogroup" aria-labelledby="map-color-label">
            {(["domain", "course"] as const).map((c) => (
              <button key={c} type="button" role="radio" aria-checked={colorBy === c} onClick={() => update({ color: c === "domain" ? undefined : c })}>
                {c === "domain" ? "Domain" : "Course"}
              </button>
            ))}
          </div>
        </div>
        <Switch checked={extra} onChange={(v) => update({ extra: v ? "1" : undefined, node: undefined })} label="Facts and papers" />
        <form
          className="map-find"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (best) {
              select(best, true);
            }
          }}
        >
          <Icon name="search" size={16} />
          <input
            type="search"
            value={text}
            placeholder="Find a concept"
            aria-label="Find a concept on the map"
            onChange={(e) => setText(e.target.value)}
          />
          {/* Mounted with the field, so the count is announced when it appears rather than lost with the element. */}
          <span className="map-find-hint" aria-live="polite">
            {text.trim() ? (matchList.length === 0 ? "Not in this view" : `${matchList.length} found`) : null}
          </span>
        </form>
        <div className="map-segmented map-views" role="radiogroup" aria-label="View">
          <button type="button" role="radio" aria-checked={mode === "graph"} onClick={() => setMode("graph")}>
            Map
          </button>
          <button type="button" role="radio" aria-checked={mode === "list"} onClick={() => setMode("list")}>
            Study order
          </button>
        </div>
      </div>

      <div className="map-legend" aria-label="Colour key">
        <span className="map-count">
          {graph.nodes.length} {graph.nodes.length === 1 ? "note" : "notes"} · {graph.edges.length} prerequisite links
        </span>
        {legend.map((k, i) => (
          <span key={k} className="map-legend-item" style={{ "--swatch": PALETTE[i] } as CSSProperties}>
            <i aria-hidden="true" />
            {labelOfKey(k)}
          </span>
        ))}
        {keys.length > PALETTE.length ? <span className="map-legend-item" style={{ "--swatch": NEUTRAL } as CSSProperties}><i aria-hidden="true" />Other</span> : null}
      </div>

      {graph.nodes.length === 0 ? (
        <p className="empty-results map-empty">
          Nothing to show for this combination. <a href={href({ name: "map", query: {} })}>Clear the filters</a>
        </p>
      ) : mode === "graph" ? (
        <div className="map-stage">
          <MapCanvas
            ref={canvas}
            view={view}
            selected={selected}
            matches={matches}
            colors={colors}
            progress={progress}
            cardOpen={!!selected}
            onSelect={(slug) => select(slug)}
            onOpen={open}
          />
          <div className="map-controls" role="group" aria-label="Zoom">
            <button type="button" className="map-ctl" onClick={() => canvas.current?.zoomBy(1.25)} aria-label="Zoom in" title="Zoom in">
              +
            </button>
            <button type="button" className="map-ctl" onClick={() => canvas.current?.zoomBy(0.8)} aria-label="Zoom out" title="Zoom out">
              −
            </button>
            <button type="button" className="map-ctl map-ctl-fit" onClick={() => canvas.current?.fit()} aria-label="Fit to screen" title="Fit the whole map on screen">
              Fit
            </button>
          </div>
          <p className="map-hint">Scroll to zoom, drag to pan. Arrow keys move between notes.</p>
          {selected ? <MapDetail key={selected} slug={selected} graph={graph} content={content} onSelect={(s) => select(s, true)} onClose={() => select(undefined)} /> : null}
        </div>
      ) : (
        <MapList graph={graph} adj={adj} colors={colors} progress={progress} matches={matches} first={best} />
      )}
    </div>
  );
}

function colorOfKeyIn(keys: string[], key: string | undefined): string {
  const i = key ? keys.indexOf(key) : -1;
  return i >= 0 && i < PALETTE.length ? PALETTE[i]! : NEUTRAL;
}

function MapDetail({ slug, graph, content, onSelect, onClose }: { slug: string; graph: MapGraph; content: Content; onSelect(slug: string): void; onClose(): void }) {
  const progress = useProgress();
  const meta = content.note(slug)!;
  const inGraph = useMemo(() => new Set(graph.nodes.map((n) => n.slug)), [graph]);
  const neededFor = useMemo(
    () =>
      Object.values(content.index.notes)
        .filter((m) => m.type === "concept" && m.requires.includes(slug))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [content, slug],
  );
  const buildsOn = meta.requires.map((s) => content.note(s)).filter((m) => m !== undefined);
  const fraction = noteFraction(progress, slug);
  const domainLabel = content.index.domains.find((d) => d.id === meta.domain)?.label;
  const lectures = meta.lessons.map((s) => content.note(s)).filter((m) => m !== undefined);

  // A related note on the map is selected in place; one the filters hide opens as a page.
  const item = (m: { slug: string; title: string }) => (
    <li key={m.slug}>
      {inGraph.has(m.slug) ? (
        <button type="button" className="map-link" onClick={() => onSelect(m.slug)}>
          {m.title}
        </button>
      ) : (
        <a className="map-link" href={noteHref(content, m.slug)}>
          {m.title}
          <Icon name="external" size={12} />
        </a>
      )}
    </li>
  );

  return (
    <aside className="map-card" aria-label={`${meta.title}, details`}>
      <button type="button" className="icon-btn map-card-close" onClick={onClose} aria-label="Close details" title="Close">
        <Icon name="close" size={18} />
      </button>
      <p className="map-card-kicker">
        {domainLabel ?? meta.type}
        {meta.courses.length > 0 ? ` · ${meta.courses.join(", ")}` : ""}
      </p>
      <h2 className="map-card-title">{meta.title}</h2>
      {fraction > 0 ? <ProgressBar value={fraction} label={`${meta.title}: ${Math.round(fraction * 100)}% seen`} /> : null}
      {meta.summary ? <Md md={meta.summary} inline as="p" className="map-card-summary" /> : null}
      <a className="btn btn-primary map-card-open" href={noteHref(content, slug)}>
        Open lesson
        <Icon name="arrowRight" size={16} />
      </a>
      <section>
        <h3>Builds on</h3>
        {buildsOn.length > 0 ? <ul className="map-links">{buildsOn.map(item)}</ul> : <p className="muted">Nothing: a starting point.</p>}
      </section>
      <section>
        <h3>Needed for</h3>
        {neededFor.length > 0 ? <ul className="map-links">{neededFor.map(item)}</ul> : <p className="muted">No other concept builds on this yet.</p>}
      </section>
      {lectures.length > 0 ? (
        <section>
          <h3>Taught in</h3>
          <ul className="map-links">
            {lectures.map((l) => (
              <li key={l.slug}>
                <a className="map-link" href={noteHref(content, l.slug)}>
                  {l.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
  );
}
