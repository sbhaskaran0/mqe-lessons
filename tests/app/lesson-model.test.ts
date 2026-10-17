import { describe, expect, it } from "vitest";
import { buildModel, courseLabel, footerGroups, noteRoute } from "../../src/content/model";
import type { Index, NoteBody, NoteMeta } from "../../src/ir";
import { findAnchor, flattenSteps, gateOpen, placements, stepGates, stepVisual } from "../../src/lesson/steps";
import { emptyProgress } from "../../src/progress/store";

const body: NoteBody = {
  slug: "toy",
  notation: [],
  sections: [
    { id: "intro", heading: "", role: "other", steps: [{ id: "intro-1", blocks: [{ t: "prose", md: "Hi" }], words: 1, symbols: [] }] },
    {
      id: "2-the-steady-state",
      heading: "2. The steady state",
      role: "depth",
      steps: [
        {
          id: "s-1",
          blocks: [
            { t: "figure", src: "assets/a.png", alt: "a" },
            { t: "prose", md: "x" },
            { t: "interactive", widget: "w", goal: { when: "s > 1", success: "Yes" } },
          ],
          words: 1,
          symbols: [],
        },
        {
          id: "s-2",
          heading: "A rise in saving",
          blocks: [{ t: "check", kind: "numeric", prompt: "k?", answer: 25, tol: 0.1, why: "Because." }],
          words: 1,
          symbols: [],
        },
      ],
    },
  ],
};

describe("lesson steps", () => {
  const steps = flattenSteps(body);

  it("flattens sections into one ordered sequence", () => {
    expect(steps.map((s) => [s.step.id, s.index, s.firstInSection])).toEqual([
      ["intro-1", 0, true],
      ["s-1", 1, true],
      ["s-2", 2, false],
    ]);
  });

  it("picks the last figure or interactive as the step's visual", () => {
    expect(stepVisual(steps[1]!.step)).toMatchObject({ at: 2, block: { t: "interactive", widget: "w" } });
    expect(stepVisual(steps[0]!.step)).toBeUndefined();
  });

  it("gates on checks and goals, opened by any recorded result", () => {
    expect(stepGates("toy", steps[1]!.step)).toEqual([{ key: "toy#s-1#2", kind: "goal" }]);
    const [gate] = stepGates("toy", steps[2]!.step);
    expect(gate).toEqual({ key: "toy#s-2#0", kind: "check" });
    const data = emptyProgress();
    expect(gateOpen(data, gate!)).toBe(false);
    data.checks["toy#s-2#0"] = { result: "skipped", tries: 0, at: 1 };
    expect(gateOpen(data, gate!)).toBe(true);
  });

  it("finds anchors by step id, section id, heading text or H3", () => {
    expect(findAnchor(steps, "s-2")?.step.id).toBe("s-2");
    expect(findAnchor(steps, "2-the-steady-state")?.step.id).toBe("s-1");
    expect(findAnchor(steps, "2. The steady state")?.step.id).toBe("s-1");
    expect(findAnchor(steps, "A rise in saving")?.step.id).toBe("s-2");
    expect(findAnchor(steps, "nowhere")).toBeUndefined();
  });
});

const meta = (slug: string, type: NoteMeta["type"], extra: Partial<NoteMeta> = {}): NoteMeta => ({
  slug,
  name: slug,
  title: slug,
  type,
  path: `${slug}.md`,
  summary: "",
  tags: [],
  aliases: [],
  requires: [],
  lessons: [],
  courses: [],
  edges: { out: [], in: [] },
  figures: [],
  interactives: [],
  checks: 0,
  words: 0,
  created: "2026-10-01T00:00:00Z",
  updated: "2026-10-01T00:00:00Z",
  ...extra,
});

const index = {
  courses: [{ code: "Toy 101", id: "toy-101", hub: "toy-101", lectures: ["l1"], practice: [], guides: [] }],
  notes: {
    "toy-101": meta("toy-101", "course"),
    l1: meta("l1", "lecture", { course: "Toy 101", lecture: 1 }),
    c: meta("c", "concept", {
      requires: ["b"],
      lessons: ["l1"],
      interactives: ["w"],
      edges: {
        out: [{ kind: "requires", note: "b" }, { kind: "related", note: "d" }, { kind: "related", note: "p" }],
        in: [{ kind: "covers", note: "l1" }, { kind: "cites", note: "p" }, { kind: "illustrates", note: "w" }, { kind: "related", note: "toy-101" }],
      },
    }),
    b: meta("b", "concept"),
    d: meta("d", "fact"),
    p: meta("p", "paper"),
    w: meta("w", "interactive"),
  },
} as unknown as Index;

describe("placements", () => {
  it("lists the steps that place a widget, one entry per heading", () => {
    const placed: NoteBody = {
      slug: "lecture",
      notation: [],
      sections: [
        { id: "a", heading: "", role: "other", steps: [{ id: "a-1", blocks: [{ t: "interactive", widget: "w" }], words: 0, symbols: [] }] },
        {
          id: "b",
          heading: "5. Investment vs depreciation",
          role: "depth",
          steps: [
            { id: "b-1", blocks: [{ t: "interactive", widget: "w", prompt: "first" }], words: 0, symbols: [] },
            { id: "b-2", blocks: [{ t: "interactive", widget: "w", prompt: "second" }], words: 0, symbols: [] },
            { id: "b-3", heading: "Shocks", blocks: [{ t: "interactive", widget: "w" }], words: 0, symbols: [] },
            { id: "b-4", blocks: [{ t: "interactive", widget: "other" }], words: 0, symbols: [] },
          ],
        },
      ],
    };
    expect(placements(placed, "w")).toEqual([
      { step: "a-1", label: "Overview" },
      { step: "b-1", label: "5. Investment vs depreciation" },
      { step: "b-3", label: "5. Investment vs depreciation · Shocks" },
    ]);
    expect(placements(placed, "missing")).toEqual([]);
  });
});

describe("content model", () => {
  const model = buildModel(index);

  it("routes lectures to lessons, hubs to their course, the rest to notes", () => {
    expect(noteRoute(model, "l1")).toEqual({ name: "lesson", slug: "l1" });
    expect(noteRoute(model, "toy-101")).toEqual({ name: "course", id: "toy-101" });
    expect(noteRoute(model, "c", "definition")).toEqual({ name: "note", slug: "c", at: "definition" });
  });

  it("shows the course code alone while the title is a placeholder", () => {
    expect(courseLabel(index.courses[0]!)).toBe("Toy 101");
    expect(courseLabel({ ...index.courses[0]!, title: "Toys" })).toBe("Toy 101 · Toys");
  });

  it("groups the footer once per note, most specific group first", () => {
    const g = footerGroups(model, model.note("c")!);
    const slugs = (ms: NoteMeta[]) => ms.map((m) => m.slug);
    expect(slugs(g.buildsOn)).toEqual(["b"]);
    expect(slugs(g.usedIn)).toEqual(["l1"]);
    expect(slugs(g.papers)).toEqual(["p"]);
    expect(slugs(g.interactives)).toEqual(["w"]);
    expect(slugs(g.related)).toEqual(["d"]);
  });
});
