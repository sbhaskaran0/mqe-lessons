// A Notation row as a symbol chip and the in-math hover show it, and the "from <note>" link of a borrowed row.
import { Md } from "../app/Md";
import { useContent } from "../content/context";
import { noteHref } from "../content/model";
import type { NotationRow } from "../ir";

export function FromNote({ slug }: { slug: string }) {
  const content = useContent();
  const m = content.note(slug);
  if (!m) return null;
  return (
    <span className="symbol-from">
      from{" "}
      <a href={noteHref(content, slug)} data-note={slug} className="note-link">
        {m.title}
      </a>
    </span>
  );
}

/** Symbol, meaning, then kind · typical · from <note>. */
export function SymbolDetail({ row }: { row: NotationRow }) {
  return (
    <>
      <Md md={row.tex} inline className="symbol-detail-tex" />
      <Md md={row.meaning} inline as="p" className="symbol-detail-meaning" />
      <p className="symbol-detail-meta">
        <span>{row.kind}</span>
        {row.typical && row.typical !== "—" ? (
          <>
            {" · "}
            <span>
              Typical: <Md md={row.typical} inline />
            </span>
          </>
        ) : null}
        {row.from ? (
          <>
            {" · "}
            <FromNote slug={row.from} />
          </>
        ) : null}
      </p>
    </>
  );
}

