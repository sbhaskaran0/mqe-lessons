// #/review: the missed items that are due today, each shown unanswered with its real Check or Derive. An answer
// reschedules the item (see leitner.ts) and leaves the lesson's own record of that block alone. The list is fixed
// when the page opens, so an item stays on screen with its result after it has been rescheduled.
import { Suspense, use, useEffect, useRef, useState, type ReactNode } from "react";
import { ErrorBoundary } from "../app/ErrorBoundary";
import { Md } from "../app/Md";
import { href } from "../app/router";
import { Icon, useDocumentTitle } from "../app/ui";
import { useContent } from "../content/context";
import { TYPE_LABEL } from "../content/model";
import { loadNote } from "../content/store";
import type { Block } from "../ir";
import { Check } from "../lesson/Check";
import { Derive } from "../lesson/Derive";
import { sectionTitle } from "../lesson/steps";
import { dueItems, nextReviewDue, type DueItem } from "../progress/dashboard";
import { progress, reviewDeriveKey, useProgress, type ConfidenceLevel } from "../progress";
import { ConfidenceControl, CONFIDENCE_LABEL } from "./Confidence";
import { SESSION_CAP, startOfDay } from "./leitner";
import "./review.css";

const DAY = 86_400_000;

/** "today", "tomorrow", "in 3 days" or a date, for a due day (a local midnight) seen from `now`. */
function when(due: number, now: number): string {
  const days = Math.round((due - startOfDay(now)) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days} days`;
  return `on ${new Date(due).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`;
}

export function ReviewPage() {
  const content = useContent();
  useDocumentTitle("Review");
  // The session: what is due when the page opens, capped, kept as it was while the learner works through it.
  const [session] = useState(() => {
    const now = Date.now();
    const all = dueItems(content, progress.get(), now);
    return { now, items: all.slice(0, SESSION_CAP), total: all.length };
  });
  const [results, setResults] = useState<Record<string, boolean>>({});
  // A review of a derivation works on a scratch record. One left by an earlier visit (a reload mid-exercise) would
  // show that visit's state, so the list waits until these are cleared; they are cleared again on the way out.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const scratch = session.items.map((i) => reviewDeriveKey(i.key));
    scratch.forEach((k) => progress.discardDerive(k));
    setReady(true);
    return () => scratch.forEach((k) => progress.discardDerive(k));
  }, [session]);

  const answered = Object.keys(results).length;
  const right = Object.values(results).filter(Boolean).length;
  const finished = session.items.length > 0 && answered === session.items.length;

  return (
    <div className="page page-review">
      <header>
        <p className="page-kicker">Spaced review</p>
        <h1>Due today</h1>
        <p className="lede">
          Questions you missed or gave up on come back after 1, 3, 7 and 21 days. Answer each without looking back: a right answer pushes it further out, a wrong one starts it over. Your answers here do not change what the lesson recorded.
        </p>
      </header>

      {session.items.length === 0 ? (
        <Empty />
      ) : (
        <>
          <p className="review-status" role="status">
            {finished ? (
              <>
                <Icon name="check" size={18} /> Done for today: {right} of {answered} right.
              </>
            ) : (
              <>
                {answered} of {session.items.length} reviewed
                {session.total > session.items.length ? ` (${session.total - session.items.length} more are due and will be here next time)` : ""}
              </>
            )}
          </p>
          {ready ? (
            <ol className="review-cards">
              {session.items.map((item, index) => (
                <li key={item.key}>
                  <ErrorBoundary fallback={() => <CardFrame item={item} note="This question could not be loaded." />}>
                    <Suspense fallback={<CardFrame item={item} note="Loading the question…" />}>
                      <Card item={item} now={session.now} seed={session.now + index} result={results[item.key]} onResult={(ok) => setResults((r) => (item.key in r ? r : { ...r, [item.key]: ok }))} />
                    </Suspense>
                  </ErrorBoundary>
                </li>
              ))}
            </ol>
          ) : null}
          {finished ? <NextDue /> : null}
        </>
      )}
    </div>
  );
}

/** The soonest scheduled review after now, or undefined when nothing is waiting. */
function useNextDue(): { next: number | undefined; now: number } {
  const content = useContent();
  const data = useProgress();
  const now = useRef(Date.now()).current;
  return { next: nextReviewDue(content, data, now), now };
}

function NextDue() {
  const { next, now } = useNextDue();
  return next === undefined ? null : <p className="muted review-next">Next review: {when(next, now)}.</p>;
}

function Empty() {
  const { next, now } = useNextDue();
  return (
    <section className="review-empty" aria-labelledby="review-none-heading">
      <h2 id="review-none-heading" className="section-title">
        Nothing due
      </h2>
      {next === undefined ? (
        <p className="muted">Checkpoints you answer wrong and derivations you give up on are scheduled here, so you meet them again after a day, then three, seven and twenty-one.</p>
      ) : (
        <p>
          The next review is due <strong>{when(next, now)}</strong> ({new Date(next).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}).
        </p>
      )}
      <p>
        <a className="text-link" href={href({ name: "progress" })}>
          See your progress <Icon name="arrowRight" size={14} />
        </a>
      </p>
    </section>
  );
}

function CardFrame({ item, where, children, note, result, now, sure }: { item: DueItem; where?: string | undefined; children?: ReactNode; note?: string; result?: boolean | undefined; now?: number; sure?: ReactNode }) {
  const entry = useProgress().leitner[item.key];
  return (
    <article className="review-card" data-result={result === undefined ? undefined : result ? "right" : "wrong"} aria-label={item.meta.title}>
      <header className="review-card-head">
        <span className="type-badge" data-type={item.meta.type}>
          {TYPE_LABEL[item.meta.type]}
        </span>
        <span className="review-card-where">
          {item.meta.title}
          {where ? (
            <>
              {" · "}
              <Md md={where} inline />
            </>
          ) : null}
        </span>
        <a className="text-link review-card-open" href={item.href}>
          Open in the lecture <Icon name="arrowRight" size={14} />
        </a>
      </header>
      {note ? <p className="muted">{note}</p> : null}
      {sure}
      {children}
      {result !== undefined && now !== undefined ? (
        <p className="review-card-after" data-ok={result}>
          {entry ? `${result ? "Right." : "Not yet."} Back ${when(entry.due, now)}.` : "Right. This one is off the schedule."}
        </p>
      ) : null}
    </article>
  );
}

function Card({ item, now, seed, result, onResult }: { item: DueItem; now: number; seed: number; result: boolean | undefined; onResult: (ok: boolean) => void }) {
  const body = use(loadNote(item.slug));
  let where: string | undefined;
  let block: Block | undefined;
  for (const section of body.sections) {
    const step = section.steps.find((s) => s.id === item.stepId);
    if (!step) continue;
    where = [sectionTitle(section), step.heading].filter(Boolean).join(" · ");
    block = step.blocks[item.block];
    break;
  }
  // A ref, not `result`: the effect that reports a derivation can run twice before the page's state has changed.
  const settled = useRef(false);
  // How sure the learner said they were, kept in a ref too: a derivation reports from an effect, after the render
  // that closed over the level.
  const [level, setLevel] = useState<ConfidenceLevel>();
  const levelRef = useRef<ConfidenceLevel | undefined>(undefined);
  levelRef.current = level;
  const settle = (ok: boolean) => {
    if (settled.current) return;
    settled.current = true;
    progress.recordReview(item.key, ok);
    if (levelRef.current) progress.recordConfidence(item.key, levelRef.current, ok);
    onResult(ok);
  };
  const sure =
    result === undefined ? (
      <div className="review-sure">
        <ConfidenceControl value={level} onChange={setLevel} />
      </div>
    ) : level ? (
      <p className="review-sure muted">You said: {CONFIDENCE_LABEL[level]}.</p>
    ) : null;

  if (block?.t !== "check" && block?.t !== "derive") {
    return (
      <CardFrame item={item} where={where} note="This question is no longer in the lecture.">
        <button type="button" className="btn btn-secondary" onClick={() => progress.dropReview(item.key)}>
          Remove it from the schedule
        </button>
      </CardFrame>
    );
  }
  return (
    <CardFrame item={item} where={where} result={result} now={now} sure={sure}>
      {block.t === "check" ? <Check block={block} storeKey={item.key} seed={seed} onAnswer={(r) => settle(r === "correct")} /> : <DeriveReview block={block} itemKey={item.key} onSettle={settle} />}
    </CardFrame>
  );
}

/** A derivation review: the real exercise on a scratch record, scored by how it ends. */
function DeriveReview({ block, itemKey, onSettle }: { block: Extract<Block, { t: "derive" }>; itemKey: string; onSettle: (ok: boolean) => void }) {
  const key = reviewDeriveKey(itemKey);
  const outcome = useProgress().derives[key]?.result;
  useEffect(() => {
    if (outcome === "done") onSettle(true);
    else if (outcome === "gave-up" || outcome === "skipped") onSettle(false);
  }, [outcome, onSettle]);
  return <Derive block={block} storeKey={key} exercise />;
}
