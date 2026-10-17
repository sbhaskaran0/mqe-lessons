// Tweening for view transitions (presets, axis rescales, OLS reveal). Every animation honours
// prefers-reduced-motion by jumping straight to its end state.

export const PRESET_MS = 300;

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** Calls onFrame(eased progress) every animation frame for `ms`, ending at exactly 1. Returns a cancel function. */
export function tween(ms: number, onFrame: (k: number) => void, ease: (t: number) => number = easeOutCubic): () => void {
  if (ms <= 0 || prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
    onFrame(1);
    return () => {};
  }
  let raf = 0;
  let start: number | null = null;
  const step = (now: number) => {
    start ??= now;
    const t = Math.min(1, (now - start) / ms);
    onFrame(ease(t));
    if (t < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
