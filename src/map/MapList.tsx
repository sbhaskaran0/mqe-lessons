// The phone fallback (and a "Study order" view on any screen): the same graph as a vertical list, layer by
// layer, every note after the notes it builds on. Each row is a plain link, so nothing here needs pan or zoom.
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { ProgressBar } from "../app/ui";
import { useContent } from "../content/context";
import { noteHref } from "../content/model";
import { noteFraction, type ProgressData } from "../progress";
import { studyLayers, type Adjacency, type MapGraph } from "./graph";

type Props = {
  graph: MapGraph;
  adj: Adjacency;
  colors: ReadonlyMap<string, string>;
  progress: ProgressData;
  matches: ReadonlySet<string>;
  /** The best search match: scrolled into view. */
  first: string | undefined;
};

export function MapList({ graph, adj, colors, progress, matches, first }: Props) {
  const content = useContent();
  const layers = useMemo(() => studyLayers(graph), [graph]);
  const titles = useMemo(() => new Map(graph.nodes.map((n) => [n.slug, n.title])), [graph]);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!first) return;
    root.current?.querySelector(`[data-slug="${CSS.escape(first)}"]`)?.scrollIntoView({ block: "center" });
  }, [first]);

  return (
    <div className="map-list" ref={root}>
      {layers.map((l) => (
        <section key={l.layer} className="map-layer" aria-labelledby={`map-layer-${l.layer}`}>
          <h2 id={`map-layer-${l.layer}`} className="map-layer-title">
            Step {l.layer + 1}
            <span className="muted">{l.layer === 0 ? "Starting points" : "Builds on earlier steps"}</span>
          </h2>
          <ol className="map-layer-list">
            {l.nodes.map((n) => {
              const needs = (adj.preds.get(n.slug) ?? []).map((s) => titles.get(s) ?? s).sort();
              const fraction = noteFraction(progress, n.slug);
              return (
                <li key={n.slug}>
                  <a
                    className="map-list-item"
                    href={noteHref(content, n.slug)}
                    data-slug={n.slug}
                    data-match={matches.has(n.slug) || undefined}
                    style={{ "--node-color": colors.get(n.slug) ?? "var(--text-3)" } as CSSProperties}
                  >
                    <span className="map-list-title">{n.title}</span>
                    {needs.length > 0 ? (
                      <span className="map-list-needs">
                        Builds on {needs.slice(0, 3).join(", ")}
                        {needs.length > 3 ? ` and ${needs.length - 3} more` : ""}
                      </span>
                    ) : null}
                    {fraction > 0 ? <ProgressBar value={fraction} label={`${n.title}: ${Math.round(fraction * 100)}% seen`} /> : null}
                  </a>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
