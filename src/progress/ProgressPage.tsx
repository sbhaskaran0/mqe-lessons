// The progress dashboard (#/progress): totals, the review queue (each item links to its exact step or question),
// each course's lectures, checkpoints and practice, and recent activity. Numbers come from the progress store and the
// index; note bodies load only to quote the prompts in the review queue.
import { Suspense, use, useEffect, useMemo, useState } from "react";
import { ErrorBoundary } from "../app/ErrorBoundary";
import { Md } from "../app/Md";
import { href } from "../app/router";
import { Icon, NoteCard, ProgressBar, useDocumentTitle } from "../app/ui";
import { useContent } from "../content/context";
import { courseLabel, noteHref, TYPE_LABEL, type Model } from "../content/model";
import { loadNote } from "../content/store";
import type { NoteBody } from "../ir";
import { sectionTitle } from "../lesson/steps";
import { buildDashboard, type Activity, type Calibration, type CourseSummary, type ReviewItem } from "./dashboard";
import { useProgress } from "./index";
import type { ProgressData } from "./store";
import "./progress.css";

/** Bodies of the lectures the learner has opened and that place a live interactive, which is all "new interactive"
 *  review items need. They load in the background, so the queue grows by those items once they arrive. */
function useLectureBodies(content: Model, data: ProgressData): ReadonlyMap<string, NoteBody> {
  const [loaded, setLoaded] = useState<ReadonlyMap<string, NoteBody>>(new Map());
  const wanted = useMemo(
    () =>
      Object.keys(data.notes)
        .filter((slug) => {
          const meta = content.note(slug);
          return meta?.type === "lecture" && meta.interactives.length > 0;
        })
        .sort()
        .join(","),
    [content, data.notes],
  );
  useEffect(() => {
    let live = true;
    for (const slug of wanted ? wanted.split(",") : []) {
      loadNote(slug).then(
        (body) => live && setLoaded((prev) => (prev.get(slug) === body ? prev : new Map(prev).set(slug, body))),
        () => {}, // a lecture that fails to load just has no new-interactive items
      );
    }
    return () => {
      live = false;
    };
  }, [wanted]);
  return loaded;
}

export function ProgressPage({ onSettings }: { onSettings: () => void }) {
  const content = useContent();
  const data = useProgress();
  useDocumentTitle("Progress");
  const bodies = useLectureBodies(content, data);
  const d = useMemo(() => buildDashboard(content, data, { bodies }), [content, data, bodies]);
  const pct = d.totals.answered ? Math.round((d.totals.correct / d.totals.answered) * 100) : 0;
  const nothing = d.totals.steps === 0 && d.totals.answered === 0 && d.totals.practiced === 0 && d.review.length === 0;

  return (
    <div className="page page-progress">
      <header>
        <p className="page-kicker">Progress</p>
        <h1>Your progress</h1>
        <p className="lede">
          What you have read, answered and practised, and what is worth another look. It lives in this browser only;{" "}
          <button type="button" className="link-button" onClick={onSettings}>
            export or import it in Settings
          </button>{" "}
          to move it to another device.
        </p>
      </header>

      <section aria-label="Totals" className="stat-row">
        <Stat value={d.totals.steps} label={d.totals.steps === 1 ? "step seen" : "steps seen"} />
        <Stat value={d.totals.answered} label={d.totals.answered === 1 ? "checkpoint answered" : "checkpoints answered"} note={d.totals.answered ? `${pct}% right first try` : undefined} />
        <Stat value={d.totals.practiced} label={d.totals.practiced === 1 ? "practice question graded" : "practice questions graded"} />
        <Stat value={d.review.length} label="to review" tone={d.review.length ? "warn" : undefined} />
        <Stat value={d.due} label="Due today" to={href({ name: "review" })} note={d.due ? "Start spaced review" : "Nothing due"} tone={d.due ? "warn" : undefined} />
        <Stat value={data.exams.filter((e) => e.finishedAt !== undefined).length} label="Mixed exams taken" to={href({ name: "exam" })} note={data.exams.some((e) => e.finishedAt === undefined) ? "Resume your exam" : "Start a mixed exam"} />
      </section>

      {nothing ? (
        <p className="progress-empty">
          Nothing recorded yet. Open a lecture from{" "}
          <a href={href({ name: "home" })}>the home page</a> and your steps, checkpoints and practice will show up here.
        </p>
      ) : null}

      <ReviewQueue items={d.review} />

      {d.calibration.ready ? <CalibrationTable calibration={d.calibration} /> : null}

      <section aria-labelledby="courses-progress-heading">
        <h2 id="courses-progress-heading" className="section-title">
          Courses
        </h2>
        <div className="course-progress-list">
          {d.courses.map((c) => (
            <CourseProgress key={c.course.id} summary={c} />
          ))}
        </div>
      </section>

      {d.other.notes.length > 0 ? (
        <section aria-labelledby="other-progress-heading">
          <h2 id="other-progress-heading" className="section-title">
            Other notes you have opened
          </h2>
          {d.other.checks.correct + d.other.checks.wrong + d.other.checks.skipped > 0 ? <CheckLine tally={d.other.checks} /> : null}
          <div className="card-grid">
            {d.other.notes.slice(0, 12).map((m) => (
              <NoteCard key={m.slug} meta={m} compact />
            ))}
          </div>
        </section>
      ) : null}

      {d.recent.length > 0 ? <Recent items={d.recent} /> : null}
    </div>
  );
}

function Stat({ value, label, note, tone, to }: { value: number; label: string; note?: string | undefined; tone?: "warn" | undefined; to?: string }) {
  const inner = (
    <>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {note ? <span className="stat-note">{note}</span> : null}
    </>
  );
  return to ? (
    <a className="stat stat-link" data-tone={tone} href={to}>
      {inner}
    </a>
  ) : (
    <div className="stat" data-tone={tone}>
      {inner}
    </div>
  );
}

// ---------- review queue ----------

function ReviewQueue({ items }: { items: ReviewItem[] }) {
  // One group per note, in the order its most recent miss happened.
  const groups = useMemo(() => {
    const by = new Map<string, ReviewItem[]>();
    for (const it of items) by.set(it.slug, [...(by.get(it.slug) ?? []), it]);
    return [...by.values()];
  }, [items]);
  return (
    <section aria-labelledby="review-heading" className="review">
      <h2 id="review-heading" className="section-title">
        Review queue {items.length ? <span className="muted">({items.length})</span> : null}
      </h2>
      {items.length === 0 ? (
        <p className="muted review-none">Nothing to review. Checkpoints and derivations you get wrong or skip, interactives added to a lecture you have read, and practice questions you mark Not yet collect here.</p>
      ) : (
        <div className="review-groups">
          {groups.map((g) => (
            <ErrorBoundary key={g[0]!.slug} fallback={() => <ReviewGroupView items={g} body={undefined} />}>
              <Suspense fallback={<ReviewGroupView items={g} body={undefined} />}>
                <ReviewGroupLoaded items={g} />
              </Suspense>
            </ErrorBoundary>
          ))}
        </div>
      )}
    </section>
  );
}

function ReviewGroupLoaded({ items }: { items: ReviewItem[] }) {
  const body = use(loadNote(items[0]!.slug));
  return <ReviewGroupView items={items} body={body} />;
}

/** Where a review item sits and what it asked, read from the note body once it has loaded. */
function describe(item: ReviewItem, body: NoteBody | undefined): { where: string | undefined; prompt: string | undefined } {
  if (!body) return { where: undefined, prompt: undefined };
  if (item.kind === "practice") {
    const q = body.practice?.items.find((i) => i.id === item.id);
    return { where: q ? `Question ${q.number}` : undefined, prompt: q?.prompt };
  }
  for (const section of body.sections) {
    const step = section.steps.find((s) => s.id === item.stepId);
    if (!step) continue;
    const block = step.blocks[item.block];
    const where = [sectionTitle(section), step.heading].filter(Boolean).join(" · ");
    if (block?.t === "check") return { where, prompt: block.prompt };
    if (block?.t === "interactive") return { where, prompt: block.prompt ?? block.purpose };
    if (block?.t === "derive") return { where, prompt: block.title };
    return { where, prompt: undefined };
  }
  return { where: undefined, prompt: undefined };
}

const KIND_LABEL = { check: "Checkpoint", goal: "Goal", derive: "Derivation", interactive: "New interactive", practice: "Practice" } as const;
const STATE_LABEL = { incorrect: "answered wrong", notyet: "not yet", skipped: "skipped", "gave-up": "gave up", new: "not tried yet" } as const;

function ReviewGroupView({ items, body }: { items: ReviewItem[]; body: NoteBody | undefined }) {
  const content = useContent();
  const meta = items[0]!.meta;
  return (
    <article className="review-group" aria-label={meta.title}>
      <header className="review-group-head">
        <span className="type-badge" data-type={meta.type}>
          {TYPE_LABEL[meta.type]}
        </span>
        <a className="review-group-title" href={noteHref(content, meta.slug)}>
          {meta.title}
        </a>
      </header>
      <ol className="review-items">
        {items.map((it) => {
          const { where, prompt } = describe(it, body);
          const state = it.kind === "practice" ? "notyet" : it.result;
          return (
            <li key={it.key}>
              <a className="review-item" href={it.href} data-state={state}>
                <span className="review-item-mark" aria-hidden="true">
                  <Icon name={state === "incorrect" ? "cross" : state === "notyet" ? "reset" : state === "new" ? "sliders" : "flag"} size={14} />
                </span>
                <span className="review-item-text">
                  <span className="review-item-kicker">
                    {KIND_LABEL[it.kind]} · {STATE_LABEL[state]}
                    {where ? (
                      <>
                        {" · "}
                        <Md md={where} inline />
                      </>
                    ) : null}
                  </span>
                  {prompt ? <Md md={prompt} className="review-item-prompt" /> : null}
                </span>
                <span className="review-item-go">
                  {it.kind === "practice" ? "Try again" : it.kind === "interactive" ? "Open it" : "Go to step"} <Icon name="arrowRight" size={14} />
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </article>
  );
}

// ---------- calibration ----------

/** Right-answer rate at each confidence level; the bars are plain CSS, no chart library. */
function CalibrationTable({ calibration }: { calibration: Calibration }) {
  return (
    <section aria-labelledby="calibration-heading" className="calibration">
      <h2 id="calibration-heading" className="section-title">
        How sure versus how right
      </h2>
      {calibration.reading ? <p className="calibration-reading">{calibration.reading}</p> : null}
      <table className="calibration-table">
        <thead>
          <tr>
            <th scope="col">You said</th>
            <th scope="col">Answers</th>
            <th scope="col">Right</th>
          </tr>
        </thead>
        <tbody>
          {calibration.rows.map((r) => (
            <tr key={r.level} data-level={r.level}>
              <th scope="row">{r.label}</th>
              <td>{r.answers}</td>
              <td>
                {r.pct === undefined ? (
                  <span className="muted">No answers yet</span>
                ) : (
                  <span className="calibration-right">
                    <ProgressBar value={r.pct / 100} label={`${r.label}: ${r.pct}% right`} className="calibration-bar" />
                    <span className="calibration-pct">{r.pct}%</span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted calibration-note">From the confidence you gave in spaced review and mixed exams. Being right more often at Sure than at Guessing means your sense of what you know is reliable.</p>
    </section>
  );
}

// ---------- courses ----------

function CheckLine({ tally, goals, predictions }: { tally: CourseSummary["checks"]; goals?: CourseSummary["goals"]; predictions?: CourseSummary["predictions"] }) {
  return (
    <dl className="tally-line">
      <div>
        <dt>Checkpoints</dt>
        <dd>
          <span className="tally" data-tone="good">
            <Icon name="check" size={14} /> {tally.correct} correct
          </span>
          <span className="tally" data-tone="bad">
            <Icon name="cross" size={14} /> {tally.wrong} wrong
          </span>
          <span className="tally">{tally.skipped} skipped</span>
          {tally.open > 0 ? <span className="tally muted">{tally.open} not reached</span> : null}
        </dd>
      </div>
      {goals && goals.met + goals.skipped > 0 ? (
        <div>
          <dt>Goals</dt>
          <dd>
            <span className="tally" data-tone="good">
              <Icon name="flag" size={14} /> {goals.met} reached
            </span>
            <span className="tally">{goals.skipped} skipped</span>
          </dd>
        </div>
      ) : null}
      {predictions && predictions.right + predictions.wrong > 0 ? (
        <div>
          <dt>Predictions</dt>
          <dd>
            <span className="tally">
              {predictions.right} of {predictions.right + predictions.wrong} right
            </span>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function CourseProgress({ summary }: { summary: CourseSummary }) {
  const content = useContent();
  const { course, lectures, practice } = summary;
  const pct = Math.round(summary.fraction * 100);
  return (
    <article className="course-progress" data-started={summary.started || undefined} aria-labelledby={`cp-${course.id}`}>
      <header className="course-progress-head">
        <a id={`cp-${course.id}`} className="course-progress-title" href={href({ name: "course", id: course.id })}>
          {courseLabel(course)}
        </a>
        <span className="course-progress-pct">{summary.started ? `${pct}% of lecture steps seen` : "Not started"}</span>
      </header>
      {lectures.length ? (
        <ol className="lecture-progress">
          {lectures.map((l) => (
            <li key={l.meta.slug}>
              <a href={noteHref(content, l.meta.slug)} className="lecture-progress-link">
                <span className="lecture-progress-num">L{l.meta.lecture ?? "?"}</span>
                <span className="lecture-progress-title">{l.meta.title}</span>
              </a>
              <ProgressBar value={l.fraction} label={`${l.meta.title}: ${Math.round(l.fraction * 100)}% seen`} />
              <span className="lecture-progress-steps">{l.total ? `${l.seen}/${l.total} steps` : "Not opened"}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">No lectures yet.</p>
      )}
      {summary.started || summary.checks.open > 0 ? <CheckLine tally={summary.checks} goals={summary.goals} predictions={summary.predictions} /> : null}
      {practice.sets.length ? (
        <div className="course-practice">
          <p className="course-practice-tally">
            <span className="tally-label">Practice</span>
            <span className="tally" data-tone="good">
              <Icon name="check" size={14} /> {practice.got} got it
            </span>
            <span className="tally" data-tone="warn">
              <Icon name="reset" size={14} /> {practice.notYet} not yet
            </span>
          </p>
          <ul className="course-practice-sets">
            {practice.sets.map((m) => (
              <li key={m.slug}>
                <a className="text-link" href={href({ name: "practice", slug: m.slug })}>
                  {m.title} <Icon name="arrowRight" size={14} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

// ---------- recent ----------

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function timeAgo(at: number, now = Date.now()): string {
  const diff = at - now;
  for (const [unit, ms] of UNITS) if (Math.abs(diff) >= ms) return RELATIVE.format(Math.round(diff / ms), unit);
  return "just now";
}

function Recent({ items }: { items: Activity[] }) {
  const content = useContent();
  return (
    <section aria-labelledby="recent-progress-heading">
      <h2 id="recent-progress-heading" className="section-title">
        Recent activity
      </h2>
      <ol className="recent-list">
        {items.map((a) => {
          const bits = [a.total ? `${a.seen} of ${a.total} steps` : undefined, a.checks ? `${a.checks} ${a.checks === 1 ? "checkpoint" : "checkpoints"}` : undefined, a.practice ? `${a.practice} practice graded` : undefined].filter(Boolean);
          const link = a.practice && !a.total ? href({ name: "practice", slug: a.meta.slug }) : noteHref(content, a.meta.slug);
          return (
            <li key={a.meta.slug} className="recent-item">
              <time className="recent-when" dateTime={new Date(a.at).toISOString()}>
                {timeAgo(a.at)}
              </time>
              <a className="recent-title" href={link}>
                {a.meta.title}
              </a>
              <span className="recent-what">
                {TYPE_LABEL[a.meta.type]}
                {bits.length ? ` · ${bits.join(" · ")}` : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
