// #/exam: a mixed exam over the checkpoints (multiple choice and numeric) of the lectures the learner picks.
// Three states, all read from the progress store so a reload lands where the learner was:
//   no unfinished session  -> setup (lectures, number of questions, optional timer, past exams)
//   an unfinished session  -> the questions one at a time; no verdict and no explanation until the end
//   #/exam?id=<finished>   -> results: score, every item with its answer and explanation, result by objective
// The answers are the exam's own: they never change a lesson's `checks`. Each question asks "How sure are you?"
// (optional); the ratings go to the confidence log when the exam ends, once the verdicts are known.
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Md } from "../app/Md";
import { href, navigate } from "../app/router";
import { Icon, ProgressBar, useDocumentTitle } from "../app/ui";
import { useContent } from "../content/context";
import { courseLabel, lecturesOf, noteHref } from "../content/model";
import { loadNote } from "../content/store";
import type { NoteBody, NoteMeta } from "../ir";
import { sectionTitle } from "../lesson/steps";
import { progress, useProgress, type ConfidenceLevel, type ExamItem, type ExamRecord } from "../progress";
import { ConfidenceControl, CONFIDENCE_LABEL } from "../review/Confidence";
import {
  breakdownByObjective,
  clock,
  drawExam,
  EXAM_DEFAULT_COUNT,
  EXAM_TIMER_CHOICES,
  examId,
  formatNumber,
  isAnswered,
  isCorrect,
  newExamSeed,
  parseNumber,
  poolOf,
  questionsOf,
  remainingMs,
  scoreOf,
  withinTolerance,
  type Question,
  type StoredAnswer,
} from "./logic";
import "./exam.css";

export function ExamPage({ id }: { id?: string | undefined }) {
  useDocumentTitle("Exam");
  const exams = useProgress().exams;
  const active = exams.find((e) => e.finishedAt === undefined);
  const shown = id ? exams.find((e) => e.id === id) : undefined;
  return (
    <div className="page page-exam">
      {shown?.finishedAt !== undefined ? <Results key={shown.id} exam={shown} /> : active ? <Run key={active.id} exam={active} /> : <Setup missing={id !== undefined} />}
    </div>
  );
}

// ---------- loading ----------

type Loaded = { status: "loading" } | { status: "error" } | { status: "ready"; questions: Question[]; where: (q: Question) => string | undefined };

/** The exam's questions, read from the lecture bodies (and instantiated when varied), with where each sits. */
function useQuestions(exam: ExamRecord): Loaded {
  const [state, setState] = useState<Loaded>({ status: "loading" });
  useEffect(() => {
    let live = true;
    const slugs = [...new Set(exam.items.map((i) => i.key.split("#")[0]!))];
    Promise.all(slugs.map((s) => loadNote(s)))
      .then(async (list) => {
        const bodies = new Map<string, NoteBody>(slugs.map((s, i) => [s, list[i]!]));
        const questions = await questionsOf(exam, bodies);
        const where = (q: Question) => {
          for (const section of bodies.get(q.slug)?.sections ?? []) {
            const step = section.steps.find((s) => s.id === q.stepId);
            if (step) return [sectionTitle(section), step.heading].filter(Boolean).join(" · ");
          }
          return undefined;
        };
        if (live) setState({ status: "ready", questions, where });
      })
      .catch(() => live && setState({ status: "error" }));
    return () => {
      live = false;
    };
    // The record changes with every answer saved; the questions do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam.id]);
  return state;
}

// ---------- setup ----------

function Setup({ missing }: { missing: boolean }) {
  const content = useContent();
  const data = useProgress();
  const groups = useMemo(() => {
    const used = new Set<string>();
    const out: { id: string; label: string; lectures: NoteMeta[] }[] = [];
    for (const course of content.index.courses) {
      const lectures = lecturesOf(content, course).filter((m) => m.checks > 0);
      lectures.forEach((m) => used.add(m.slug));
      if (lectures.length) out.push({ id: course.id, label: courseLabel(course), lectures });
    }
    const rest = Object.values(content.index.notes).filter((m) => m.type === "lecture" && m.checks > 0 && !used.has(m.slug));
    if (rest.length) out.push({ id: "other", label: "Other lectures", lectures: rest });
    return out;
  }, [content]);
  // Every lecture the learner has started, to begin with.
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(groups.flatMap((g) => g.lectures).filter((m) => progress.get().notes[m.slug] !== undefined).map((m) => m.slug)));
  const [count, setCount] = useState(String(EXAM_DEFAULT_COUNT));
  const [timer, setTimer] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const countId = useId();
  const timerId = useId();
  const available = groups.flatMap((g) => g.lectures).filter((m) => chosen.has(m.slug)).reduce((n, m) => n + m.checks, 0);
  const wanted = Math.floor(Number(count));
  const countOk = Number.isFinite(wanted) && wanted >= 1;

  const toggle = (slug: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(slug);
      else next.delete(slug);
      return next;
    });
  const setAll = (slugs: string[], on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      for (const s of slugs) {
        if (on) next.add(s);
        else next.delete(s);
      }
      return next;
    });

  const start = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !chosen.size || !countOk) return;
    setBusy(true);
    setError(undefined);
    try {
      const slugs = groups.flatMap((g) => g.lectures).filter((m) => chosen.has(m.slug)).map((m) => m.slug);
      const bodies = await Promise.all(slugs.map((s) => loadNote(s)));
      const pool = slugs.flatMap((s, i) => poolOf(s, bodies[i]!));
      if (!pool.length) {
        setError("These lectures have no checkpoints to ask.");
        return;
      }
      const seed = newExamSeed();
      const items: ExamItem[] = drawExam(pool, wanted, seed).map((p) => ({ key: p.key, kind: "check" }));
      progress.saveExam({ id: examId(seed), startedAt: Date.now(), ...(timer ? { timerMin: timer } : {}), items });
    } catch {
      setError("Could not load the lectures. Is the lesson server still running?");
    } finally {
      setBusy(false);
    }
  };

  const past = data.exams.filter((e) => e.finishedAt !== undefined).sort((a, b) => b.finishedAt! - a.finishedAt!).slice(0, 5);

  return (
    <>
      <header>
        <p className="page-kicker">Mixed exam</p>
        <h1>Test yourself</h1>
        <p className="lede">
          Checkpoints from the lectures you choose, mixed so that neighbouring questions come from different lectures. Nothing is marked until you finish, and your answers here do not change what the lessons recorded.
        </p>
      </header>
      {missing ? <p className="exam-note">That exam is not in this browser&rsquo;s progress.</p> : null}
      <form className="exam-setup" onSubmit={start}>
        <section aria-labelledby="exam-lectures-heading">
          <h2 id="exam-lectures-heading" className="section-title">
            Lectures
          </h2>
          {groups.length === 0 ? <p className="muted">No lecture has checkpoints yet.</p> : null}
          {groups.map((g) => (
            <fieldset key={g.id} className="exam-group">
              <legend>{g.label}</legend>
              <button type="button" className="btn btn-ghost btn-small exam-all" onClick={() => setAll(g.lectures.map((m) => m.slug), !g.lectures.every((m) => chosen.has(m.slug)))}>
                {g.lectures.every((m) => chosen.has(m.slug)) ? "Clear" : "Select all"}
              </button>
              {g.lectures.map((m) => (
                <label key={m.slug} className="exam-lecture">
                  <input type="checkbox" checked={chosen.has(m.slug)} onChange={(e) => toggle(m.slug, e.target.checked)} />
                  <span className="exam-lecture-title">
                    {m.lecture !== undefined ? `L${m.lecture} · ` : ""}
                    {m.title}
                  </span>
                  <span className="exam-lecture-count">
                    {m.checks} {m.checks === 1 ? "question" : "questions"}
                    {data.notes[m.slug] ? "" : " · not started"}
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
        </section>

        <section aria-labelledby="exam-options-heading" className="exam-options">
          <h2 id="exam-options-heading" className="section-title">
            Length
          </h2>
          <div className="exam-field">
            <label htmlFor={countId}>Number of questions</label>
            <input id={countId} className="numeric-input" type="number" min={1} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
            <span className="muted">{available ? `${available} available in the lectures chosen` : "Choose a lecture first"}</span>
          </div>
          <div className="exam-field">
            <label htmlFor={timerId}>Timer</label>
            <select id={timerId} className="exam-select" value={timer} onChange={(e) => setTimer(Number(e.target.value))}>
              <option value={0}>Off</option>
              {EXAM_TIMER_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
            <span className="muted">{timer ? "The exam is submitted when time runs out." : "No time limit."}</span>
          </div>
        </section>

        {error ? (
          <p className="check-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="check-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !chosen.size || !countOk}>
            {busy ? "Starting…" : "Start exam"}
          </button>
          {!chosen.size ? <span className="muted">Choose at least one lecture.</span> : null}
        </div>
      </form>

      {past.length ? (
        <section aria-labelledby="exam-past-heading">
          <h2 id="exam-past-heading" className="section-title">
            Past exams
          </h2>
          <ul className="exam-past">
            {past.map((e) => {
              const s = scoreOf(e);
              return (
                <li key={e.id}>
                  <a className="text-link" href={href({ name: "exam", id: e.id })}>
                    {new Date(e.finishedAt!).toLocaleDateString(undefined, { month: "short", day: "numeric" })}: {s.right} of {s.total} right ({s.pct}%) <Icon name="arrowRight" size={14} />
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}

// ---------- the exam in progress ----------

type Draft = { picks: number[]; text: string; level: ConfidenceLevel | undefined };
const emptyDraft = (): Draft => ({ picks: [], text: "", level: undefined });

/** What the draft would be stored as, or undefined while there is nothing (valid) to store. */
function draftAnswer(q: Question, d: Draft): StoredAnswer {
  if (q.kind === "mcq") return d.picks.length ? [...d.picks].sort((a, b) => a - b) : undefined;
  return parseNumber(d.text);
}

function Run({ exam }: { exam: ExamRecord }) {
  const loaded = useQuestions(exam);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [now, setNow] = useState(() => Date.now());
  const heading = useRef<HTMLHeadingElement>(null);

  const byKey = loaded.status === "ready" ? new Map(loaded.questions.map((q) => [q.key, q])) : undefined;
  const asked = exam.items.filter((i) => byKey?.has(i.key));
  const currentItem = asked.find((i) => i.answer === undefined);
  const q = currentItem && byKey?.get(currentItem.key);
  const position = currentItem ? asked.indexOf(currentItem) : asked.length;

  /** Ends the exam: grades every item, saves, files the confidence ratings and shows the results. `items` already
   *  holds whatever answer the learner was giving. */
  const done = useRef(false);
  const finish = (items: ExamItem[]) => {
    if (done.current || !byKey) return;
    done.current = true;
    const graded = items.map((i): ExamItem => {
      const question = byKey.get(i.key);
      return question ? { ...i, correct: isCorrect(question, i.answer) } : i;
    });
    progress.saveExam({ ...exam, items: graded, finishedAt: Date.now() });
    for (const i of graded) if (i.confidence && isAnswered(i.answer)) progress.recordConfidence(i.key, i.confidence, i.correct === true);
    // A missed exam question comes back on #/review like a missed lesson check.
    for (const i of graded) if (isAnswered(i.answer) && i.correct === false) progress.scheduleMiss(i.key);
    navigate({ name: "exam", id: exam.id }, { replace: true });
  };
  const withAnswer = (answer: StoredAnswer): ExamItem[] =>
    exam.items.map((i) => (i.key === currentItem?.key ? { ...i, ...(answer !== undefined ? { answer } : {}), ...(draft.level && isAnswered(answer) ? { confidence: draft.level } : {}) } : i));
  const finishNow = () => (q ? finish(withAnswer(draftAnswer(q, draft))) : finish(exam.items));
  // The timer fires from an interval set up once; it must reach the draft as it is by then.
  const finishRef = useRef(finishNow);
  finishRef.current = finishNow;

  const advance = (answer: StoredAnswer) => {
    const items = withAnswer(answer);
    setDraft(emptyDraft());
    if (items.some((i) => byKey?.has(i.key) && i.answer === undefined)) progress.saveExam({ ...exam, items });
    else finish(items);
  };

  useEffect(() => {
    if (!exam.timerMin) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [exam.timerMin]);
  const left = remainingMs(exam, now);
  useEffect(() => {
    if (loaded.status === "ready" && left <= 0) finishRef.current();
  }, [loaded.status, left]);
  // Every question answered but the exam not ended (a save that stopped halfway): end it.
  useEffect(() => {
    if (loaded.status === "ready" && !currentItem) finishRef.current();
  }, [loaded.status, currentItem]);
  useEffect(() => {
    if (q) heading.current?.focus({ preventScroll: true });
  }, [q?.key]);

  if (loaded.status === "error") {
    return (
      <>
        <h1>Exam</h1>
        <p className="check-error" role="alert">
          The questions could not be loaded.
        </p>
        <p>
          <button type="button" className="btn btn-secondary" onClick={() => progress.saveExam({ ...exam, finishedAt: Date.now() })}>
            End this exam
          </button>
        </p>
      </>
    );
  }
  if (loaded.status === "loading" || !q) return <p className="loading">Loading the exam…</p>;

  const answer = draftAnswer(q, draft);
  const last = position === asked.length - 1;
  const numericBad = q.kind === "numeric" && draft.text.trim() !== "" && answer === undefined;
  return (
    <>
      <header className="exam-head">
        <div>
          <p className="page-kicker">Mixed exam</p>
          <h1 ref={heading} tabIndex={-1}>
            Question {position + 1} of {asked.length}
          </h1>
        </div>
        {exam.timerMin ? (
          <p className="exam-timer" role="timer" aria-label="Time left" data-low={left < 60_000 || undefined}>
            <Icon name="flag" size={16} /> {clock(left)}
          </p>
        ) : null}
      </header>
      <ProgressBar value={position / asked.length} label={`${position} of ${asked.length} answered`} className="exam-progress" />
      <section className="check exam-card" aria-label="Question" data-kind={q.kind}>
        <Md md={q.prompt} className="check-prompt" />
        <form
          className="check-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (answer !== undefined) advance(answer);
          }}
        >
          {q.kind === "mcq" ? (
            <McqInput q={q} picks={draft.picks} onChange={(picks) => setDraft((d) => ({ ...d, picks }))} />
          ) : (
            <NumericInput text={draft.text} bad={numericBad} onChange={(text) => setDraft((d) => ({ ...d, text }))} />
          )}
          <ConfidenceControl value={draft.level} onChange={(level) => setDraft((d) => ({ ...d, level }))} />
          <div className="check-actions">
            <button type="submit" className="btn btn-primary" disabled={answer === undefined}>
              {last ? "Finish exam" : "Next question"}
            </button>
            {!last ? (
              <button type="button" className="btn btn-secondary" onClick={() => advance("")}>
                Skip
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => advance("")}>
                Skip and finish
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={finishNow}>
              Finish early
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

function McqInput({ q, picks, onChange }: { q: Extract<Question, { kind: "mcq" }>; picks: number[]; onChange: (picks: number[]) => void }) {
  const name = useId();
  const multi = q.options.filter((o) => o.correct).length > 1;
  const toggle = (i: number) => onChange(multi ? (picks.includes(i) ? picks.filter((x) => x !== i) : [...picks, i]) : [i]);
  return (
    <fieldset className="mcq">
      <legend className="visually-hidden">{multi ? "Choose every correct answer" : "Choose one answer"}</legend>
      {multi ? <p className="check-hint">Select all that apply.</p> : null}
      {q.options.map((o, i) => (
        <label key={i} className="mcq-option" data-picked={picks.includes(i) || undefined}>
          <input type={multi ? "checkbox" : "radio"} name={name} checked={picks.includes(i)} onChange={() => toggle(i)} />
          <Md md={o.md} inline className="mcq-text" />
        </label>
      ))}
    </fieldset>
  );
}

function NumericInput({ text, bad, onChange }: { text: string; bad: boolean; onChange: (text: string) => void }) {
  const id = useId();
  return (
    <div className="numeric-row">
      <label htmlFor={id} className="numeric-label">
        Your answer
      </label>
      <input id={id} className="numeric-input" inputMode="decimal" autoComplete="off" spellCheck={false} value={text} aria-invalid={bad || undefined} onChange={(e) => onChange(e.target.value)} />
      {bad ? <span className="check-error">Enter a number, for example 0.25 or 1/4.</span> : null}
    </div>
  );
}

// ---------- results ----------

function Results({ exam }: { exam: ExamRecord }) {
  const content = useContent();
  const loaded = useQuestions(exam);
  const score = scoreOf(exam);
  const took = exam.finishedAt! - exam.startedAt;
  const timedOut = exam.timerMin !== undefined && took >= exam.timerMin * 60_000;
  const itemOf = new Map(exam.items.map((i) => [i.key, i]));
  const rows = useMemo(
    () => (loaded.status === "ready" ? breakdownByObjective(loaded.questions, (k) => itemOf.get(k)?.correct === true, (s) => content.note(s)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, content, exam],
  );
  const rated = exam.items.filter((i) => i.confidence && isAnswered(i.answer));

  return (
    <>
      <header>
        <p className="page-kicker">Mixed exam</p>
        <h1>Exam results</h1>
      </header>
      <section className="exam-score" aria-label="Score">
        <p className="exam-score-value" role="status">
          {score.right} of {score.total} right <span className="exam-score-pct">({score.pct}%)</span>
        </p>
        <p className="muted">
          {new Date(exam.finishedAt!).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          {exam.timerMin ? ` · ${timedOut ? "time ran out" : `${clock(took)} of ${exam.timerMin}:00`}` : ""}
          {rated.length ? ` · you were sure on ${rated.filter((i) => i.confidence === 3).length} of ${rated.length} rated answers` : ""}
        </p>
        <p>
          <a className="btn btn-primary" href={href({ name: "exam" })}>
            New exam
          </a>
        </p>
      </section>

      {loaded.status === "loading" ? <p className="loading">Loading the questions…</p> : null}
      {loaded.status === "error" ? <p className="check-error">The questions could not be loaded, so the answers cannot be shown.</p> : null}
      {loaded.status === "ready" ? (
        <>
          <section aria-labelledby="exam-objectives-heading">
            <h2 id="exam-objectives-heading" className="section-title">
              By objective
            </h2>
            <ul className="exam-objectives">
              {rows.map((r) => (
                <li key={`${r.slug}#${r.n}`} className="exam-objective" data-untagged={r.n === null || undefined}>
                  <span className="exam-objective-text">
                    <span className="exam-objective-lecture">{r.lecture}</span>
                    {r.n === null ? <span>Untagged</span> : <Md md={r.md} inline />}
                  </span>
                  <span className="exam-objective-score">
                    {r.right} of {r.asked}
                  </span>
                  <ProgressBar value={r.asked ? r.right / r.asked : 0} label={`${r.lecture}, ${r.n === null ? "untagged" : `objective ${r.n}`}: ${r.right} of ${r.asked} right`} className="exam-objective-bar" />
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="exam-items-heading">
            <h2 id="exam-items-heading" className="section-title">
              Every question
            </h2>
            <ol className="exam-items">
              {loaded.questions.map((q, i) => (
                <li key={q.key}>
                  <ResultItem q={q} item={itemOf.get(q.key)!} n={i + 1} where={loaded.where(q)} lecture={content.note(q.slug)?.title ?? q.slug} to={noteHref(content, q.slug, q.stepId)} />
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : null}
    </>
  );
}

function ResultItem({ q, item, n, where, lecture, to }: { q: Question; item: ExamItem; n: number; where: string | undefined; lecture: string; to: string }) {
  const answered = isAnswered(item.answer);
  const ok = item.correct === true;
  const verdict = !answered ? "Not answered." : ok ? "Correct." : "Not quite.";
  return (
    <article className="check exam-result" data-result={ok ? "correct" : "incorrect"} aria-label={`Question ${n}`}>
      <header className="exam-result-head">
        <span className="exam-result-n">Question {n}</span>
        <span className="exam-result-where">
          {lecture}
          {where ? (
            <>
              {" · "}
              <Md md={where} inline />
            </>
          ) : null}
        </span>
        <a className="text-link" href={to}>
          Open in the lecture <Icon name="arrowRight" size={14} />
        </a>
      </header>
      <Md md={q.prompt} className="check-prompt" />
      {q.kind === "mcq" ? <McqResult q={q} picked={Array.isArray(item.answer) ? item.answer : []} /> : <NumericResult q={q} answer={typeof item.answer === "number" ? item.answer : undefined} />}
      <p className="check-verdict" data-ok={answered ? ok : false}>
        <Icon name={ok ? "check" : "cross"} size={18} />
        {verdict}
        {item.confidence ? <span className="exam-said"> You said: {CONFIDENCE_LABEL[item.confidence]}.</span> : null}
      </p>
      <div className="check-why" role="note">
        <span className="check-why-label">Why</span>
        <Md md={q.why} />
      </div>
    </article>
  );
}

function McqResult({ q, picked }: { q: Extract<Question, { kind: "mcq" }>; picked: number[] }) {
  return (
    <ul className="mcq exam-options-list">
      {q.options.map((o, i) => {
        const mine = picked.includes(i);
        const feedback = o.correct ? "correct" : mine ? "wrong" : "neutral";
        return (
          <li key={i}>
            <div className="mcq-option" data-picked={mine || undefined} data-feedback={feedback}>
              <Md md={o.md} inline className="mcq-text" />
              {o.correct ? (
                <span className="mcq-mark" aria-label={mine ? "Your answer, correct" : "Correct answer"}>
                  <Icon name="check" size={18} />
                </span>
              ) : mine ? (
                <span className="mcq-mark" aria-label="Your answer, incorrect">
                  <Icon name="cross" size={18} />
                </span>
              ) : null}
            </div>
            {mine && o.feedback ? (
              <div className="mcq-feedback">
                <Md md={o.feedback} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function NumericResult({ q, answer }: { q: Extract<Question, { kind: "numeric" }>; answer: number | undefined }) {
  const right = answer !== undefined && withinTolerance(answer, q.answer, q.tol);
  const diagnosis = answer !== undefined && !right ? q.wrong.find((w) => withinTolerance(answer, w.answer, w.tol))?.md : undefined;
  return (
    <div className="exam-numeric">
      <p>
        Your answer: <strong>{answer === undefined ? "none" : formatNumber(answer)}</strong>
      </p>
      <p className="check-answer">
        The answer is {formatNumber(q.answer)}
        {q.tol > 0 ? ` (within ±${formatNumber(q.tol)})` : ""}.
      </p>
      {diagnosis ? (
        <div className="mcq-feedback">
          <Md md={diagnosis} />
        </div>
      ) : null}
    </div>
  );
}
