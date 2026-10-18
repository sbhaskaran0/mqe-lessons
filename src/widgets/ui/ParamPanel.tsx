// Parameter controls. A parameter the learner can move is a native range input (keyboard steps, screen-reader values
// for free) restyled to a 44px touch target; the label is its symbol, which explains itself on hover or tap. A
// parameter the step fixes is not a control at all but a chip (symbol = value, locked), listed after the sliders so the
// thing to move is never pushed down the pane by the things that cannot be. A parameter whose every slider position
// has a label (`labels: {1: normal, 2: lognormal}`) is a choice, not a quantity: a segmented radio group of the labels.
import { type CSSProperties, type KeyboardEvent, memo, useMemo, useRef } from "react";
import type { NotationRow } from "../../ir";
import { autoStep, labelOf, nearestPosition, positionLabels, positionValue } from "../core/grid";
import type { ParamSpec } from "../core/types";
import type { Runtime } from "../core/useWidgetRuntime";
import { format, stepDecimals } from "../format";
import { notationFor } from "../notation";
import { LockIcon } from "./icons";
import { SymbolLabel } from "./SymbolLabel";

export { autoStep };

/** The value as the learner reads it: its label if it has one, else the number in the slider's format. */
export function paramText(p: ParamSpec, value: number): string {
  const named = labelOf(p, value);
  if (named !== undefined) return named;
  const fmt = p.format ?? `.${stepDecimals(p.step ?? autoStep(p.min, p.max))}f`;
  return format(fmt, value) + (p.unit ? ` ${p.unit}` : "");
}

type ItemProps = { id: string; p: ParamSpec; value: number; row: NotationRow | undefined };

/** A labelled choice: one radio per slider position, arrow keys moving between them (roving tab stop). */
const ParamChoice = memo(function ParamChoice({ id, p, value, row, labels, onChange }: ItemProps & { labels: string[]; onChange: (patch: Record<string, number>) => void }) {
  const group = useRef<HTMLDivElement>(null);
  const at = nearestPosition(p, value);
  const pick = (k: number) => {
    const next = Math.min(labels.length - 1, Math.max(0, k));
    onChange({ [id]: positionValue(p, next) });
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };
  const keys = (e: KeyboardEvent) => {
    const move = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
    const to = move !== undefined ? at + move : e.key === "Home" ? 0 : e.key === "End" ? labels.length - 1 : undefined;
    if (to === undefined) return;
    e.preventDefault();
    pick(to);
  };
  return (
    <div className="w-param" data-param={id}>
      <div className="w-param-head">
        <SymbolLabel tex={p.tex} label={p.label} row={row} fallback={id} />
      </div>
      <div ref={group} className="w-seg" role="radiogroup" aria-label={p.label ?? id} onKeyDown={keys}>
        {labels.map((text, k) => (
          <button key={k} type="button" role="radio" aria-checked={k === at} tabIndex={k === at ? 0 : -1} data-value={positionValue(p, k)} onClick={() => pick(k)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
});

const ParamSlider = memo(function ParamSlider({ id, p, value, row, onChange }: ItemProps & { onChange: (patch: Record<string, number>) => void }) {
  const step = p.step ?? autoStep(p.min, p.max);
  const text = paramText(p, value);
  const fill = `${(((value - p.min) / (p.max - p.min)) * 100).toFixed(2)}%`;
  return (
    <div className="w-param" data-param={id}>
      <div className="w-param-head">
        <SymbolLabel tex={p.tex} label={p.label} row={row} fallback={id} />
        <span className="w-param-value" aria-hidden="true">
          {text}
        </span>
      </div>
      <input
        type="range"
        className="w-range"
        min={p.min}
        max={p.max}
        step={step}
        value={value}
        aria-label={p.label ?? id}
        aria-valuetext={text}
        style={{ "--fill": fill } as CSSProperties}
        onChange={(e) => onChange({ [id]: Number(e.currentTarget.value) })}
      />
    </div>
  );
});

/** A fixed parameter: its symbol (with the same hover notation as a slider's), its value and a lock. */
const ParamChip = memo(function ParamChip({ id, p, value, row }: ItemProps) {
  return (
    <li className="w-chip" data-param={id} data-locked="">
      <SymbolLabel tex={p.tex} label={p.tex ? undefined : p.label} row={row} meaning={row?.meaning ? undefined : p.label} fallback={id} />
      <span className="w-readout-eq" aria-hidden="true">
        =
      </span>
      <span className="w-chip-value">{paramText(p, value)}</span>
      <span className="w-lock" title="Fixed in this step">
        <LockIcon />
        <span className="w-visually-hidden">{p.label ? `${p.label}: ` : ""}fixed in this step</span>
      </span>
    </li>
  );
});

export function ParamPanel({ rt, notation }: { rt: Runtime; notation: readonly NotationRow[] }) {
  const params = rt.spec.params ?? {};
  const rows = useMemo(
    () => Object.fromEntries(Object.entries(params).map(([id, p]) => [id, notationFor(notation, p.tex)])),
    [params, notation],
  );
  const ids = Object.keys(params);
  const free = ids.filter((id) => !rt.isLocked(id));
  const fixed = ids.filter((id) => rt.isLocked(id));
  if (!ids.length) return null;
  const valueOf = (id: string) => rt.params[id] ?? params[id]!.default;
  return (
    <div className="w-controls">
      {free.length ? (
        <div className="w-params" role="group" aria-label="Parameters">
          {free.map((id) => {
            const labels = positionLabels(params[id]!);
            return labels ? (
              <ParamChoice key={id} id={id} p={params[id]!} value={valueOf(id)} row={rows[id]} labels={labels} onChange={rt.set} />
            ) : (
              <ParamSlider key={id} id={id} p={params[id]!} value={valueOf(id)} row={rows[id]} onChange={rt.set} />
            );
          })}
        </div>
      ) : null}
      {fixed.length ? (
        <ul className="w-chips" aria-label="Fixed in this step">
          {fixed.map((id) => (
            <ParamChip key={id} id={id} p={params[id]!} value={valueOf(id)} row={rows[id]} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
