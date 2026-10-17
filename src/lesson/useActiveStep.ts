// Which step the reader is on: the first step crossing a band a third of the way down the scroller. When the
// scroller is at its very end, the last step wins even if it is too short to reach the band.
import { useEffect, useState, type RefObject } from "react";

const BAND = "-30% 0px -60% 0px";

export function useActiveStep(
  container: RefObject<HTMLElement | null>,
  /** The scrolling element; null means the window. */
  scroller: RefObject<HTMLElement | null> | null,
  /** Changes whenever the set of rendered steps changes, so the observer re-binds. */
  version: unknown,
  initial: string | undefined,
): string | undefined {
  const [active, setActive] = useState(initial);

  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const scrollEl = scroller?.current ?? null;
    const steps = [...root.querySelectorAll<HTMLElement>("[data-step-id]")];
    if (steps.length === 0) return;
    const crossing = new Set<Element>();

    const atEnd = () => {
      if (scrollEl) return scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 4;
      const doc = document.documentElement;
      return window.scrollY > 0 && window.scrollY + window.innerHeight >= doc.scrollHeight - 4;
    };
    const pick = () => {
      if (atEnd()) {
        setActive(steps[steps.length - 1]!.dataset.stepId);
        return;
      }
      const first = steps.find((el) => crossing.has(el));
      if (first) setActive(first.dataset.stepId);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) crossing.add(e.target);
          else crossing.delete(e.target);
        }
        pick();
      },
      { root: scrollEl, rootMargin: BAND, threshold: 0 },
    );
    steps.forEach((el) => io.observe(el));
    const target: HTMLElement | Window = scrollEl ?? window;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (atEnd()) pick();
      });
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      target.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [container, scroller, version]);

  return active;
}
