import { describe, expect, it } from "vitest";
import { href, parseHash, type Route } from "../../src/app/router";

describe("parseHash", () => {
  it.each<[string, Route]>([
    ["", { name: "home" }],
    ["#", { name: "home" }],
    ["#/", { name: "home" }],
    ["#/course/econ-424", { name: "course", id: "econ-424" }],
    ["#/lesson/econ-402a-l1-solow-growth-model", { name: "lesson", slug: "econ-402a-l1-solow-growth-model" }],
    ["#/note/solow-diagram", { name: "note", slug: "solow-diagram" }],
    ["#/note/solow-diagram?at=definition", { name: "note", slug: "solow-diagram", at: "definition" }],
    ["#/library", { name: "library", query: {} }],
    ["#/library?q=solow%20model&type=concept&domain=macroeconomics", { name: "library", query: { q: "solow model", type: "concept", domain: "macroeconomics" } }],
    ["#/library?tag=matrix&course=Econ%20430&junk=1", { name: "library", query: { tag: "matrix", course: "Econ 430" } }],
    ["#/note", { name: "not-found", path: "/note" }],
    ["#/note/a/b", { name: "not-found", path: "/note/a/b" }],
    ["#/map", { name: "map", query: {} }],
    ["#/map?course=Econ%20402A&node=solow-growth-model&junk=1", { name: "map", query: { course: "Econ 402A", node: "solow-growth-model" } }],
    ["#/map/x", { name: "not-found", path: "/map/x" }],
    ["#/progress", { name: "progress" }],
    ["#/review", { name: "review" }],
    ["#/review/x", { name: "not-found", path: "/review/x" }],
    ["#/exam", { name: "exam" }],
    ["#/exam?id=exam-1k", { name: "exam", id: "exam-1k" }],
    ["#/exam/x", { name: "not-found", path: "/exam/x" }],
    ["#/dev/widgets", { name: "dev-widgets" }],
    ["#/dev/other", { name: "not-found", path: "/dev/other" }],
  ])("%s", (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
  });

  it("survives malformed escapes", () => {
    expect(parseHash("#/note/%E0%A4%A")).toEqual({ name: "note", slug: "%E0%A4%A" });
  });
});

describe("href", () => {
  const routes: Route[] = [
    { name: "home" },
    { name: "course", id: "math-prep" },
    { name: "lesson", slug: "econ-424-l2-between-group-inequality", at: "3-the-canonical-model" },
    { name: "note", slug: "katz-and-murphy-1992-changes-in-relative-wages" },
    { name: "library", query: { q: "golden rule", type: "all" } },
    { name: "library", query: {} },
    { name: "progress" },
    { name: "review" },
    { name: "exam" },
    { name: "exam", id: "exam-1k" },
    { name: "dev-widgets" },
  ];

  it.each(routes)("round-trips %j", (route) => {
    expect(parseHash(href(route))).toEqual(route);
  });

  it("writes canonical hashes", () => {
    expect(href({ name: "home" })).toBe("#/");
    expect(href({ name: "review" })).toBe("#/review");
    expect(href({ name: "exam" })).toBe("#/exam");
    expect(href({ name: "exam", id: "exam-1k" })).toBe("#/exam?id=exam-1k");
    expect(href({ name: "library", query: { course: "Econ 430" } })).toBe("#/library?course=Econ+430");
    expect(href({ name: "note", slug: "a", at: "x y" })).toBe("#/note/a?at=x%20y");
  });
});
