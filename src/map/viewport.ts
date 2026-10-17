// Pan and zoom arithmetic for the map. A transform maps world to screen as `screen = world * k + (x, y)`.
export type Transform = { x: number; y: number; k: number };
export type Size = { w: number; h: number };
/** Screen pixels the map's overlays cover, which "visible" must not count. */
export type Insets = { right: number };

export const MIN_K = 0.08;
export const MAX_K = 3;
const PAD = 24;

export const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

/** Scale and position that show the whole `world` box in `view`, never magnified past 1:1. */
export function fit(world: Size, view: Size): Transform {
  if (world.w <= 0 || world.h <= 0 || view.w <= 0 || view.h <= 0) return { x: 0, y: 0, k: 1 };
  const k = clampK(Math.min((view.w - 2 * PAD) / world.w, (view.h - 2 * PAD) / world.h, 1));
  return { k, x: (view.w - world.w * k) / 2, y: (view.h - world.h * k) / 2 };
}

/** Zoom to `k`, keeping the world point under screen position (cx, cy) fixed. */
export function zoomAt(t: Transform, cx: number, cy: number, k: number): Transform {
  const next = clampK(k);
  const ratio = next / t.k;
  return { k: next, x: cx - (cx - t.x) * ratio, y: cy - (cy - t.y) * ratio };
}

/** Put the world point (wx, wy) at the middle of the visible area. */
export function centerOn(t: Transform, wx: number, wy: number, view: Size, insets: Insets = { right: 0 }): Transform {
  return { k: t.k, x: (view.w - insets.right) / 2 - wx * t.k, y: view.h / 2 - wy * t.k };
}

/** Pan the least that brings the world box (top-left x, y; size w, h) inside the visible area, or the same
 *  transform when it already is. */
export function reveal(t: Transform, box: { x: number; y: number; w: number; h: number }, view: Size, insets: Insets = { right: 0 }): Transform {
  const margin = 32;
  const left = box.x * t.k + t.x;
  const right = (box.x + box.w) * t.k + t.x;
  const top = box.y * t.k + t.y;
  const bottom = (box.y + box.h) * t.k + t.y;
  const maxRight = view.w - insets.right - margin;
  let dx = 0;
  let dy = 0;
  if (left < margin) dx = margin - left;
  else if (right > maxRight) dx = maxRight - right;
  if (top < margin) dy = margin - top;
  else if (bottom > view.h - margin) dy = view.h - margin - bottom;
  return dx === 0 && dy === 0 ? t : { k: t.k, x: t.x + dx, y: t.y + dy };
}
