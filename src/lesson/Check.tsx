// Checkpoints: multiple choice (one or several correct options) and numeric answers with a tolerance.
// Submitting records the result and reveals per-option feedback and the explanation (`why`). A multiple-choice
// option can carry its own `feedback`, shown when it was the one chosen; a numeric answer near an anticipated wrong
// value shows that value's diagnosis instead of the generic "Not quite". A skipped check
// stays answerable, and its explanation stays hidden until it is answered.
// A wrong answer can be tried again: "Try again" clears the inputs and hides the verdict and the explanation until the
// next submit. The store keeps the first submitted result as `firstTry` (what the statistics count), counts every
// submit in `tries` and holds the latest as `result`; a correct answer is final.
// With `onAnswer` the check is a scheduled review instead: it starts unanswered whatever the lesson recorded, keeps its
// answer in the component and reports it to the caller, and leaves the lesson's record alone. No retry there, since
// the review has already been scored.
// A numeric check with `vary` (F2) shows a seeded variant of its numbers, drawn by `src/params`. In a lesson the first
// attempt is the base variant (seed 0: the lesson reads exactly like the note) and each retry draws a new one, with a
// seed derived from the store key and the number of submits so far; the seed is stored with the answer so a reload shows
// the same numbers. A review draws a fresh variant per showing (`seed`, or the day when omitted). `src/params` pulls in
// the derive parser, so it is imported lazily and only by a check that has `vary`.
import { Fragment, useEffect, useId, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { Md } from "../app/Md";
import { Icon } from "../app/ui";
import type { Block } from "../ir";
import { progress, useProgress, type CheckResult } from "../progress";
import "./derive.css";

type CheckBlock = Extract<Block, { t: "check" }>;
type McqBlock = Extract<CheckBlock, { kind: "mcq" }>;
type NumericBlock = Extract<CheckBlock, { kind: "numeric" }>;

type RecordFn = (result: "correct" | "incorrect", answer: number[] | number) => void;
type ParamsModule = typeof import("../params");
type Variant = import("../params").Variant;

let paramsModule: ParamsModule | undefined;
let paramsLoading: Promise<ParamsModule> | undefined;
const loadParams = () => (paramsLoading ??= import("../params").then((m) => (paramsModule = m)));

/** Loads `src/params` when `needed`: the module (null while loading) and whether the load failed. */
function useParams(needed: boolean): { mod: ParamsModule | null; failed: boolean } {
  const [mod, setMod] = useState<ParamsModule | null>(paramsModule ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!needed || mod) return;
    let live = true;
    loadParams().then(
      (m) => live && setMod(m),
      () => {
        paramsLoading = undefined;
        if (live) setFailed(true);
      },
    );
    return () => void (live = false);
  }, [needed, mod]);
  return { mod: needed ? mod : null, failed };
}

/** A stable, nonzero, non-negative integer seed from a string (FNV-1a); 0 is reserved for the base variant. */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return ((h >>> 0) & 0x7fffffff) || 1;
}

export function Check({ block, storeKey, onAnswer, seed: seedProp }: { block: CheckBlock; storeKey: string; onAnswer?: RecordFn; seed?: number }) {
  const stored = useProgress().checks[storeKey];
  const [local, setLocal] = useState<CheckResult>();
  // Which attempt the inputs belong to: "Try again" bumps it, which remounts them empty.
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const root = useRef<HTMLElement>(null);
  const reviewing = onAnswer !== undefined;
  const result = reviewing ? local : retrying ? undefined : stored;

  // Which variant of a `vary` check is on screen. A submitted answer keeps the seed it was given for; before that,
  // a lesson's first attempt is the base variant and attempt n is seeded by the key and n, while a review draws
  // from the caller's seed (the day, when it passes none).
  const varied = block.kind === "numeric" && !!block.vary?.length;
  const pendingSeed = reviewing ? seedFrom(`${storeKey}@${seedProp ?? new Date().toISOString().slice(0, 10)}`) : stored?.tries ? seedFrom(`${storeKey}#${stored.tries}`) : 0;
  const answered = result !== undefined && result.result !== "skipped";
  const seed = !varied ? 0 : answered ? (result.seed ?? 0) : pendingSeed;
  const { mod, failed } = useParams(varied);
  const variant = useMemo(() => (mod && block.kind === "numeric" && varied ? mod.instantiate(block, seed) : undefined), [mod, block, varied, seed]);
  // The submit waits for the module (the right answer depends on it); a failed load grades the base variant.
  const ready = !varied || !!variant || failed;

  useEffect(() => {
    if (attempt > 0) root.current?.querySelector<HTMLElement>("input")?.focus();
  }, [attempt]);

  const record: RecordFn = (res, answer) => {
    setRetrying(false);
    const used = varied && variant ? seed : undefined;
    if (onAnswer) {
      setLocal({ result: res, answer, tries: 1, at: Date.now(), ...(used !== undefined ? { seed: used } : {}) });
      onAnswer(res, answer);
    } else progress.recordCheck(storeKey, res, answer, used);
  };
  const tryAgain = reviewing || result?.result !== "incorrect" ? undefined : () => {
    setRetrying(true);
    setAttempt((a) => a + 1);
  };
  const props = { result, record, tryAgain };
  const numeric = block.kind === "numeric" ? { variant, seed, ready } : undefined;
  return (
    <section ref={root} className="check" data-kind={block.kind} data-result={result?.result} aria-label="Checkpoint">
      <div className="check-kicker">
        <Icon name="flag" size={16} />
        <span>Checkpoint</span>
        {result?.result === "skipped" ? <span className="check-badge">Skipped</span> : null}
      </div>
      <Md md={variant?.prompt ?? block.prompt} className="check-prompt" />
      {block.kind === "mcq" ? <Mcq key={attempt} block={block} {...props} /> : <Numeric key={attempt} block={block} {...props} {...numeric!} />}
    </section>
  );
}

type PartProps = { result: CheckResult | undefined; record: RecordFn; tryAgain: (() => void) | undefined };

function TryAgain({ onClick }: { onClick: (() => void) | undefined }) {
  return onClick ? (
    <div className="check-actions">
      <button type="button" className="btn btn-secondary" onClick={onClick}>
        <Icon name="reset" size={16} />
        Try again
      </button>
    </div>
  ) : null;
}

function Why({ md }: { md: string }) {
  return (
    <div className="check-why" role="note">
      <span className="check-why-label">Why</span>
      <Md md={md} />
    </div>
  );
}

/** The verdict is a live region that stays mounted: one inserted together with its text is often not announced.
 *  Empty until the check is answered (CSS hides it), then it holds the text. */
function Verdict({ result, verdictRef, diagnosis }: { result: CheckResult | undefined; verdictRef: RefObject<HTMLParagraphElement | null>; diagnosis?: string | undefined }) {
  const shown = result && result.result !== "skipped" ? result.result === "correct" : undefined;
  return (
    <p ref={verdictRef} className="check-verdict" data-ok={shown} role="status" tabIndex={-1}>
      {shown === undefined ? null : (
        <>
          <Icon name={shown ? "check" : "cross"} size={18} />
          {shown ? "Correct." : diagnosis ? <Md md={diagnosis} inline className="check-diagnosis" /> : "Not quite."}
        </>
      )}
    </p>
  );
}

/** Submitting removes the button that had focus; move it to the verdict so the answer and the explanation that
 *  follows it are where a keyboard or screen-reader user is. Only a submit made here counts: opening a check that
 *  was answered earlier must not take focus. */
function useVerdictFocus(answered: boolean) {
  const verdictRef = useRef<HTMLParagraphElement>(null);
  const armed = useRef(false);
  useEffect(() => {
    if (!answered || !armed.current) return;
    armed.current = false;
    verdictRef.current?.focus();
  }, [answered]);
  return { verdictRef, arm: () => void (armed.current = true) };
}

function Mcq({ block, result, record, tryAgain }: PartProps & { block: McqBlock }) {
  const name = useId();
  const multi = block.options.filter((o) => o.correct).length > 1;
  const answered = result !== undefined && result.result !== "skipped";
  const stored = Array.isArray(result?.answer) ? result.answer : [];
  const [chosen, setChosen] = useState<number[]>(answered ? stored : []);
  const locked = answered;
  const shown = locked ? stored : chosen;
  const { verdictRef, arm } = useVerdictFocus(answered);

  const toggle = (i: number) => {
    if (locked) return;
    setChosen((c) => (multi ? (c.includes(i) ? c.filter((x) => x !== i) : [...c, i].sort((a, b) => a - b)) : [i]));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (chosen.length === 0) return;
    const correct = block.options.every((o, i) => o.correct === chosen.includes(i));
    arm();
    record(correct ? "correct" : "incorrect", chosen);
  };

  return (
    <form className="check-form" onSubmit={submit}>
      <fieldset className="mcq" disabled={locked}>
        <legend className="visually-hidden">{multi ? "Choose every correct answer" : "Choose one answer"}</legend>
        {multi ? <p className="check-hint">Select all that apply.</p> : null}
        {block.options.map((o, i) => {
          const picked = shown.includes(i);
          const feedback = locked ? (o.correct ? "correct" : picked ? "wrong" : "neutral") : undefined;
          const fbId = `${name}-fb-${i}`;
          const note = locked && picked && o.feedback ? o.feedback : undefined;
          return (
            <Fragment key={i}>
              <label className="mcq-option" data-picked={picked || undefined} data-feedback={feedback}>
                <input type={multi ? "checkbox" : "radio"} name={name} checked={picked} onChange={() => toggle(i)} aria-describedby={note ? fbId : undefined} />
                <Md md={o.md} inline className="mcq-text" />
                {feedback === "correct" ? (
                  <span className="mcq-mark" aria-label={picked ? "Your answer, correct" : "Correct answer"}>
                    <Icon name="check" size={18} />
                  </span>
                ) : feedback === "wrong" ? (
                  <span className="mcq-mark" aria-label="Your answer, incorrect">
                    <Icon name="cross" size={18} />
                  </span>
                ) : null}
              </label>
              {note ? (
                <div id={fbId} className="mcq-feedback" data-option={i}>
                  <Md md={note} />
                </div>
              ) : null}
            </Fragment>
          );
        })}
      </fieldset>
      <Verdict result={result} verdictRef={verdictRef} />
      {locked ? (
        <>
          <Why md={block.why} />
          <TryAgain onClick={tryAgain} />
        </>
      ) : (
        <div className="check-actions">
          <button type="submit" className="btn btn-primary" disabled={chosen.length === 0}>
            Check answer
          </button>
        </div>
      )}
    </form>
  );
}

/** Accepts 25, 25.0, −3 (Unicode minus), 1,000, 1e-3 and simple fractions like 1/3. */
export function parseNumber(raw: string): number | undefined {
  const s = raw.trim().replace(/[−–]/g, "-").replace(/,/g, "").replace(/\s+/g, "");
  if (!s) return undefined;
  const frac = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s);
  if (frac) {
    const d = Number(frac[2]);
    return d === 0 ? undefined : Number(frac[1]) / d;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function withinTolerance(value: number, answer: number, tol: number): boolean {
  // A hair of slack so 0.1 + 0.2 style float noise never marks a right answer wrong.
  return Math.abs(value - answer) <= tol + 1e-9 * Math.max(1, Math.abs(answer));
}

const formatNumber = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(10))));

/** `variant` is the seeded variant once `src/params` has loaded (undefined: show and grade the check as written);
 *  `ready` is false while the submit has to wait for it. */
function Numeric({ block, result, record, tryAgain, variant, seed, ready }: PartProps & { block: NumericBlock; variant: Variant | undefined; seed: number; ready: boolean }) {
  const q = variant ?? { answer: block.answer, tol: block.tol, wrong: block.wrong ?? [], why: block.why };
  const id = useId();
  const answered = result !== undefined && result.result !== "skipped";
  const [text, setText] = useState(answered && typeof result.answer === "number" ? formatNumber(result.answer) : "");
  const [error, setError] = useState<string | null>(null);
  const locked = answered;
  const { verdictRef, arm } = useVerdictFocus(answered);
  // The first anticipated wrong answer the stored value falls within, read back from the answer so a revisit shows it too.
  const stored = typeof result?.answer === "number" ? result.answer : undefined;
  const diagnosis = answered && result?.result === "incorrect" && stored !== undefined ? q.wrong.find((w) => withinTolerance(stored, w.answer, w.tol))?.md : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = parseNumber(text);
    if (value === undefined) {
      setError("Enter a number, for example 0.25 or 1/4.");
      return;
    }
    setError(null);
    arm();
    record(withinTolerance(value, q.answer, q.tol) ? "correct" : "incorrect", value);
  };

  return (
    <form className="check-form" onSubmit={submit}>
      <div className="numeric-row">
        <label htmlFor={id} className="numeric-label">
          Your answer
        </label>
        <input
          id={id}
          className="numeric-input"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={text}
          readOnly={locked}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => setText(e.target.value)}
        />
        {!locked ? (
          <button type="submit" className="btn btn-primary" disabled={!text.trim() || !ready}>
            Check answer
          </button>
        ) : null}
      </div>
      {error ? (
        <p id={`${id}-error`} className="check-error" role="alert">
          {error}
        </p>
      ) : null}
      <Verdict result={result} verdictRef={verdictRef} diagnosis={diagnosis} />
      {locked ? (
        <>
          {result?.result === "incorrect" || seed !== 0 ? (
            <p className="check-answer">
              The answer is {formatNumber(q.answer)}
              {q.tol > 0 ? ` (within ±${formatNumber(q.tol)})` : ""}.
            </p>
          ) : null}
          <Why md={q.why} />
          <TryAgain onClick={tryAgain} />
        </>
      ) : null}
    </form>
  );
}
