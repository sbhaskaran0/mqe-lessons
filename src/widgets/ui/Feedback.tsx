// Goal feedback and the prediction panel. Both sit below the controls so their appearance never moves the plot.
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { format } from "../format";
import type { GoalState, PredictRuntime } from "../core/useWidgetRuntime";
import { BulbIcon, CheckIcon } from "./icons";
import { MdText } from "./MdText";

export function GoalFeedback({ goal }: { goal: GoalState | null }) {
  // The Hint button goes once pressed, so keyboard focus would fall to the page; it moves to the hint instead, without
  // scrolling. A hint that shows by itself after a few tries is only announced: the learner is busy with a slider.
  const hint = useRef<HTMLParagraphElement>(null);
  const asked = !!goal?.hintAsked;
  useEffect(() => {
    if (asked) hint.current?.focus({ preventScroll: true });
  }, [asked]);
  return (
    <div className="w-feedback" aria-live="polite">
      {goal?.met ? (
        <p className="w-success" data-goal="met">
          <CheckIcon /> <MdText md={goal.goal.success} />
        </p>
      ) : goal?.hintVisible && goal.goal.hint ? (
        <p className="w-hint" tabIndex={-1} ref={hint}>
          <BulbIcon /> <MdText md={goal.goal.hint} />
        </p>
      ) : null}
    </div>
  );
}

export function HintButton({ goal }: { goal: GoalState | null }) {
  if (!goal?.goal.hint || goal.met || goal.hintVisible) return null;
  return (
    <button type="button" className="w-btn w-btn-quiet w-btn-sm" aria-label="Hint" onClick={goal.askHint}>
      <BulbIcon /> <span className="w-btn-label">Hint</span>
    </button>
  );
}

type PredictProps = {
  predict: PredictRuntime | null;
  /** Without options: how to make the guess on the plot, and the value the marker reads (undefined until moved). */
  howTo?: string;
  value?: number;
  describe?: (value: number) => string;
};

export function PredictPanel({ predict, howTo, value, describe }: PredictProps) {
  // The commit button is replaced by the result, so keyboard focus would fall to the page; it moves to the result
  // instead, without scrolling: the plot, where the reveal plays, stays in view.
  const result = useRef<HTMLDivElement>(null);
  const committed = useRef(false);
  const asking = predict?.phase === "ask";
  // The learner's typed number (compute-before-reveal) and their optional reason: local until they commit.
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const ids = useId();
  const ask = predict?.ask;
  useEffect(() => {
    setTyped("");
    setReason("");
  }, [ask]);
  useEffect(() => {
    if (asking || !committed.current) return;
    committed.current = false;
    result.current?.focus({ preventScroll: true });
  }, [asking]);
  if (!predict) return null;
  const computing = predict.readout !== undefined && !predict.options;
  const number = typed.trim() === "" ? undefined : Number(typed);
  const canCommit = predict.options ? predict.choice !== null : computing ? number !== undefined && Number.isFinite(number) : value !== undefined;
  const commit = () => {
    if (!canCommit) return;
    committed.current = true;
    predict.commit(computing ? number : value, reason);
  };
  return (
    <div className="w-predict" role="group" aria-label="Prediction" data-phase={predict.phase}>
      <p className="w-predict-ask">
        <MdText md={predict.ask} />
      </p>
      {predict.options ? (
        <div className="w-options" role="radiogroup" aria-label="Your prediction">
          {predict.options.map((o, i) => {
            const verdict = !asking && predict.answer !== undefined ? (i === predict.answer ? "right" : i === predict.choice ? "wrong" : "") : "";
            return (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={predict.choice === i}
                disabled={!asking}
                className={`w-option${predict.choice === i ? " w-option-chosen" : ""}${verdict ? ` w-option-${verdict}` : ""}`}
                onClick={() => predict.choose(i)}
              >
                <MdText md={o} />
              </button>
            );
          })}
        </div>
      ) : asking ? (
        computing ? (
          <label className="w-predict-field w-predict-number">
            <span>{howTo ?? "Work it out, then type your answer."}</span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
              }}
            />
          </label>
        ) : (
          <p className="w-predict-howto">{howTo ?? "Drag the marker to your guess."}</p>
        )
      ) : null}
      {asking ? (
        <>
          <label className="w-predict-field w-predict-reason" htmlFor={`${ids}-why`}>
            <span>Why do you think so? (optional)</span>
            <input id={`${ids}-why`} type="text" maxLength={280} value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === "Enter" && commit()} />
          </label>
          <button type="button" className="w-btn w-btn-primary" disabled={!canCommit} onClick={commit}>
            Commit prediction
          </button>
        </>
      ) : (
        <div className="w-predict-result" aria-live="polite" tabIndex={-1} ref={result}>
          <p>{verdictText(predict, describe)}</p>
          {explainers(predict)}
        </div>
      )}
    </div>
  );
}

/** After the verdict: what the chosen option's own feedback says (it answers that specific misconception), then the
 *  prediction's `why`, for right and wrong answers alike. */
function explainers(p: PredictRuntime): ReactNode {
  const chosen = p.result?.option;
  const own = chosen !== undefined ? p.feedback?.[chosen] : undefined;
  return (
    <>
      {own ? (
        <p className="w-predict-feedback">
          <MdText md={own} />
        </p>
      ) : null}
      {p.why ? (
        <p className="w-predict-why">
          <MdText md={p.why} />
        </p>
      ) : null}
    </>
  );
}

function verdictText(p: PredictRuntime, describe?: (v: number) => string): ReactNode {
  const r = p.result;
  if (r?.option !== undefined && p.options) {
    if (r.correct === true) return "Right. Watch it play out.";
    const answer = p.answer === undefined ? undefined : p.options[p.answer];
    if (r.correct === false && answer !== undefined) {
      return (
        <>
          Not quite: the answer is “<MdText md={answer} />”. Watch it play out.
        </>
      );
    }
    return "Here is what happens.";
  }
  if (r?.value !== undefined && p.readout !== undefined) {
    const you = format(".4~r", r.value);
    const model = r.expected !== undefined ? ` · model: ${format(".4~r", r.expected)}` : "";
    const lead = r.correct === true ? "Right. " : r.correct === false ? "Not quite. " : "";
    return `${lead}You: ${you}${model}. Here is what happens.`;
  }
  if (r?.value !== undefined) return `Your guess: ${describe ? describe(r.value) : r.value}. Here is what happens.`;
  return "Here is what happens.";
}
