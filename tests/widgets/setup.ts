// Shared setup for widget tests (import it first, in files that run under happy-dom).
// happy-dom never lays anything out: ResizeObserver here reports a fixed 600px width so plots render, and
// matchMedia answers prefers-reduced-motion so presets apply at once unless a test asks for animation, and the
// document reports standards mode for KaTeX.
import { cleanup, configure } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach } from "vitest";
import type { Index, NoteBody, WidgetEntry } from "../../src/ir";
import { exportFixture } from "../helpers";

export const WIDTH = 600;

// The first render of each widget type loads its chunk (Mafs, KaTeX, mathjs); with test files running side by side
// that can take well over testing-library's default second.
configure({ asyncUtilTimeout: 10_000 });

class FixedResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(target: Element) {
    const rect = { width: WIDTH, height: 300, x: 0, y: 0, top: 0, left: 0, right: WIDTH, bottom: 300, toJSON: () => ({}) };
    const size = [{ inlineSize: WIDTH, blockSize: 300 }];
    this.cb([{ target, contentRect: rect, contentBoxSize: size, borderBoxSize: size, devicePixelContentBoxSize: size } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = FixedResizeObserver as unknown as typeof ResizeObserver;
window.ResizeObserver = globalThis.ResizeObserver;

// KaTeX warns unless the document is in standards mode, which happy-dom doesn't report.
if (document.compatMode !== "CSS1Compat") Object.defineProperty(document, "compatMode", { value: "CSS1Compat", configurable: true });

let reducedMotion = true;
/** Whether the page prefers reduced motion (default true: presets and reveals jump straight to their end). */
export function setReducedMotion(on: boolean) {
  reducedMotion = on;
}
window.matchMedia = ((query: string) => ({
  matches: query.includes("prefers-reduced-motion") ? reducedMotion : false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

afterEach(() => {
  cleanup();
  reducedMotion = true;
});

let cached: { index: Index; notes: Record<string, NoteBody>; dir: string } | null = null;

/** The fixture vault exported exactly as the player receives it. */
export function fixture() {
  if (!cached) {
    const out = exportFixture();
    const index = JSON.parse(readFileSync(path.join(out, "index.json"), "utf8")) as Index;
    const notes: Record<string, NoteBody> = {};
    for (const slug of Object.keys(index.notes)) notes[slug] = JSON.parse(readFileSync(path.join(out, "notes", `${slug}.json`), "utf8")) as NoteBody;
    cached = { index, notes, dir: out };
  }
  return cached;
}

/** The directory the fixture was exported to (dataset files sit under assets/data/). */
export function fixtureDir(): string {
  fixture();
  return cached!.dir;
}

export function widget(slug: string): WidgetEntry {
  const w = fixture().index.widgets[slug];
  if (!w) throw new Error(`fixture has no widget ${slug}`);
  return w;
}

/** The ```interactive blocks in the fixture lecture, in order. */
export function lectureViews() {
  const body = fixture().notes["toy-101-l1-growth"]!;
  return body.sections.flatMap((s) => s.steps.flatMap((st) => st.blocks)).filter((b) => b.t === "interactive");
}
