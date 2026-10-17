// A friendly dead end: say what was missing and offer the closest notes by name.
import { useContent } from "../content/context";
import { href } from "./router";
import { NoteCard, useDocumentTitle } from "./ui";

export function NotFound({ what }: { what?: string }) {
  const content = useContent();
  useDocumentTitle("Not found");
  const guesses = what ? content.search(what.replace(/[-/]+/g, " "), 4) : [];
  return (
    <div className="page page-narrow not-found">
      <p className="page-kicker">Not found</p>
      <h1>There is no page here</h1>
      <p className="lede">
        {what ? (
          <>
            Nothing in the vault export matches <code>{what}</code>. The note may have been renamed, or the export may be out of date.
          </>
        ) : (
          "That address does not match any page in the player."
        )}
      </p>
      {guesses.length > 0 ? (
        <section>
          <h2 className="section-title">Were you looking for</h2>
          <div className="card-list">
            {guesses.map((m) => (
              <NoteCard key={m.slug} meta={m} />
            ))}
          </div>
        </section>
      ) : null}
      <p className="button-row">
        <a className="btn btn-primary" href={href({ name: "home" })}>
          Go home
        </a>
        <a className="btn btn-secondary" href={href({ name: "library", query: {} })}>
          Browse the library
        </a>
      </p>
    </div>
  );
}
