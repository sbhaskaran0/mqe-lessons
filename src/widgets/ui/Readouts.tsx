// Live values under the plot. Tabular figures and a min-width keep the chips from jittering as values change.
// They change with every slider step, so they are not announced as they change: <output> is a live region by default
// (role status), and its own aria-live="off" is what silences it (the parent's doesn't reach a nested live region).
import type { ReactNode, Ref } from "react";
import type { NotationRow } from "../../ir";
import type { Runtime } from "../core/useWidgetRuntime";
import { format } from "../format";
import { notationFor } from "../notation";
import { SymbolLabel } from "./SymbolLabel";

export type ReadoutItem = {
  id: string;
  tex?: string;
  label?: string;
  value: number;
  format?: string;
  /** Text for particular values (readout `labels`), shown instead of the number. */
  labels?: Record<string, string>;
  extra?: ReactNode;
  /** Makes the readout focusable from script (tabIndex -1): where focus goes when the control that changed it goes. */
  focusRef?: Ref<HTMLDivElement>;
};

export function Readouts({ items, rt, notation }: { items: ReadoutItem[]; rt: Runtime; notation: readonly NotationRow[] }) {
  const shown = items.filter((r) => rt.isShown(r.id));
  if (!shown.length) return null;
  return (
    <div className="w-readouts" aria-live="off">
      {shown.map((r) => (
        <div
          key={r.id}
          className={["w-readout", rt.highlight === r.id ? "w-hl" : "", rt.isRevealed(r.id) ? "w-reveal" : ""].join(" ").trim()}
          data-readout={r.id}
          ref={r.focusRef}
          tabIndex={r.focusRef ? -1 : undefined}
        >
          <SymbolLabel
            tex={r.tex}
            label={r.tex ? undefined : r.label}
            row={notationFor(notation, r.tex)}
            meaning={r.tex ? r.label : undefined}
            fallback={r.id}
          />
          <span className="w-readout-eq" aria-hidden="true">
            =
          </span>
          <output className="w-readout-value" aria-live="off">{readoutText(r)}</output>
          {r.extra}
        </div>
      ))}
    </div>
  );
}

/** A readout's value as shown: its label when `labels` names this value, else the number formatted. */
export function readoutText(r: Pick<ReadoutItem, "value" | "format" | "labels">): string {
  if (r.labels && Number.isFinite(r.value)) {
    for (const [k, text] of Object.entries(r.labels)) if (Math.abs(Number(k) - r.value) <= 1e-9 * Math.max(1, Math.abs(r.value))) return text;
  }
  return format(r.format, r.value);
}
