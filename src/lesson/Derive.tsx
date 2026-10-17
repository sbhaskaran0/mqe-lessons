// The derivation exercise (E2): the learner types the lines of a derivation, one at a time, and the checker
// (src/derive, loaded on first use) says whether each line is a step on the way, a true line that goes nowhere, or
// wrong. Any valid line is accepted ("attempt the whole derivation"); "Step by step" names the next step in words.
// Justify steps are multiple-choice questions about a line shown on screen. The record lives in the progress store, so
// reloading keeps the lines; the step's Continue gate opens once the exercise is finished, given up or skipped.
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Md } from "../app/Md";
import { Icon } from "../app/ui";
import type { Block } from "../ir";
import { Tex } from "../lib/Tex";
import { progress, useProgress, useSettings } from "../progress";
import "./derive.css";

type DeriveBlock = Extract<Block, { t: "derive" }>;
type DeriveApi = typeof import("../derive");
type Runtime = import("../derive").DeriveRuntime;
type Verdict = import("../derive").CheckVerdict;
type DeriveStep = DeriveBlock["steps"][number];

/** The step's words without its closing maths, which the learner is meant to produce. */
export function stepProse(md: string): string {
  const close = md.lastIndexOf("$");
  const open = close > 0 ? md.lastIndexOf("$", close - 1) : -1;
  if (open < 0) return md;
  return (md.slice(0, open) + md.slice(close + 1)).replace(/[\s:;,.—-]+$/, "").trim() || md;
}

/** The parser's own "Did you mean …?" sentence is shown as buttons instead. */
/** A message from the checker or the author. An author's `reject:` message is inline markdown with maths; the checker's
 *  own messages are plain text (they quote what the learner typed, where `*` and `_` must stay literal) unless they
 *  carry `$…$`. */
function Say({ text, markdown = false }: { text: string; markdown?: boolean }) {
  return markdown || text.includes("$") ? <Md md={text} inline /> : <>{text}</>;
}

const withoutDidYouMean = (m: string) => m.replace(/\s*Did you mean [^?]*\?\s*$/, "").trim();

/** Swap the unknown symbol the message names for a suggestion; if it can't be found, append it. */
function applySuggestion(input: string, message: string, suggestion: string): string {
  const spelled = /symbol "([^"]+)"/.exec(message)?.[1];
  if (spelled && input.includes(spelled)) return input.replace(spelled, suggestion);
  return input + suggestion;
}

/** `exercise` makes the block an exercise whatever Settings "Review mode" says: a scheduled review must ask the
 *  question, not show the worked answer. */
export function Derive({ block, storeKey, exercise = false }: { block: DeriveBlock; storeKey: string; exercise?: boolean }) {
  const rec = useProgress().derives[storeKey];
  const review = useSettings().review;
  const [api, setApi] = useState<DeriveApi | null>(null);
  const [loadError, setLoadError] = useState(false);

  // The checker (parser, equivalence engine) stays out of the entry chunk and loads with the first derivation.
  useEffect(() => {
    let live = true;
    import("../derive").then(
      (m) => live && setApi(m),
      () => live && setLoadError(true),
    );
    return () => void (live = false);
  }, []);

  const built = useMemo(() => {
    if (!api) return null;
    try {
      return { rt: api.fromIR(block) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [api, block]);
  const rt = built && "rt" in built ? built.rt : undefined;

  const gaveUp = rec?.result === "gave-up";
  // Focus goes to the worked derivation's heading only when it was opened by pressing the button here.
  const gaveUpHere = useRef(false);

  return (
    <section className="derive" data-result={rec?.result} aria-label="Derivation">
      <div className="derive-kicker">
        <Icon name="sliders" size={16} />
        <span>Derivation</span>
        {rec?.result === "skipped" ? <span className="derive-badge">Skipped</span> : null}
        {gaveUp ? <span className="derive-badge">Worked answer shown</span> : null}
        {rec?.result === "done" ? <span className="derive-badge" data-ok="true">Done</span> : null}
      </div>
      <Md md={block.title} inline as="p" className="derive-title" />
      <Givens block={block} />
      {loadError ? (
        <p className="derive-note" role="alert">
          The derivation checker could not be loaded. Reload the page, or skip this step.
        </p>
      ) : built && "error" in built ? (
        <>
          <p className="derive-note" role="alert">
            This derivation could not be set up for checking: {built.error}
          </p>
          <WorkedView block={block} />
        </>
      ) : gaveUp || (review && !exercise && rec?.result !== "done") ? (
        <WorkedView block={block} rt={rt} api={api} lines={rec?.state.lines ?? []} focus={gaveUp && gaveUpHere.current} />
      ) : !rt || !api ? (
        <p className="derive-loading" aria-busy="true">
          Loading the checker…
        </p>
      ) : (
        <Exercise block={block} rt={rt} api={api} storeKey={storeKey} onGiveUp={() => (gaveUpHere.current = true)} />
      )}
    </section>
  );
}

function Givens({ block }: { block: DeriveBlock }) {
  if (!block.given.length && !block.define.length) return null;
  return (
    <div className="derive-givens">
      {block.given.length ? (
        <div>
          <p className="derive-label">Given</p>
          <ul className="derive-list">
            {block.given.map((g, i) => (
              <li key={i}>
                <Tex className="derive-math" tex={g} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {block.define.length ? (
        <div>
          <p className="derive-label">Where</p>
          <ul className="derive-list">
            {block.define.map((g, i) => (
              <li key={i}>
                <Tex className="derive-math" tex={g} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Every step of the derivation, as the author wrote it. */
function Worked({ block }: { block: DeriveBlock }) {
  return (
    <ol className="derive-worked" aria-label="Worked derivation">
      {block.steps.map((s, i) => (
        <li key={i} className="derive-worked-step" data-kind={s.justify ? "justify" : "step"}>
          <Md md={s.md} inline />
          {s.justify ? <JustifyAnswer step={s} /> : null}
        </li>
      ))}
    </ol>
  );
}

function JustifyAnswer({ step }: { step: DeriveStep }) {
  const right = step.justify!.options.filter((o) => o.correct);
  return (
    <div className="derive-why">
      <Md md={step.justify!.prompt} inline className="derive-why-label" />
      {right.map((o, i) => (
        <Md key={i} md={o.md} inline className="derive-why-answer" />
      ))}
    </div>
  );
}

/** Given up, or Review mode: the whole worked derivation, and any lines the learner had typed. */
function WorkedView({ block, rt, api, lines = [], focus = false }: { block: DeriveBlock; rt?: Runtime | undefined; api?: DeriveApi | null; lines?: string[]; focus?: boolean }) {
  return (
    <div className="derive-done">
      {lines.length && rt && api ? <Lines lines={lines} rt={rt} api={api} /> : null}
      <WorkedList block={block} focus={focus} />
    </div>
  );
}

function WorkedList({ block, focus = false }: { block: DeriveBlock; focus?: boolean }) {
  const headRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) headRef.current?.focus();
  }, [focus]);
  return (
    <div>
      <h4 ref={headRef} className="derive-label" tabIndex={-1}>
        Worked derivation
      </h4>
      <Worked block={block} />
    </div>
  );
}

function Lines({ lines, rt, api }: { lines: string[]; rt: Runtime; api: DeriveApi }) {
  return (
    <div>
      <p className="derive-label">Your lines</p>
      <ol className="derive-lines" aria-label="Your lines">
        {lines.map((l, i) => {
          const p = api.preview(l, rt);
          return <li key={i}>{p.ok ? <Tex className="derive-math" tex={p.latex} /> : <code>{l}</code>}</li>;
        })}
      </ol>
    </div>
  );
}

function Exercise({ block, rt, api, storeKey, onGiveUp }: { block: DeriveBlock; rt: Runtime; api: DeriveApi; storeKey: string; onGiveUp: () => void }) {
  const rec = useProgress().derives[storeKey];
  const state = rec?.state ?? api.initialState();
  const justified = rec?.justified ?? [];
  const attempts = rec?.attempts ?? 0;
  const hints = rec?.hints ?? 0;
  const done = rec?.result === "done";

  const inputId = useId();
  const previewId = `${inputId}-preview`;
  const inputRef = useRef<HTMLInputElement>(null);
  const verdictRef = useRef<HTMLDivElement>(null);
  const focusVerdict = useRef(false);
  const [input, setInput] = useState("");
  const [stepMode, setStepMode] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [hintShown, setHintShown] = useState<number[]>([]);

  const justifyIdx = rt.steps.filter((s) => s.justify).map((s) => s.index);
  const hasTyped = rt.milestones.length > 0;
  // Like the checker, a justify step counts once the typed step before it is reached.
  const nextMilestone = rt.milestones[state.reached] ?? rt.steps.length;
  const pendingJustify = justifyIdx.filter((i) => (i < nextMilestone || !hasTyped) && !justified.includes(i));
  const allJustified = justifyIdx.every((i) => justified.includes(i));
  const typingDone = !hasTyped || state.done;

  // The first step still to do, for "Step by step".
  const nextStep = rt.steps.find((s) => (s.justify ? !justified.includes(s.index) : (s.milestone ?? 0) > state.reached));

  const preview = useMemo(() => (input.trim() ? api.preview(input, rt) : null), [api, rt, input]);
  const chips = useMemo(() => rt.table.all().filter((s) => ["scalar", "dim", "data", "mean", "matrix", "defined"].includes(s.kind)), [rt]);

  // Submitting the last line removes the input that had focus: the verdict takes it, so the result is where a
  // keyboard or screen-reader user is. Only a submit made here counts; opening a finished exercise takes no focus.
  useEffect(() => {
    if (!focusVerdict.current) return;
    focusVerdict.current = false;
    verdictRef.current?.focus();
  }, [typingDone, done]);

  const save = (next: typeof state, passed: number[], extra: { attempts?: number } = {}) => {
    const complete = (!hasTyped || next.done) && justifyIdx.every((i) => passed.includes(i));
    progress.recordDerive(storeKey, { state: next, justified: passed, ...extra, ...(complete ? { result: "done" as const } : {}) });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    const { verdict: v, state: next } = api.check(rt, state, text);
    setVerdict(v);
    if (v.kind === "error") {
      progress.recordDerive(storeKey, { attempts: attempts + 1 });
      return;
    }
    setInput("");
    if (next.done) focusVerdict.current = true;
    save(next, justified, { attempts: attempts + 1 });
  };

  // The input, its preview and the symbol chips must clear the fixed Continue bar. `nearest` only moves the page by the
  // missing amount (and not at all when the group is in view); the CSS scroll-margin leaves room for the bar.
  const composeRef = useRef<HTMLDivElement>(null);
  const keepComposeVisible = () => composeRef.current?.scrollIntoView?.({ block: "nearest" });
  useEffect(() => {
    if (inputRef.current && document.activeElement === inputRef.current) keepComposeVisible();
  }, [preview]);

  const insert = (text: string) => {
    const el = inputRef.current;
    const at = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? at;
    setInput(input.slice(0, at) + text + input.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + text.length, at + text.length);
    });
  };

  const showHint = (i: number) => {
    if (hintShown.includes(i)) return;
    setHintShown([...hintShown, i]);
    progress.recordDerive(storeKey, { hints: hints + 1 });
  };

  const passJustify = (i: number) => {
    if (justified.includes(i)) return;
    const passed = [...justified, i].sort((a, b) => a - b);
    if (typingDone && justifyIdx.every((j) => passed.includes(j))) focusVerdict.current = true;
    save(state, passed);
  };

  const giveUp = () => {
    onGiveUp();
    progress.recordDerive(storeKey, { result: "gave-up" });
  };

  // The lines reached so far, each with its worked line. Once done the full derivation below replaces them.
  const revealed = done ? [] : rt.steps.filter((s) => (s.justify ? justified.includes(s.index) : state.reached > 0 && (s.milestone ?? 0) <= state.reached));

  return (
    <div className="derive-exercise">
      {revealed.length ? (
        <ol className="derive-worked derive-revealed" aria-label="Steps reached">
          {revealed.map((s) => (
            <li key={s.index} className="derive-worked-step" data-kind={s.justify ? "justify" : "step"} value={s.index + 1}>
              <Md md={block.steps[s.index]!.md} inline />
              {s.justify ? <JustifyAnswer step={block.steps[s.index]!} /> : null}
            </li>
          ))}
        </ol>
      ) : null}

      {state.lines.length ? <Lines lines={state.lines} rt={rt} api={api} /> : null}

      {done ? null : pendingJustify.map((i) => <JustifyQuestion key={i} step={block.steps[i]!} index={i} onPass={() => passJustify(i)} />)}

      <div ref={verdictRef} className="derive-verdict" role="status" tabIndex={-1} data-kind={verdict?.kind}>
        {done ? (
          <p className="derive-verdict-line" data-ok="true">
            <Icon name="check" size={18} /> Derivation complete.
          </p>
        ) : (
          <>
            {verdict ? <VerdictView v={verdict} block={block} rt={rt} onSuggest={(s) => setInput(applySuggestion(input, verdict.kind === "error" ? verdict.message : "", s))} /> : null}
            {typingDone && hasTyped && !allJustified ? <p className="derive-line-note">You reached the target. Answer the question above to finish.</p> : null}
          </>
        )}
      </div>

      {done ? <WorkedList block={block} /> : null}

      {!typingDone ? (
        <form className="derive-form" onSubmit={submit}>
          <label className="derive-switch">
            <input type="checkbox" checked={stepMode} onChange={(e) => setStepMode(e.target.checked)} />
            <span>Step by step</span>
          </label>
          {stepMode && nextStep ? (
            <div className="derive-next">
              <p className="derive-label">Next: step {nextStep.index + 1}</p>{" "}
              {nextStep.justify ? <p>Answer the question above.</p> : <Md md={stepProse(nextStep.md)} inline />}
              {!nextStep.justify && nextStep.hint ? (
                hintShown.includes(nextStep.index) ? (
                  <div className="derive-hint" role="note">
                    <span className="derive-label">Hint</span> <Md md={nextStep.hint} inline />
                  </div>
                ) : (
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => showHint(nextStep.index)}>
                    Show hint
                  </button>
                )
              ) : null}
            </div>
          ) : null}
          <div className="derive-compose" ref={composeRef}>
          <label htmlFor={inputId} className="derive-input-label">
            Your next line
          </label>
          <div className="derive-row">
            <input
              ref={inputRef}
              id={inputId}
              className="derive-input"
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={input}
              aria-describedby={previewId}
              onChange={(e) => setInput(e.target.value)}
              onFocus={keepComposeVisible}
            />
            <button type="submit" className="btn btn-primary" disabled={!input.trim()}>
              Check line
            </button>
          </div>
          <div id={previewId} className="derive-preview" data-ok={preview ? String(preview.ok) : undefined}>
            {preview?.ok ? (
              <>
                <span className="derive-label">I read this as</span> <Tex className="derive-math" tex={preview.latex} />
                {preview.note ? <p className="derive-line-note">{preview.note}</p> : null}
              </>
            ) : preview ? (
              <>
                <span className="derive-label">Not readable yet</span> <span>
                  <Say text={withoutDidYouMean(preview.error)} />
                </span>
                <Suggestions items={preview.suggestions} onPick={(s) => setInput(applySuggestion(input, preview.error, s))} />
              </>
            ) : (
              <span className="derive-hintline">Type a line using the symbols below, then press Enter.</span>
            )}
          </div>
          {chips.length ? (
            <div className="derive-chips" role="group" aria-label="Symbols">
              {chips.map((s) => {
                const name = rt.table.typed(s.key);
                return (
                  <button key={s.key} type="button" className="derive-chip" aria-label={`Insert ${name}`} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(name)}>
                    <Tex tex={rt.table.latex(s.key)} />
                  </button>
                );
              })}
            </div>
          ) : null}
          </div>
        </form>
      ) : null}
      {!done ? (
        <div className="derive-actions">
          <button type="button" className="btn btn-ghost btn-small" onClick={giveUp}>
            Show worked derivation
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Suggestions({ items, onPick }: { items: string[]; onPick: (s: string) => void }) {
  if (!items.length) return null;
  return (
    <span className="derive-suggest">
      {" "}
      Did you mean{" "}
      {items.map((s) => (
        <button key={s} type="button" className="derive-chip" onClick={() => onPick(s)}>
          {s}
        </button>
      ))}
      ?
    </span>
  );
}

function VerdictView({ v, block, rt, onSuggest }: { v: Verdict; block: DeriveBlock; rt: Runtime; onSuggest: (s: string) => void }) {
  if (v.kind === "target")
    return (
      <p className="derive-verdict-line" data-ok="true">
        <Icon name="check" size={18} /> That is the target.
      </p>
    );
  if (v.kind === "milestone") {
    const idx = v.index ?? rt.milestones[v.step - 1] ?? 0;
    return (
      <p className="derive-verdict-line" data-ok="true">
        <Icon name="check" size={18} /> Good: that is step {idx + 1} of {block.steps.length}.
      </p>
    );
  }
  if (v.kind === "valid-no-progress")
    return (
      <>
        <p className="derive-verdict-line" data-ok="neutral">
          That is true, but it doesn't get you closer yet. Try a different move.
        </p>
        {v.stepHint ? (
          <p className="derive-line-note">
            <span className="derive-label">Hint</span> <Md md={v.stepHint} inline />
          </p>
        ) : null}
      </>
    );
  return (
    <>
      <p className="derive-verdict-line" data-ok="false">
        <Icon name="cross" size={18} /> <span><Say text={withoutDidYouMean(v.message)} markdown={v.reject !== undefined} /></span>
      </p>
      <Suggestions items={v.suggestions ?? []} onPick={onSuggest} />
    </>
  );
}

/** A justify step: its line is shown first, then the question, which must be answered correctly to pass. */
function JustifyQuestion({ step, index, onPass }: { step: DeriveStep; index: number; onPass: () => void }) {
  const name = useId();
  const j = step.justify!;
  const multi = j.options.filter((o) => o.correct).length > 1;
  const [chosen, setChosen] = useState<number[]>([]);
  const [wrong, setWrong] = useState(false);
  const toggle = (i: number) => {
    setWrong(false);
    setChosen((c) => (multi ? (c.includes(i) ? c.filter((x) => x !== i) : [...c, i].sort((a, b) => a - b)) : [i]));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!chosen.length) return;
    if (j.options.every((o, i) => o.correct === chosen.includes(i))) onPass();
    else setWrong(true);
  };
  return (
    <form className="derive-justify" onSubmit={submit} aria-label={`Question for step ${index + 1}`}>
      <p className="derive-label">Step {index + 1}</p>
      <Md md={step.md} inline className="derive-justify-line" />
      <fieldset className="mcq">
        <legend className="derive-justify-prompt">
          <Md md={j.prompt} inline />
        </legend>
        {multi ? <p className="check-hint">Select all that apply.</p> : null}
        {j.options.map((o, i) => (
          <label key={i} className="mcq-option" data-picked={chosen.includes(i) || undefined}>
            <input type={multi ? "checkbox" : "radio"} name={name} checked={chosen.includes(i)} onChange={() => toggle(i)} />
            <Md md={o.md} inline className="mcq-text" />
          </label>
        ))}
      </fieldset>
      <p className="derive-justify-result" role="status" data-ok={wrong ? "false" : undefined}>
        {wrong ? "Not quite. Look at the line above and try another answer." : ""}
      </p>
      <div className="check-actions">
        <button type="submit" className="btn btn-primary" disabled={!chosen.length}>
          Check answer
        </button>
      </div>
    </form>
  );
}
