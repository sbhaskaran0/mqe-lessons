// A hash router small enough to read in one go. Hash routes work from static files (file://, `vite preview`,
// any dumb server) because the server only ever sees index.html.
//
//   #/                    home
//   #/course/<id>         a course's lecture path
//   #/lesson/<slug>       a lecture in lesson mode          ?at=<section or step id>
//   #/note/<slug>         any other note as a micro-lesson  ?at=<section or step id>
//   #/library             ?q=<search>&type=&domain=&tag=&course=&has=&status=&sort=   (type, domain, tag, course, has and status take comma-separated lists)
//   #/map                 the prerequisite map          ?course=<code>&domain=&node=<slug>&extra=1&color=course
//   #/practice/<slug>     a practice set, question by question   ?at=<question id>&show=review
//   #/progress            the progress dashboard and review queue
//   #/review              spaced review: the missed items that are due today, shown unanswered
//   #/exam                a mixed exam: set it up, sit it, or (?id=<exam id>) read the results of one
//   #/dev/widgets         every widget in the export, with the views that place it (a developer page)
import { useSyncExternalStore } from "react";

export type LibraryQuery = { q?: string; type?: string; domain?: string; tag?: string; course?: string; has?: string; status?: string; sort?: string };
export type MapQuery = { course?: string; domain?: string; node?: string; extra?: string; color?: string };
/** Which questions a practice set lists: all of them, the ones marked "Not yet", or the ones not yet tried. */
export type PracticeShow = "review" | "new";

export type Route =
  | { name: "home" }
  | { name: "course"; id: string }
  | { name: "lesson"; slug: string; at?: string }
  | { name: "note"; slug: string; at?: string }
  | { name: "library"; query: LibraryQuery }
  | { name: "map"; query: MapQuery }
  | { name: "practice"; slug: string; at?: string; show?: PracticeShow }
  | { name: "progress" }
  | { name: "review" }
  | { name: "exam"; id?: string }
  | { name: "dev-widgets" }
  | { name: "not-found"; path: string };

const LIBRARY_KEYS = ["q", "type", "domain", "tag", "course", "has", "status", "sort"] as const;
const MAP_KEYS = ["course", "domain", "node", "extra", "color"] as const;

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, "");
  const [pathPart = "", queryPart = ""] = splitOnce(raw, "?");
  const params = new URLSearchParams(queryPart);
  const parts = pathPart.split("/").filter(Boolean).map(safeDecode);
  const [head, arg, ...rest] = parts;
  const at = params.get("at") ?? undefined;
  if (parts.length === 0) return { name: "home" };
  if (head === "library" && arg === undefined) {
    const query: LibraryQuery = {};
    for (const k of LIBRARY_KEYS) {
      const v = params.get(k);
      if (v) query[k] = v;
    }
    return { name: "library", query };
  }
  if (head === "map" && arg === undefined) {
    const query: MapQuery = {};
    for (const k of MAP_KEYS) {
      const v = params.get(k);
      if (v) query[k] = v;
    }
    return { name: "map", query };
  }
  if (head === "progress" && arg === undefined) return { name: "progress" };
  if (head === "review" && arg === undefined) return { name: "review" };
  if (head === "exam" && arg === undefined) {
    const id = params.get("id");
    return id ? { name: "exam", id } : { name: "exam" };
  }
  if (arg !== undefined && rest.length === 0) {
    if (head === "practice") {
      const show = params.get("show");
      return {
        name: "practice",
        slug: arg,
        ...(at ? { at } : {}),
        ...(show === "review" || show === "new" ? { show } : {}),
      };
    }
    if (head === "dev" && arg === "widgets") return { name: "dev-widgets" };
    if (head === "course") return { name: "course", id: arg };
    if (head === "lesson") return at ? { name: "lesson", slug: arg, at } : { name: "lesson", slug: arg };
    if (head === "note") return at ? { name: "note", slug: arg, at } : { name: "note", slug: arg };
  }
  return { name: "not-found", path: pathPart || "/" };
}

export function href(route: Route): string {
  switch (route.name) {
    case "home":
      return "#/";
    case "course":
      return `#/course/${encodeURIComponent(route.id)}`;
    case "lesson":
    case "note":
      return `#/${route.name}/${encodeURIComponent(route.slug)}${route.at ? `?at=${encodeURIComponent(route.at)}` : ""}`;
    case "library": {
      const params = new URLSearchParams();
      for (const k of LIBRARY_KEYS) if (route.query[k]) params.set(k, route.query[k]!);
      const qs = params.toString();
      return `#/library${qs ? `?${qs}` : ""}`;
    }
    case "map": {
      const params = new URLSearchParams();
      for (const k of MAP_KEYS) if (route.query[k]) params.set(k, route.query[k]!);
      const qs = params.toString();
      return `#/map${qs ? `?${qs}` : ""}`;
    }
    case "practice": {
      const params = new URLSearchParams();
      if (route.at) params.set("at", route.at);
      if (route.show) params.set("show", route.show);
      const qs = params.toString();
      return `#/practice/${encodeURIComponent(route.slug)}${qs ? `?${qs}` : ""}`;
    }
    case "progress":
      return "#/progress";
    case "review":
      return "#/review";
    case "exam":
      return route.id ? `#/exam?id=${encodeURIComponent(route.id)}` : "#/exam";
    case "dev-widgets":
      return "#/dev/widgets";
    case "not-found":
      return `#${route.path}`;
  }
}

export function navigate(to: string | Route, { replace = false } = {}): void {
  const target = typeof to === "string" ? to : href(to);
  if (replace) {
    const url = new URL(window.location.href);
    url.hash = target;
    window.history.replaceState(window.history.state, "", url);
    // replaceState does not fire hashchange; tell the subscribers ourselves.
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = target;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const getHash = () => window.location.hash;

/** The path of a hash, without its query: "#/lesson/x?at=y" is "/lesson/x". Query-only changes keep the path. */
export function hashPath(hash: string): string {
  return hash.replace(/^#/, "").split("?")[0] || "/";
}

/** The current hash; components parse it with parseHash (memoized by the string, which is stable). */
export function useHash(): string {
  return useSyncExternalStore(subscribe, getHash, () => "");
}

function splitOnce(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
