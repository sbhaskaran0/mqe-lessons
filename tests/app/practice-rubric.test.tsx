// @vitest-environment happy-dom
// E3: a practice question with rubric key steps is graded by ticking the steps it got; the grade is derived
// (all = Got it, at least half = Partly, fewer = Not yet), and "Partly" counts in the summary and the review filter.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMarkdown } from "../../src/content/markdown";
import { ContentProvider, type Content } from "../../src/content/context";
import type { PracticeItem } from "../../src/ir";
import { PracticeCard } from "../../src/practice/PracticePage";
import { filterIds, setSummary } from "../../src/practice/model";
import { practiceKey, progress, useProgress } from "../../src/progress";

const rubricItem: PracticeItem = { id: "q1", number: "1", prompt: "Derive it", answer: "Worked", links: [], rubric: ["Set up", "Differentiate", "Solve", "State result"] };
const plainItem: PracticeItem = { id: "q2", number: "2", prompt: "Plain", answer: "Plain answer", links: [] };
const content = { md: createMarkdown({ noteHref: () => null, assetUrl: (s) => s }), note: () => undefined } as unknown as Content;

function Card({ item }: { item: PracticeItem }) {
  const data = useProgress();
  return <PracticeCard item={item} slug="set" answersTitle="Answers" result={data.practice[practiceKey("set", item.id)]} />;
}
const mount = (item: PracticeItem) =>
  render(
    <ContentProvider value={content}>
      <Card item={item} />
    </ContentProvider>,
  );
const reveal = () => fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
const tick = (...names: string[]) => names.forEach((n) => fireEvent.click(screen.getByLabelText(n)));
const grade = (name = "Grade") => fireEvent.click(screen.getByRole("button", { name }));
const stored = () => progress.get().practice[practiceKey("set", "q1")];

beforeEach(() => progress.reset());
afterEach(cleanup);

describe("rubric checklist", () => {
  it("shows no checklist before the answer is revealed, then a labelled fieldset instead of the two grade buttons", () => {
    mount(rubricItem);
    expect(screen.queryByText("Which steps did you get?")).toBeNull();
    reveal();
    expect(screen.getByRole("group", { name: "Which steps did you get?" })).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "Got it" })).toBeNull();
  });

  it("grades all steps as Got it, half as Partly, fewer as Not yet", () => {
    mount(rubricItem);
    reveal();
    tick("Set up", "Differentiate", "Solve", "State result");
    grade();
    expect(stored()?.grade).toBe("got");
    expect(document.querySelector(".pq-rubric-result")?.textContent).toContain("Got it");
    expect(document.querySelector(".pq-rubric-step[data-missed]")).toBeNull();
  });

  it("re-grades, highlights the missed steps and moves focus to the result", () => {
    mount(rubricItem);
    reveal();
    tick("Set up", "Differentiate");
    grade();
    expect(stored()?.grade).toBe("partly");
    expect(stored()?.ticked).toEqual([0, 1]);
    expect([...document.querySelectorAll(".pq-rubric-step[data-missed]")].map((e) => e.textContent)).toEqual(["Solve", "State result"]);
    expect(document.activeElement).toBe(document.querySelector(".pq-rubric-result"));
    tick("Differentiate");
    grade("Re-grade");
    expect(stored()?.grade).toBe("notyet");
    expect(stored()?.first).toBe("partly");
    expect(document.querySelector(".pq-rubric-result")?.textContent).toContain("Not yet");
  });
});

describe("items without a rubric", () => {
  it("keep the Got it / Not yet buttons", () => {
    mount(plainItem);
    reveal();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(progress.get().practice[practiceKey("set", "q2")]?.grade).toBe("got");
  });
});

describe("partly in the summary and filters", () => {
  it("tallies partly apart from not yet, and lists it under the Not yet filter", () => {
    const items = [rubricItem, plainItem, { ...plainItem, id: "q3" }];
    progress.gradePracticeRubric(practiceKey("set", "q1"), [0, 1], 4);
    progress.gradePractice(practiceKey("set", "q2"), "notyet");
    const data = progress.get();
    expect(setSummary(data, "set", items)).toEqual({ total: 3, got: 0, partly: 1, notYet: 1, untried: 1 });
    expect([...filterIds(data, "set", items, "review")]).toEqual(["q1", "q2"]);
    expect([...filterIds(data, "set", items, "new")]).toEqual(["q3"]);
  });
});
