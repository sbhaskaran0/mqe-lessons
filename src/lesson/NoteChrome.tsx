// The frame around a note's steps: a header that varies by note type, and the footer of connected notes.
import { useEffect, useState } from "react";
import { Md, useNoteLinkClick } from "../app/Md";
import { href } from "../app/router";
import { Icon, NoteCard } from "../app/ui";
import { useContent } from "../content/context";
import { courseLabel, courseOf, footerGroups, noteHref, obsidianUrl, TYPE_LABEL } from "../content/model";
import { loadNote } from "../content/store";
import type { NoteMeta } from "../ir";
import { placements, type Placement } from "./steps";

const minutes = (words: number) => Math.max(1, Math.round(words / 200));

/** `practice` is the number of playable questions when the note is a practice set with paired answers. */
export function NoteHeader({ meta, steps, compact = false, practice }: { meta: NoteMeta; steps: number; compact?: boolean; practice?: number | undefined }) {
  const content = useContent();
  const course = courseOf(content, meta);
  const domain = meta.domain ? content.index.domains.find((d) => d.id === meta.domain) : undefined;
  const Title = compact ? "h2" : "h1";
  const answers = meta.pairedAnswers ? content.note(meta.pairedAnswers) : undefined;
  const facts: string[] = [`${steps} ${steps === 1 ? "step" : "steps"}`, `${minutes(meta.words)} min read`];
  if (meta.checks > 0) facts.push(`${meta.checks} ${meta.checks === 1 ? "checkpoint" : "checkpoints"}`);
  return (
    <header className={compact ? "note-header note-header-compact" : "note-header"} data-type={meta.type}>
      <p className="note-kicker">
        <span className="type-badge" data-type={meta.type}>
          {TYPE_LABEL[meta.type]}
        </span>
        {course && meta.type !== "course" ? (
          <a href={href({ name: "course", id: course.id })} className="kicker-link">
            {course.code}
            {meta.lecture !== undefined && (meta.type === "lecture" || meta.type === "practice") ? ` · Lecture ${meta.lecture}` : ""}
          </a>
        ) : null}
        {domain && meta.type !== "lecture" ? (
          <a href={href({ name: "library", query: { type: meta.type, domain: domain.id } })} className="kicker-link">
            {domain.label}
          </a>
        ) : null}
      </p>
      <Title className="note-title">{meta.title}</Title>
      {meta.type === "paper" ? (
        <p className="note-byline">
          {meta.authors?.length ? <span className="note-authors">{meta.authors.join(", ")}</span> : null}
          {meta.year ? <span>{meta.year}</span> : null}
          {meta.venue ? <span className="note-venue">{meta.venue}</span> : null}
        </p>
      ) : null}
      {meta.type === "fact" || meta.type === "source" ? (
        meta.source || meta.period ? (
          <dl className="note-facts">
            {meta.source ? (
              <div>
                <dt>Source</dt>
                <dd>
                  <Md md={meta.source} inline />
                </dd>
              </div>
            ) : null}
            {meta.period ? (
              <div>
                <dt>Period</dt>
                <dd>{meta.period}</dd>
              </div>
            ) : null}
          </dl>
        ) : null
      ) : null}
      {meta.summary && !compact ? <Md md={meta.summary} as="p" inline className="note-summary" /> : null}
      {meta.type === "interactive" && !compact ? <WidgetUsedIn meta={meta} /> : null}
      {practice ? (
        <p className="note-practice">
          <a className="btn btn-primary" href={href({ name: "practice", slug: meta.slug })}>
            Practise question by question ({practice}) <Icon name="arrowRight" size={16} />
          </a>
        </p>
      ) : null}
      {answers ? (
        <p className="note-answers">
          <a className="text-link" href={noteHref(content, answers.slug)} data-note={answers.slug}>
            Answers: {answers.title} <Icon name="arrowRight" size={14} />
          </a>
        </p>
      ) : null}
      {!compact ? (
        <p className="note-meta">
          {facts.join(" · ")}
          {meta.aliases.length ? <span className="note-aliases"> · Also called {meta.aliases.join(", ")}</span> : null}
        </p>
      ) : null}
      {course && meta.type === "course" ? (
        <p>
          <a className="btn btn-secondary" href={href({ name: "course", id: course.id })}>
            Open the {courseLabel(course)} path <Icon name="arrowRight" size={16} />
          </a>
        </p>
      ) : null}
    </header>
  );
}

function FooterGroup({ title, notes }: { title: string; notes: NoteMeta[] }) {
  if (notes.length === 0) return null;
  return (
    <section className="footer-group">
      <h2 className="footer-title">{title}</h2>
      <div className="card-list">
        {notes.map((m) => (
          <NoteCard key={m.slug} meta={m} compact />
        ))}
      </div>
    </section>
  );
}

export function NoteFooter({ meta }: { meta: NoteMeta }) {
  const content = useContent();
  const groups = footerGroups(content, meta);
  const onClick = useNoteLinkClick();
  return (
    <footer className="note-footer" onClick={onClick}>
      <FooterGroup title="Builds on" notes={groups.buildsOn} />
      {/* An interactive lists where it is used, step by step, in its header. */}
      <FooterGroup title="Used in" notes={meta.type === "interactive" ? [] : groups.usedIn} />
      <FooterGroup title="Related" notes={groups.related} />
      <FooterGroup title="Papers" notes={groups.papers} />
      <FooterGroup title="Interactives" notes={groups.interactives} />
      <p className="footer-source">
        <a className="btn btn-ghost" href={obsidianUrl(meta.path)}>
          <Icon name="external" size={16} /> Open in Obsidian
        </a>
        <span className="footer-path">{meta.path}</span>
      </p>
    </footer>
  );
}

/** An interactive's "Used in": the notes that place it (lectures first), each with links to its steps. */
function WidgetUsedIn({ meta }: { meta: NoteMeta }) {
  const content = useContent();
  const placedIn = [...new Set(meta.edges.in.filter((e) => e.kind === "shows").map((e) => e.note))]
    .map((s) => content.note(s))
    .filter((m): m is NoteMeta => m !== undefined)
    .sort((a, b) => Number(b.type === "lecture") - Number(a.type === "lecture") || a.title.localeCompare(b.title));
  const [steps, setSteps] = useState<Record<string, Placement[]>>({});
  const key = placedIn.map((m) => m.slug).join("|");

  useEffect(() => {
    let live = true;
    for (const slug of key ? key.split("|") : []) {
      loadNote(slug).then(
        (body) => live && setSteps((s) => ({ ...s, [slug]: placements(body, meta.slug) })),
        () => undefined, // the list still links to the note itself
      );
    }
    return () => {
      live = false;
    };
  }, [key, meta.slug]);

  if (placedIn.length === 0) return <p className="used-in used-in-none">Not placed in any lesson yet.</p>;
  return (
    <section className="used-in" aria-labelledby={`used-in-${meta.slug}`}>
      <h2 className="used-in-title" id={`used-in-${meta.slug}`}>
        Used in
      </h2>
      <ul className="used-in-list">
        {placedIn.map((m) => (
          <li key={m.slug} className="used-in-note">
            <a className="used-in-link" href={noteHref(content, m.slug)}>
              <span className="type-badge" data-type={m.type}>
                {TYPE_LABEL[m.type]}
              </span>
              <span className="used-in-name">{m.title}</span>
            </a>
            {steps[m.slug]?.length ? (
              <ol className="used-in-steps">
                {steps[m.slug]!.map((p) => (
                  <li key={p.step}>
                    <a href={noteHref(content, m.slug, p.step)}>
                      <Md md={p.label} inline />
                    </a>
                  </li>
                ))}
              </ol>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Where to go after the last step of a lecture: the next one on the course path, if any. */
export function nextLecture(content: ReturnType<typeof useContent>, meta: NoteMeta): NoteMeta | undefined {
  const course = courseOf(content, meta);
  if (!course || meta.type !== "lecture") return undefined;
  const i = course.lectures.indexOf(meta.slug);
  const next = i >= 0 ? course.lectures[i + 1] : undefined;
  return next ? content.note(next) : undefined;
}

