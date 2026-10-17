// Parameter controls. A parameter the learner can move is a native range input (keyboard steps, screen-reader values
// for free) restyled to a 44px touch target; the label is its symbol, which explains itself on hover or tap. A
// parameter the step fixes is not a control at all but a chip (symbol = value, locked), listed after the sliders so the
// thing to move is never pushed down the pane by the things that cannot be.
import { type CSSProperties, memo, useMemo } from "react";
import type { NotationRow } from "../../ir";
import type { ParamSpec } from "../core/types";
import type { Runtime } from "../core/useWidgetRuntime";
import { format, stepDecimals } from "../format";
import { notationFor } from "../notation";
import { LockIcon } from "./icons";
import { SymbolLabel } from "./SymbolLabel";

/** A round step giving about 100 positions across the range. */
export function autoStep(min: number, max: number): number {
  const raw = (max - min) / 100;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 5, 10].find((m) => m * mag >= raw) ?? 10;
  return Number((unit * mag).toPrecision(12));
}

export function paramText(p: ParamSpec, value: number): string {
  const fmt = p.format ?? `.${stepDecimals(p.step ?? autoStep(p.min, p.max))}f`;
  return format(fmt, value) + (p.unit ? ` ${p.unit}` : "");
}

type ItemProps = { id: string; p: ParamSpec; value: number; row: NotationRow | undefined };

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
          {free.map((id) => (
            <ParamSlider key={id} id={id} p={params[id]!} value={valueOf(id)} row={rows[id]} onChange={rt.set} />
          ))}
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
