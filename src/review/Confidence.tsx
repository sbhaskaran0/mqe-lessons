// "How sure are you?", asked before a verdict: Guessing / Fairly sure / Sure (levels 1-3). Optional. Pressing the
// chosen level again clears it. Used by the spaced review and the mixed exam; lessons deliberately do not ask.
import { useId } from "react";
import type { ConfidenceLevel } from "../progress/store";
import "./confidence.css";

export const CONFIDENCE_LEVELS: readonly ConfidenceLevel[] = [1, 2, 3];
export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = { 1: "Guessing", 2: "Fairly sure", 3: "Sure" };

export function ConfidenceControl({ value, onChange, optional = true }: { value: ConfidenceLevel | undefined; onChange: (level: ConfidenceLevel | undefined) => void; optional?: boolean }) {
  const id = useId();
  return (
    <div className="confidence" role="group" aria-labelledby={id}>
      <span id={id} className="confidence-label">
        How sure are you?{optional ? <span className="muted"> (optional)</span> : null}
      </span>
      <div className="confidence-options">
        {CONFIDENCE_LEVELS.map((level) => (
          <button key={level} type="button" className="confidence-option" data-level={level} aria-pressed={value === level} onClick={() => onChange(value === level ? undefined : level)}>
            {CONFIDENCE_LABEL[level]}
          </button>
        ))}
      </div>
    </div>
  );
}
