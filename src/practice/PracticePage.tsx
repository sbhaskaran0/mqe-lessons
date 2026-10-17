// A practice set played question by question (#/practice/<slug>): try the question, reveal the worked answer from
// the paired answers note, then grade yourself ("Got it" / "Not yet"). Grades live in progress under
// `slug#practice-<id>`; "Not yet" questions come back under the Review filter and on the progress dashboard.
import { Suspense, use, useEffect, useId, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "../app/ErrorBoundary";
import { Md, NoteLinkProvider, useNoteLinkClick, type NoteLinkHandler } from "../app/Md";
import { NotFound } from "../app/NotFound";
import { href, navigate, type PracticeShow } from "../app/router";
import { Icon, ProgressBar, scrollBehavior, useDocumentTitle } from "../app/ui";
import { useContent } from "../content/context";
import { courseOf, noteHref } from "../content/model";
import { loadNote } from "../content/store";
import type { NoteBody, NoteMeta, PracticeItem } from "../ir";
import { DeepDive } from "../lesson/DeepDive";
import { SymbolScope } from "../lesson/SymbolHover";
import { practiceKey, progress, useProgress, type PracticeGrade, type PracticeResult } from "../progress";
import { filterIds, gradeOf, groupItems, setSummary } from "./model";
import "./practice.css";

type Props = { slug: string; at?: string | undefined; show?: PracticeShow | undefined };

export function PracticePage({ slug, at, show }: Props) {
  const content = useContent();
  const meta = content.note(slug);
  useDocumentTitle(meta ? `Practice: ${meta.title}` : "Not found");
  if (!meta) return <NotFound what={`practice/${slug}`} />;
  return (
    <ErrorBoundary key={slug}>
      <Suspense
        fallback={
          <div className="page page-loading" aria-busy="true">
            <p className="loading">Loading {meta.title}…</p>
          </div>
        }
      >
        <PracticeLoader meta={meta} at={at} show={show} />
      </Suspense>
    </ErrorBoundary>
  );
}

function PracticeLoader({ meta, at, show }: { meta: NoteMeta; at?: string | undefined; show?: PracticeShow | undefined }) {
  const body = use(loadNote(meta.slug));
  if (!body.practice) return <NoQuestions meta={meta} />;
  return <PracticeView meta={meta} body={body} practice={body.practice} at={at} show={show} />;
}

/** A practice note the exporter found no numbered questions with paired answers in: it still reads as a note. */
function NoQuestions({ meta }: { meta: NoteMeta }) {
  const content = useContent();
  return (
    <div className="page page-narrow">
      <p className="page-kicker">Practice</p>
      <h1>{meta.title}</h1>
      <p className="lede">This set has no numbered questions paired with worked answers, so it cannot be played question by question.</p>
      <p className="button-row">
        <a className="btn btn-primary" href={noteHref(content, meta.slug)}>
          Read it as a note <Icon name="arrowRight" size={16} />
        </a>
      </p>
    </div>
  );
}

type Dive = { slug: string; anchor?: string | undefined };
const FILTERS: { value: PracticeShow | undefined; label: string }[] = [
  { value: undefined, label: "All" },
  { value: "review", label: "Not yet" }, // lists Partly too
  { value: "new", label: "Not tried" },
];

function PracticeView({ meta, body, practice, at, show }: { meta: NoteMeta; body: NoteBody; practice: NonNullable<NoteBody["practice"]>; at?: string | undefined; show?: PracticeShow | undefined }) {
  const content = useContent();
  const data = useProgress();
  const slug = meta.slug;
  const course = courseOf(content, meta);
  const answers = content.note(practice.answers);
  const summary = setSummary(data, slug, practice.items);

  // The filter's list is a snapshot taken when the filter changes: grading a question while reviewing does not
  // pull it out from under the reader.
  const listed = useMemo(() => filterIds(progress.get(), slug, practice.items, show), [slug, practice.items, show]);
  const groups = useMemo(() => groupItems(practice.items.filter((it) => listed.has(it.id))), [practice.items, listed]);
  const setShow = (value: PracticeShow | undefined) => navigate(href({ name: "practice", slug, ...(value ? { show: value } : {}) }), { replace: true });

  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return;
    const card = list.current?.querySelector<HTMLElement>(`[data-practice-id="${CSS.escape(at)}"]`);
    card?.scrollIntoView({ block: "start", behavior: "instant" });
    card?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }, [at]);

  const [dive, setDive] = useState<Dive[]>([]);
  const onNoteLink: NoteLinkHandler = (target, anchor) => {
    const m = content.note(target);
    if (!m || m.type === "lecture" || m.type === "course") return false;
    setDive([{ slug: target, anchor }]);
    return true;
  };

  const tried = summary.got + summary.partly + summary.notYet;
  const counts: Record<string, number> = { all: summary.total, review: summary.partly + summary.notYet, new: summary.untried };
  const pct = summary.total ? tried / summary.total : 0;

  return (
    <NoteLinkProvider value={onNoteLink}>
      <div className="page page-practice">
        <header className="practice-header">
          <p className="note-kicker">
            <span className="type-badge" data-type="practice">
              Practice
            </span>
            {course ? (
              <a href={href({ name: "course", id: course.id })} className="kicker-link">
                {course.code}
                {meta.lecture !== undefined ? ` · Lecture ${meta.lecture}` : ""}
              </a>
            ) : null}
          </p>
          <h1 className="note-title">{meta.title}</h1>
          <p className="practice-lede">
            Try each question on paper first, then reveal the worked answer and say how you did. Questions you mark <strong>Not yet</strong> or get only partly right come back
            under Review.
          </p>
          <p className="practice-links">
            {answers ? (
              <span>
                Answers from{" "}
                <a href={noteHref(content, answers.slug)} className="note-link">
                  {answers.title}
                </a>
              </span>
            ) : null}
            <a className="text-link" href={noteHref(content, slug)}>
              Read as a note <Icon name="arrowRight" size={14} />
            </a>
          </p>
        </header>

        <div className="practice-bar">
          <div className="practice-progress">
            <ProgressBar value={pct} label={`${tried} of ${summary.total} questions tried`} />
            <p className="practice-tally" aria-live="polite">
              <span>
                {tried} of {summary.total} tried
              </span>
              <span className="tally-got">
                <Icon name="check" size={14} /> {summary.got} got it
              </span>
              {summary.partly > 0 ? (
                <span className="tally-partly">
                  <Icon name="reset" size={14} /> {summary.partly} partly
                </span>
              ) : null}
              <span className="tally-notyet">
                <Icon name="reset" size={14} /> {summary.notYet} not yet
              </span>
            </p>
          </div>
          <div className="segmented practice-filter" role="radiogroup" aria-label="Show questions">
            {FILTERS.map((f) => (
              <button key={f.label} type="button" role="radio" aria-checked={show === f.value} onClick={() => setShow(f.value)}>
                {f.label} <span className="chip-count">{counts[f.value ?? "all"]}</span>
              </button>
            ))}
          </div>
        </div>

        <SymbolScope notation={body.notation}>
          <div className="practice-list" ref={list}>
            {groups.length === 0 ? (
              <p className="practice-empty" role="status">
                {show === "review" ? "Nothing to review: no question is marked Not yet or Partly." : "You have tried every question in this set."}{" "}
                <button type="button" className="btn btn-secondary btn-small" onClick={() => setShow(undefined)}>
                  Show all questions
                </button>
              </p>
            ) : null}
            {groups.map((g, gi) => (
              <PracticeGroupView key={g.title ?? `group-${gi}`} title={g.title} items={g.items} slug={slug} answersTitle={answers?.title} />
            ))}
          </div>
        </SymbolScope>
      </div>
      <DeepDive stack={dive} onChange={setDive} lessonTitle={meta.title} backLabel="Back to practice" />
    </NoteLinkProvider>
  );
}

function PracticeGroupView({ title, items, slug, answersTitle }: { title: string | undefined; items: PracticeItem[]; slug: string; answersTitle: string | undefined }) {
  const id = useId();
  const data = useProgress();
  const got = items.filter((it) => gradeOf(data, slug, it.id)?.grade === "got").length;
  return (
    <section className="practice-group" aria-labelledby={title ? `${id}-h` : undefined} aria-label={title ? undefined : "Questions"}>
      {title ? (
        <div className="practice-group-head">
          <Md md={title} inline as="h2" className="practice-group-title" />
          <span className="practice-group-count">
            {got} of {items.length} got
          </span>
          <span id={`${id}-h`} hidden>
            {title.replace(/\$/g, "")}
          </span>
        </div>
      ) : null}
      <ol className="practice-items">
        {items.map((it) => (
          <li key={it.id}>
            <PracticeCard item={it} slug={slug} answersTitle={answersTitle} result={gradeOf(data, slug, it.id)} />
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Rubric self-grading: tick the key steps you got, then Grade. The result lists the steps missed and takes focus. */
function Rubric({ steps, number, gradeKey, result }: { steps: string[]; number: string; gradeKey: string; result: PracticeResult | undefined }) {
  const id = useId();
  const [ticked, setTicked] = useState<number[]>(result?.ticked ?? []);
  const resultRef = useRef<HTMLDivElement>(null);
  const graded = useRef(false);
  useEffect(() => {
    if (!graded.current) return;
    graded.current = false;
    resultRef.current?.focus({ preventScroll: true });
  }, [result]);
  const toggle = (i: number) => setTicked((t) => (t.includes(i) ? t.filter((x) => x !== i) : [...t, i]));
  const done = result?.ticked ? new Set(result.ticked) : undefined;
  return (
    <div className="pq-rubric">
      <fieldset className="pq-rubric-set">
        <legend className="pq-grade-ask">Which steps did you get?</legend>
        <ul className="pq-rubric-list">
          {steps.map((step, i) => (
            <li key={i} className="pq-rubric-step" data-missed={done && !done.has(i) ? "true" : undefined}>
              <input type="checkbox" id={`${id}-${i}`} checked={ticked.includes(i)} onChange={() => toggle(i)} />
              <label htmlFor={`${id}-${i}`}>
                <Md md={step} inline />
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <button
        type="button"
        className="btn btn-secondary pq-rubric-btn"
        onClick={() => {
          graded.current = true;
          progress.gradePracticeRubric(gradeKey, ticked, steps.length);
        }}
      >
        {result ? "Re-grade" : "Grade"}
      </button>
      {result ? (
        <div className="pq-rubric-result" data-grade={result.grade} ref={resultRef} tabIndex={-1} role="status">
          <strong>{GRADE_LABEL[result.grade]}</strong>
          {done ? ` · ${done.size} of ${steps.length} steps` : ""}
          {done && done.size < steps.length ? ". Missed steps are highlighted." : ""}
        </div>
      ) : null}
    </div>
  );
}

const GRADE_LABEL: Record<PracticeGrade, string> = { got: "Got it", partly: "Partly", notyet: "Not yet" };

export function PracticeCard({ item, slug, answersTitle, result }: { item: PracticeItem; slug: string; answersTitle: string | undefined; result: PracticeResult | undefined }) {
  const content = useContent();
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const onLink = useNoteLinkClick();
  const answerRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const key = practiceKey(slug, item.id);

  // The button pressed is replaced by the other state's buttons, so focus follows: Show answer leads to the first
  // grade button, Hide answer back to Show answer. Only a press here moves it, not the first render.
  const moveFocus = useRef(false);
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    // Revealing scrolls the answer into view itself (below); the grade buttons must not pull the page elsewhere.
    actionsRef.current?.querySelector<HTMLElement>(revealed ? ".pq-grade-btn, .pq-rubric input" : ".pq-reveal")?.focus({ preventScroll: revealed });
  }, [revealed]);

  const reveal = () => {
    moveFocus.current = true;
    setRevealed(true);
    // Bring the answer's top into view on a phone, where it opens below the fold.
    requestAnimationFrame(() => answerRef.current?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() }));
  };
  const hide = () => {
    moveFocus.current = true;
    setRevealed(false);
  };
  const revise = item.links.map((s) => content.note(s)).filter((m): m is NoteMeta => m !== undefined);

  return (
    <article className="pq" data-practice-id={item.id} data-grade={result?.grade} aria-labelledby={`${id}-n`}>
      <header className="pq-head">
        <h3 className="pq-number" id={`${id}-n`}>
          Question {item.number}
        </h3>
        {result ? (
          <span className="pq-badge" data-grade={result.grade}>
            <Icon name={result.grade === "got" ? "check" : "reset"} size={14} />
            {GRADE_LABEL[result.grade]}
          </span>
        ) : null}
      </header>
      <Md md={item.prompt} className="pq-prompt" />

      {revealed ? (
        <div className="pq-answer" id={`${id}-a`} ref={answerRef} role="region" aria-label={`Worked answer to question ${item.number}`}>
          <p className="pq-answer-label">Worked answer</p>
          {item.answer ? (
            <Md md={item.answer} className="pq-answer-body" />
          ) : (
            <p className="muted">{answersTitle ? `${answersTitle} has no answer numbered ${item.number}.` : "This question has no worked answer."}</p>
          )}
        </div>
      ) : null}

      <div className="pq-actions" ref={actionsRef}>
        {!revealed ? (
          <button type="button" className="btn btn-primary pq-reveal" aria-expanded={false} aria-controls={`${id}-a`} onClick={reveal}>
            Show answer
          </button>
        ) : (
          <>
            {item.rubric ? (
              <Rubric steps={item.rubric} number={item.number} gradeKey={key} result={result} />
            ) : (
              <div className="pq-grade" role="group" aria-label={`How did question ${item.number} go?`}>
                <span className="pq-grade-ask">How did it go?</span>
                {(["got", "notyet"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    className="btn btn-secondary pq-grade-btn"
                    data-grade={g}
                    aria-pressed={result?.grade === g}
                    onClick={() => progress.gradePractice(key, g)}
                  >
                    <Icon name={g === "got" ? "check" : "reset"} size={16} />
                    {GRADE_LABEL[g]}
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="btn btn-ghost btn-small pq-hide" aria-expanded aria-controls={`${id}-a`} onClick={hide}>
              Hide answer
            </button>
          </>
        )}
      </div>

      {revise.length > 0 ? (
        <p className="pq-revise" onClick={onLink}>
          {revise.map((m) => (
            <a key={m.slug} className="chip pq-revise-chip" href={noteHref(content, m.slug)} data-note={m.slug}>
              <Icon name="book" size={14} />
              <span>
                Revise: <span className="pq-revise-title">{m.title}</span>
              </span>
            </a>
          ))}
        </p>
      ) : null}
    </article>
  );
}
