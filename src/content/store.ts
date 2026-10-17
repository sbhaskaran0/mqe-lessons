// Fetches the export: index.json once, each note's body on first use (cached as a promise, so React's use()
// and repeat visits share one request). Paths are relative to the page, which is how `base: "./"` and the
// content-as-publicDir layout let dist/ be served from any folder. Schemas are checked in dev only: the
// production build trusts what `npm run build` already validated.
import type { Index, NoteBody } from "../ir";

export const CONTENT_BASE: string = new URL(import.meta.env.BASE_URL || "./", document.baseURI).href.replace(/[?#].*$/, "");

export const assetUrl = (src: string): string => new URL(src, CONTENT_BASE).href;

export class ContentError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ContentError";
  }
}

async function fetchJson(path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(new URL(path, CONTENT_BASE), import.meta.env.DEV ? { cache: "no-cache" } : {});
  } catch {
    throw new ContentError(`Could not load ${path}. Is the lesson server still running?`);
  }
  if (!response.ok) throw new ContentError(`Could not load ${path} (HTTP ${response.status}).`, response.status);
  return response.json();
}

async function devValidate<T>(what: string, json: unknown, schema: "Index" | "NoteBody"): Promise<T> {
  if (import.meta.env.DEV) {
    const ir = await import("../ir");
    const result = ir[schema].safeParse(json);
    if (!result.success) {
      const issues = result.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`);
      throw new ContentError(`${what} does not match src/ir.ts:\n${issues.join("\n")}`);
    }
  }
  return json as T;
}

let indexPromise: Promise<Index> | undefined;

export function loadIndex(): Promise<Index> {
  indexPromise ??= fetchJson("index.json").then((json) => devValidate<Index>("index.json", json, "Index"));
  return indexPromise;
}

const notes = new Map<string, Promise<NoteBody>>();

export function loadNote(slug: string): Promise<NoteBody> {
  let p = notes.get(slug);
  if (!p) {
    p = fetchJson(`notes/${slug}.json`).then((json) => devValidate<NoteBody>(`notes/${slug}.json`, json, "NoteBody"));
    // A failed load should be retryable on the next visit, not cached forever.
    p.catch(() => notes.delete(slug));
    notes.set(slug, p);
  }
  return p;
}
