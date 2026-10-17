// Dev page: every widget in the export, each with a picker for the ```interactive blocks that place it, a compact
// toggle, and a log of the goal / predict callbacks it fires. The app routes it (e.g. #/dev/widgets).
import { useEffect, useState } from "react";
import type { Index, NoteBody, WidgetEntry } from "../ir";
import type { InteractiveBlock } from "./host";
import { WidgetHost } from "./WidgetHost";

export type PlacedView = { note: string; label: string; block: InteractiveBlock };

/** The interactive blocks in a note body, labelled by note and step. */
export function collectViews(body: NoteBody, noteTitle: string): PlacedView[] {
  const out: PlacedView[] = [];
  for (const section of body.sections) {
    for (const step of section.steps) {
      for (const b of step.blocks) {
        if (b.t !== "interactive") continue;
        const what = [b.goal ? "goal" : "", b.predict ? "predict" : "", b.lock?.length ? `lock ${b.lock.join(",")}` : ""].filter(Boolean).join(", ");
        // An interactive note's own view sits in a step with no heading: the label is then just the note's title.
        const where = [noteTitle, step.heading || section.heading].filter(Boolean).join(" · ");
        out.push({ note: body.slug, label: `${where}${what ? ` (${what})` : ""}`, block: b });
      }
    }
  }
  return out;
}

type Props = {
  index: Pick<Index, "widgets" | "datasets" | "notes">;
  /** Content root URL, ending in "/" (where index.json lives). */
  contentBase?: string;
  /** Defaults to fetching `${contentBase}notes/<slug>.json`. */
  loadNote?: (slug: string) => Promise<NoteBody>;
};

export function Gallery({ index, contentBase = "", loadNote }: Props) {
  const [views, setViews] = useState<Record<string, PlacedView[]>>({});

  useEffect(() => {
    let live = true;
    const load = loadNote ?? ((slug: string) => fetch(`${contentBase}notes/${slug}.json`).then((r) => r.json() as Promise<NoteBody>));
    // Notes that place widgets, plus each widget's own note (its explore block).
    const notes = Object.values(index.notes).filter((n) => n.interactives.length > 0 || n.type === "interactive");
    void Promise.all(notes.map((n) => load(n.slug).then((b) => collectViews(b, n.title), () => [] as PlacedView[]))).then((all) => {
      if (!live) return;
      const by: Record<string, PlacedView[]> = {};
      for (const v of all.flat()) (by[v.block.widget] ??= []).push(v);
      setViews(by);
    });
    return () => {
      live = false;
    };
  }, [index, contentBase, loadNote]);

  const entries = Object.values(index.widgets);
  return (
    <div className="w-gallery">
      <h1>Widgets ({entries.length})</h1>
      {entries.map((w) => (
        <GalleryItem key={w.slug} entry={w} views={views[w.slug] ?? []} index={index} contentBase={contentBase} />
      ))}
    </div>
  );
}

function GalleryItem({ entry, views, index, contentBase }: { entry: WidgetEntry; views: PlacedView[]; index: Props["index"]; contentBase: string }) {
  const [pick, setPick] = useState(-1);
  const [compact, setCompact] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const view = pick >= 0 ? (views[pick]?.block ?? null) : null;
  const note = (s: string) => setLog((l) => [...l.slice(-5), s]);
  return (
    <article className="w-gallery-item" data-gallery={entry.slug}>
      <div className="w-gallery-bar">
        <strong>{entry.name}</strong>
        <code>{entry.type}</code>
        <label>
          View{" "}
          <select value={pick} onChange={(e) => setPick(Number(e.currentTarget.value))}>
            <option value={-1}>Explore (no view)</option>
            {views.map((v, i) => (
              <option key={i} value={i}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.currentTarget.checked)} /> compact
        </label>
      </div>
      <div style={{ maxWidth: compact ? 390 : undefined }}>
        <WidgetHost
          entry={entry}
          view={view}
          datasets={index.datasets}
          contentBase={contentBase}
          compact={compact}
          onGoalMet={() => note("goal met")}
          onPredict={(c) => note(`predict ${JSON.stringify(c)}`)}
        />
      </div>
      {log.length ? <p className="w-gallery-log">{log.join(" · ")}</p> : null}
    </article>
  );
}
