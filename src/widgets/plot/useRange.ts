// Axis ranges that follow the content without fighting the learner: within one view a range only grows (so a
// curve rising under the learner's finger is seen to rise, not re-normalized away), it may shrink again when the
// next view arrives, and every change animates.
import { useEffect, useRef, useState } from "react";
import { lerp, tween } from "../core/motion";
import type { Range } from "./ticks";

/** Grow-only union of `target` while `key` stays the same; starts over at `target` when it changes. */
export function useStickyRange(target: Range, key: string): Range {
  const ref = useRef<{ key: string; range: Range } | null>(null);
  const cur = ref.current;
  let next: Range;
  if (!cur || cur.key !== key) next = target;
  else next = [Math.min(cur.range[0], target[0]), Math.max(cur.range[1], target[1])];
  if (!cur || cur.key !== key || cur.range[0] !== next[0] || cur.range[1] !== next[1]) ref.current = { key, range: next };
  return ref.current!.range;
}

/** `target`, eased over `ms` whenever it changes. */
export function useAnimatedRange(target: Range, ms = 280): Range {
  const [shown, setShown] = useState<Range>(target);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const [t0, t1] = target;
  useEffect(() => {
    const from = shownRef.current;
    if (from[0] === t0 && from[1] === t1) return;
    return tween(ms, (k) => setShown(k >= 1 ? [t0, t1] : [lerp(from[0], t0, k), lerp(from[1], t1, k)]));
  }, [t0, t1, ms]);
  return shown;
}
