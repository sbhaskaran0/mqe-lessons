// The review queue's two item kinds that read more than checks: derivations skipped or given up, and live interactives
// that sit at or before the furthest step a learner reached without ever running.
import { describe, expect, it } from "vitest";
import { buildModel } from "../../src/content/model";
import type { Index, NoteBody, NoteMeta, WidgetEntry } from "../../src/ir";
import { buildDashboard, newInteractives, plannedSeenKey, type ReviewItem } from "../../src/progress/dashboard";
import { stepGates } from "../../src/lesson/steps";
import { blockKey, createProgressStore, emptyProgress, type ProgressData } from "../../src/progress/store";

const meta = (slug: string, type: NoteMeta["type"], extra: Partial<NoteMeta> = {}): NoteMeta => ({
  slug, name: slug, title: slug, type, path: `${slug}.md`, summary: "", tags: [], aliases: [], requires: [], lessons: [], courses: [],
  edges: { out: [], in: [] }, figures: [], interactives: [], checks: 0, words: 0, created: "2026-10-01T00:00:00Z", updated: "2026-10-01T00:00:00Z", ...extra,
});
const widgetEntry = { slug: "w-live", name: "Live", type: "panels", spec: { type: "panels" }, illustrates: [], notation: [] } as unknown as WidgetEntry;
const index = {
  courses: [{ code: "Toy 101", id: "toy-101", hub: "toy-101", lectures: ["l1"], practice: [], guides: [] }],
  notes: { "toy-101": meta("toy-101", "course"), l1: meta("l1", "lecture", { course: "Toy 101", lecture: 1, interactives: ["w-live"] }) },
  widgets: { "w-live": widgetEntry },
  datasets: {},
} as unknown as Index;
const model = buildModel(index);

type Blocks = NoteBody["sections"][number]["steps"][number]["blocks"];
const step = (id: string, blocks: Blocks) => ({ id, blocks });
const IDS = ["a-1", "b-1", "c-1", "d-1", "e-1"];
const body = {
  slug: "l1",
  notation: [],
  sections: [
    {
      id: "s",
      heading: "",
      steps: [
        step("a-1", [{ t: "prose", md: "intro" }]),
        step("b-1", [{ t: "interactive", widget: "w-live" }]),
        step("c-1", [{ t: "interactive", widget: "w-live", status: "planned", figure: "x.png" }]),
        step("d-1", [{ t: "prose", md: "x" }, { t: "interactive", widget: "w-live", prompt: "Try it" }]),
        step("e-1", [{ t: "interactive", widget: "w-live" }]),
      ],
    },
  ],
} as unknown as NoteBody;

/** Placeholders the learner saw (and so can later find activated) at these steps; every block 0 unless noted. */
const sawPlaceholders = (d: ProgressData, keys: string[] = [blockKey("l1", "b-1", 0), blockKey("l1", "d-1", 1), blockKey("l1", "e-1", 0)]) => {
  d.widgetsSeen.l1 = keys.map(plannedSeenKey);
  return d;
};
const read = (furthest: number, placeholders = true): ProgressData => {
  const d = emptyProgress();
  if (placeholders) sawPlaceholders(d);
  d.notes.l1 = { total: IDS.length, seen: furthest + 1, furthest, at: 50 };
  return d;
};
const lecture = model.note("l1")!;
/** The step-located kinds (everything but practice). */
const located = (items: ReviewItem[]) => items as Extract<ReviewItem, { stepId: string }>[];

describe("new interactive in a lecture you have read", () => {
  it("lists live interactives at or before the furthest step that were never drawn, with a link to the step", () => {
    const items = located(newInteractives(model, read(3), lecture, body));
    expect(items.map((i) => i.key)).toEqual([blockKey("l1", "b-1", 0), blockKey("l1", "d-1", 1)]);
    expect(items[0]).toMatchObject({ kind: "interactive", result: "new", stepId: "b-1", block: 0, at: 50 });
    expect(items[0]!.href).toContain("b-1");
    expect(items[0]!.href).toContain("l1");
  });

  it("a previously-read lecture whose placeholders were never recorded lists nothing, so existing learners are not flooded", () => {
    expect(newInteractives(model, read(4, false), lecture, body)).toEqual([]);
    expect(buildDashboard(model, read(4, false), { bodies: new Map([["l1", body]]) }).review).toEqual([]);
  });

  it("skips planned placements, steps past the furthest one, and widgets missing from the export", () => {
    expect(newInteractives(model, read(0), lecture, body)).toEqual([]);
    expect(located(newInteractives(model, read(2), lecture, body)).map((i) => i.stepId)).toEqual(["b-1"]);
    const gone = { ...body, sections: [{ ...body.sections[0]!, steps: [step("z", [{ t: "interactive", widget: "nope" }])] }] } as unknown as NoteBody;
    expect(newInteractives(model, read(0), lecture, gone)).toEqual([]);
  });

  it("drops an item once its widget has been marked seen, and ignores lectures never opened", () => {
    const store = createProgressStore({ getItem: () => null, setItem() {}, removeItem() {} });
    store.reveal("l1", IDS, 4);
    store.markWidgetsSeen("l1", [blockKey("l1", "b-1", 0), ...[blockKey("l1", "b-1", 0), blockKey("l1", "d-1", 1), blockKey("l1", "e-1", 0)].map(plannedSeenKey)]);
    expect(located(newInteractives(model, store.get(), lecture, body)).map((i) => i.stepId)).toEqual(["d-1", "e-1"]);
    expect(newInteractives(model, emptyProgress(), lecture, body)).toEqual([]);
  });

  it("joins the review queue through buildDashboard only when bodies are supplied", () => {
    const data = read(1);
    expect(buildDashboard(model, data).review).toEqual([]);
    const d = buildDashboard(model, data, { bodies: new Map([["l1", body]]) });
    expect(d.review.map((r) => r.kind)).toEqual(["interactive"]);
  });
});

describe("derivations in the review queue", () => {
  const rec = (result: "open" | "done" | "gave-up" | "skipped", at: number) => ({ state: { lines: [], reached: 0, done: result === "done" }, result, hints: 0, attempts: 0, at });

  it("lists skipped and given-up derivations with their step, newest first, and leaves open and finished ones out", () => {
    const data = emptyProgress();
    data.derives = {
      "l1#d-1#0": rec("skipped", 10),
      "l1#d-2#1": rec("gave-up", 20),
      "l1#d-3#0": rec("done", 30),
      "l1#d-4#0": rec("open", 40),
      "ghost#d-1#0": rec("skipped", 50),
    };
    const items = located(buildDashboard(model, data).review);
    expect(items.map((r) => [r.kind, r.key, r.result])).toEqual([
      ["derive", "l1#d-2#1", "gave-up"],
      ["derive", "l1#d-1#0", "skipped"],
    ]);
    expect(items[0]).toMatchObject({ stepId: "d-2", block: 1 });
    expect(items[0]!.href).toContain("d-2");
  });
});

describe("planned placements do not gate", () => {
  it("stepGates ignores a goal on a planned placement but keeps it on a live one", () => {
    const planned = step("p", [{ t: "interactive", widget: "w", status: "planned", figure: "x.png", goal: { when: "x > 1", success: "ok" } }]);
    const liveStep = step("q", [{ t: "interactive", widget: "w", goal: { when: "x > 1", success: "ok" } }]);
    expect(stepGates("l1", planned as never)).toEqual([]);
    expect(stepGates("l1", liveStep as never).map((g) => g.kind)).toEqual(["goal"]);
  });
});
