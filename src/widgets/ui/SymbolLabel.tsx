// A symbol (slider label, readout) that explains itself: hover, focus or tap shows its Notation row
// (meaning · kind · typical value) from the notes the widget illustrates.
import { useEffect, useId, useRef, useState } from "react";
import type { NotationRow } from "../../ir";
import { Tex } from "../../lib/Tex";
import { MdText } from "./MdText";

type Props = {
  tex?: string;
  label?: string;
  row: NotationRow | undefined;
  fallback: string;
  /** What this symbol means in this widget (a readout's label); shown above the notation row's kind and value. */
  meaning?: string;
};

export function SymbolLabel({ tex, label, row, fallback, meaning }: Props) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const ref = useRef<HTMLSpanElement>(null);

  // A tap opens the tip; the next tap anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const face = (
    <>
      {tex ? <Tex tex={tex} className="w-sym-tex" /> : null}
      {label ? <span className="w-sym-label">{label}</span> : null}
      {!tex && !label ? <span className="w-sym-label">{fallback}</span> : null}
    </>
  );
  const primary = meaning ?? row?.meaning;
  if (!primary) return <span className="w-sym">{face}</span>;
  return (
    <span className="w-sym w-sym-has-tip" ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="w-sym-button"
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      >
        {face}
      </button>
      {open ? (
        <span role="tooltip" id={tipId} className="w-tip">
          <span className="w-tip-meaning">
            <MdText md={primary} />
          </span>
          {row && (row.kind || hasTypical(row)) ? (
            <span className="w-tip-meta">
              {meaning && meaning !== row.meaning ? (
                <>
                  <MdText md={row.meaning} />
                  {" · "}
                </>
              ) : null}
              {row.kind ? <MdText md={row.kind} /> : null}
              {hasTypical(row) ? (
                <>
                  {row.kind ? " · " : null}typical <MdText md={row.typical} />
                </>
              ) : null}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

const hasTypical = (row: NotationRow) => !!row.typical && row.typical !== "—" && row.typical !== "-";
