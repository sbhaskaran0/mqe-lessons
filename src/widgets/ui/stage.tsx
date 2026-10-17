// How tall the plots may be. In the lesson pane the widget measures the room it has (the pane's height less
// everything in the widget that is not a plot) and gives the plots the rest, so the plot, the readouts, the free
// sliders and the feedback fit one screen. Anywhere else (inline in a step, the dev gallery) the page scrolls, and plots keep the
// heights their widgets ask for.
import { createContext, type RefObject, useContext, useLayoutEffect, useRef, useState } from "react";

/** The shortest a plot shrinks to before the pane scrolls instead, and the tallest it grows to. */
export const MIN_PLOT = 150;
export const MAX_PLOT = 400;
/** Stacked plots share one time axis: only the bottom one carries tick labels and a title, which costs this much height. */
export const AXIS_ROOM = 34;
/** The shortest plot area a stacked plot keeps (its axis room comes on top). */
const MIN_STACKED = 100;

/** Pixels all the widget's plots together may use, or null when nothing measured it (plots then use their own sizes). */
export const StageContext = createContext<number | null>(null);

type Share = {
  /** How many plots the widget stacks. */
  parts?: number;
  /** How many of them carry their own x axis (the others save its height). */
  axes?: number;
  /** Whether this one does. */
  axis?: boolean;
};

/** A plot's height: the plots' budget shared among the stacked plots (the ones with an axis get its room on top of an
 *  equal plot area), or `fallback` when there is no budget. */
export function useStageHeight(fallback: number, { parts = 1, axes = parts, axis = true }: Share = {}): number {
  const budget = useContext(StageContext);
  if (budget === null) return fallback;
  if (parts === 1) return Math.round(Math.min(MAX_PLOT, Math.max(MIN_PLOT, budget)));
  const area = (budget - AXIS_ROOM * axes) / parts;
  return Math.round(Math.min(MAX_PLOT, Math.max(MIN_STACKED, area)) + (axis ? AXIS_ROOM : 0));
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll") return p;
  }
  return null;
}

/** Distance from the top of `scroller`'s scrollable content to the top of `el`. Layout offsets rather than bounding
 *  boxes where the scroller is the offset parent, because the pane animates its content in with a transform. */
function offsetIn(el: HTMLElement, scroller: HTMLElement): number {
  let top = 0;
  let e: HTMLElement | null = el;
  for (; e && e !== scroller; e = e.offsetParent as HTMLElement | null) top += e.offsetTop;
  if (e === scroller) return top;
  return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - scroller.clientTop;
}

/** The plots' budget for a widget that fills a scrolling pane (not `compact`), re-measured as the pane or the widget
 *  resizes. What surrounds the plots only ever grows within a `key` (a view): a prediction panel that shrinks once
 *  answered, or a feedback line that appears, must not make the plot jump. */
export function useStageBudget(root: RefObject<HTMLElement | null>, stage: RefObject<HTMLElement | null>, key: string, enabled: boolean): number | null {
  const [budget, setBudget] = useState<number | null>(null);
  const around = useRef(0);
  useLayoutEffect(() => {
    const el = root.current;
    const scroller = enabled && el && typeof ResizeObserver === "function" ? scrollParent(el) : null;
    if (!el || !scroller) {
      setBudget(null);
      return;
    }
    around.current = 0;
    let width = el.offsetWidth;
    const measure = () => {
      const st = stage.current;
      if (!st) return;
      if (el.offsetWidth !== width) {
        width = el.offsetWidth;
        around.current = 0;
      }
      const plots = [...st.querySelectorAll<HTMLElement>(".w-plot")].reduce((sum, p) => sum + p.offsetHeight, 0);
      around.current = Math.max(around.current, el.offsetHeight - plots);
      const bottomPad = parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
      const room = scroller.clientHeight - bottomPad - offsetIn(el, scroller) - around.current;
      // Ignore a pixel of drift so the observer cannot ping-pong between two heights.
      setBudget((prev) => (prev !== null && Math.abs(prev - room) < 2 ? prev : Math.floor(room)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(scroller);
    measure();
    return () => ro.disconnect();
  }, [root, stage, key, enabled]);
  return budget;
}
