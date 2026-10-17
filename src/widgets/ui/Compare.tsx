// "Compare with the lecture figure": any widget whose spec sets `compare_figure` gets a toggle that puts the original
// lecture image beside the live widget (above it on a compact layout or a narrow container). The figure path is an
// export asset path, relative to the content root.
import "./compare.css";
import { createContext, type ReactNode, useState } from "react";
import type { WidgetEntry } from "../../ir";
import { FigureIcon } from "./icons";

/** The toggle button, for the widget's own header to place (WidgetFrame renders it): up there it takes no row of its
 *  own, and it inherits the widget's type instead of the page's. */
export const CompareToggleSlot = createContext<ReactNode>(null);

type Props = { entry: WidgetEntry; contentBase: string; compact?: boolean; children: ReactNode };

export function CompareFrame({ entry, contentBase, compact, children }: Props) {
  const figure = entry.spec.compare_figure;
  const [on, setOn] = useState(false);
  const [broken, setBroken] = useState(false);
  if (!figure) return <>{children}</>;
  const title = entry.spec.title ?? entry.name;
  const toggle = (
    <button type="button" className="w-btn w-btn-sm" aria-label="Compare with the lecture figure" aria-pressed={on} onClick={() => setOn((v) => !v)}>
      <FigureIcon />
      <span className="w-btn-long">Compare with the lecture figure</span>
      <span className="w-btn-short" aria-hidden="true">
        Lecture figure
      </span>
    </button>
  );
  return (
    <div className={`w-compare${compact ? " w-compare-compact" : ""}`} data-compare={on ? "on" : "off"}>
      <div className="w-compare-body">
        {on ? (
          <figure className="w-compare-figure">
            {broken ? (
              <p className="w-compare-missing">The lecture figure could not be loaded.</p>
            ) : (
              <img src={`${contentBase}${figure}`} alt={`The lecture figure that ${title} reproduces`} onError={() => setBroken(true)} />
            )}
            <figcaption>Lecture figure</figcaption>
          </figure>
        ) : null}
        <div className="w-compare-widget">
          <CompareToggleSlot.Provider value={toggle}>{children}</CompareToggleSlot.Provider>
        </div>
      </div>
    </div>
  );
}
