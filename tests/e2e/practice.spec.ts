// Practice sets played on the real export (Econ 430 L1 and the Econ 402A L1 Solow Revision Lesson): reveal a worked
// answer, grade it, review the "Not yet" ones, revise a linked note, and find it all on the progress dashboard.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Index, NoteBody } from "../../src/ir";
import { REPO } from "../helpers";
import { expectNoKatexErrors, watchProblems } from "./util";

const CONTENT = path.join(REPO, "content");
const index = JSON.parse(readFileSync(path.join(CONTENT, "index.json"), "utf8")) as Index;
const body = (slug: string) => JSON.parse(readFileSync(path.join(CONTENT, "notes", `${slug}.json`), "utf8")) as NoteBody;

const SETS = [
  { slug: "econ-430-simple-linear-regression-practice-questions", course: "econ-430" },
  { slug: "econ-402a-l1-solow-revision-lesson", course: "econ-402a" },
] as const;

const card = (page: Page, id: string) => page.locator(`[data-practice-id="${id}"]`);

for (const set of SETS) {
  const b = body(set.slug);
  const items = b.practice?.items ?? [];
  const title = index.notes[set.slug]!.title;

  test(`${set.slug}: reveal, grade, review the Not yet ones, see them on #/progress`, async ({ page }) => {
    // A long walk across three pages; give it room when the machine is busy.
    test.slow();
    expect(items.length, "the exporter emits the set's questions").toBeGreaterThan(1);
    const problems = watchProblems(page);

    // The course page links to the set.
    await page.goto(`#/course/${set.course}`);
    await page.locator(`a[href="#/practice/${set.slug}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`#/practice/${set.slug}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.locator("[data-practice-id]")).toHaveCount(items.length);
    const groups = new Set(items.map((i) => i.group).filter(Boolean));
    await expect(page.locator(".practice-group-title")).toHaveCount(groups.size);

    // Reveal the first answer; tick no steps, so it grades Not yet.
    const [first, second] = [items[0]!, items[1]!];
    expect(first.rubric?.length, "wave 2.4 gave every answer key steps").toBeGreaterThanOrEqual(2);
    const c1 = card(page, first.id);
    await expect(c1.getByRole("region", { name: /Worked answer/ })).toHaveCount(0);
    await c1.getByRole("button", { name: "Show answer" }).click();
    await expect(c1.getByRole("region", { name: /Worked answer/ })).toBeVisible();
    // The checklist replaces the grade buttons; focus lands on its first checkbox, and Hide answer hands it back.
    await expect(c1.getByRole("group", { name: "Which steps did you get?" })).toBeVisible();
    await expect(c1.getByRole("checkbox")).toHaveCount(first.rubric!.length);
    await expect(c1.getByRole("button", { name: "Got it" })).toHaveCount(0);
    await expect(c1.getByRole("checkbox").first()).toBeFocused();
    await c1.getByRole("button", { name: "Hide answer" }).click();
    await expect(c1.getByRole("region", { name: /Worked answer/ })).toHaveCount(0);
    await expect(c1.getByRole("button", { name: "Show answer" })).toBeFocused();
    await c1.getByRole("button", { name: "Show answer" }).click();
    await c1.getByRole("button", { name: "Grade" }).click();
    await expect(c1.locator(".pq-rubric-result")).toContainText("Not yet");
    await expect(c1.locator(".pq-rubric-result")).toBeFocused();
    await expect(c1.locator(".pq-rubric-step[data-missed]")).toHaveCount(first.rubric!.length);
    await expect(c1.locator(".pq-badge")).toHaveText("Not yet");

    // The second, by keyboard: tick every step, Grade. Then re-grade down to Partly and back to Got it.
    const c2 = card(page, second.id);
    const n2 = second.rubric!.length;
    await c2.getByRole("button", { name: "Show answer" }).focus();
    await page.keyboard.press("Enter");
    await expect(c2.getByRole("region", { name: /Worked answer/ })).toBeVisible();
    await expect(c2.getByRole("checkbox").first()).toBeFocused();
    for (let i = 0; i < n2; i++) await c2.getByRole("checkbox").nth(i).check();
    await c2.getByRole("button", { name: "Grade" }).click();
    await expect(c2.locator(".pq-badge")).toHaveText("Got it");
    await expect(c2.locator(".pq-rubric-result")).toBeFocused();
    await c2.getByRole("checkbox").first().uncheck();
    await c2.getByRole("button", { name: "Re-grade" }).click();
    await expect(c2.locator(".pq-badge")).toHaveText("Partly");
    await expect(c2.locator(".pq-rubric-step[data-missed]")).toHaveCount(1);
    await c2.getByRole("checkbox").first().check();
    await c2.getByRole("button", { name: "Re-grade" }).click();
    await expect(c2.locator(".pq-badge")).toHaveText("Got it");
    await expect(page.locator(".practice-tally")).toContainText(`2 of ${items.length} tried`);

    // Review: only the Not yet question is listed.
    await page.getByRole("radio", { name: /Not yet/ }).click();
    await expect(page).toHaveURL(/show=review/);
    await expect(page.locator("[data-practice-id]")).toHaveCount(1);
    await expect(card(page, first.id)).toBeVisible();

    // A grade survives a reload.
    await page.reload();
    await expect(page.locator("[data-practice-id]")).toHaveCount(1);
    await expect(card(page, first.id).locator(".pq-badge")).toHaveText("Not yet");
    await expectNoKatexErrors(page);

    // The dashboard lists it in the review queue and counts the course's grades.
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Progress" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your progress");
    const review = page.locator(".review");
    const entry = review.locator(`a[href="#/practice/${set.slug}?at=${first.id}"]`);
    await expect(entry).toBeVisible();
    await expect(entry).toContainText(`Question ${first.number}`);
    const courseCard = page.locator(".course-progress").filter({ has: page.locator(`a[href="#/course/${set.course}"]`) });
    await expect(courseCard.locator(".course-practice-tally")).toContainText("1 got it");
    await expect(courseCard.locator(".course-practice-tally")).toContainText("1 not yet");
    await expect(page.locator(".recent-list")).toContainText(title);
    await expectNoKatexErrors(page);

    // Back to the question from the queue.
    await entry.click();
    await expect(page).toHaveURL(new RegExp(`#/practice/${set.slug}\\?at=${first.id}$`));
    await expect(card(page, first.id).getByRole("button", { name: "Show answer" })).toBeFocused();
    await page.waitForLoadState("networkidle");
    expect(problems.list).toEqual([]);
  });
}

test("an item without a rubric keeps the Got it / Not yet buttons", async ({ page }) => {
  const set = SETS[0];
  const item = body(set.slug).practice!.items[0]!;
  // Strip the key steps from the note as it loads, so the card falls back to self-grading.
  await page.route(`**/notes/${set.slug}.json`, async (route) => {
    const res = await route.fetch();
    const json = (await res.json()) as NoteBody;
    for (const it of json.practice?.items ?? []) delete it.rubric;
    await route.fulfill({ response: res, json });
  });
  await page.goto(`#/practice/${set.slug}`);
  const c = card(page, item.id);
  await c.getByRole("button", { name: "Show answer" }).click();
  await expect(c.getByRole("button", { name: "Got it" })).toBeFocused();
  await expect(c.getByRole("checkbox")).toHaveCount(0);
  await c.getByRole("button", { name: "Not yet" }).click();
  await expect(c.locator(".pq-badge")).toHaveText("Not yet");
});

test("a Revise chip opens the linked note in the deep-dive panel", async ({ page }) => {
  const set = SETS[0];
  const item = body(set.slug).practice!.items.find((i) => i.links.length > 0)!;
  const target = index.notes[item.links[0]!]!;
  await page.goto(`#/practice/${set.slug}?at=${item.id}`);
  await card(page, item.id).getByRole("link", { name: `Revise: ${target.title}` }).click();
  const dive = page.getByRole("dialog", { name: `Deep dive: ${target.title}` });
  await expect(dive).toBeVisible();
  await dive.getByRole("button", { name: "Back to practice" }).click();
  await expect(dive).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`#/practice/${set.slug}`));
});

test("the practice note's own page links to the set, and the note still renders as before", async ({ page }) => {
  const set = SETS[1];
  const n = body(set.slug).practice!.items.length;
  await page.goto(`#/note/${set.slug}`);
  await expect(page.locator(".note-title")).toHaveText(index.notes[set.slug]!.title);
  await page.getByRole("link", { name: `Practise question by question (${n})` }).click();
  await expect(page).toHaveURL(new RegExp(`#/practice/${set.slug}$`));
  await expect(page.locator("[data-practice-id]")).toHaveCount(n);
});

test("a wrong or skipped checkpoint shows in the review queue and links to its exact step", async ({ page }) => {
  const slug = "econ-402a-l1-solow-growth-model";
  const stepId = "6-the-steady-state-2";
  await page.goto("#/");
  await page.evaluate(
    ({ slug, stepId }) => {
      const now = Date.now();
      const progress = {
        version: 1,
        steps: { [`${slug}#${stepId}`]: now },
        notes: { [slug]: { total: 40, seen: 1, furthest: 12, at: now } },
        checks: { [`${slug}#${stepId}#0`]: { result: "incorrect", answer: 2, tries: 1, at: now } },
        checkpoints: {},
      };
      localStorage.setItem("mqe-lessons/progress/1", JSON.stringify(progress));
    },
    { slug, stepId },
  );
  // A hash change keeps the page (and its in-memory store); reload so the store reads what was just written.
  await page.goto("#/progress");
  await page.reload();
  const item = page.locator(`.review a[href="#/lesson/${slug}?at=${stepId}"]`);
  await expect(item).toContainText("answered wrong");
  await expect(item).toContainText("steady-state consumption per worker");
  const course = page.locator(".course-progress").filter({ has: page.locator('a[href="#/course/econ-402a"]') });
  await expect(course.locator(".tally-line")).toContainText("1 wrong");
  await item.click();
  await expect(page.locator(`[data-step-id="${stepId}"]`)).toBeInViewport();
});

test("practice at phone width: tap to reveal and grade @phone", async ({ page }) => {
  const problems = watchProblems(page);
  const set = SETS[1];
  const first = body(set.slug).practice!.items[0]!;
  await page.goto(`#/practice/${set.slug}`);
  const c = card(page, first.id);
  await c.getByRole("button", { name: "Show answer" }).tap();
  await expect(c.getByRole("region", { name: /Worked answer/ })).toBeVisible();
  const boxes = c.getByRole("checkbox");
  for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).tap();
  await c.getByRole("button", { name: "Grade" }).tap();
  await expect(c.locator(".pq-badge")).toHaveText("Got it");
  // No sideways scrolling on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // On a phone the section links fold into the header's menu.
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Progress" })).toBeHidden();
  await nav.getByRole("button", { name: "Menu" }).tap();
  await nav.getByRole("link", { name: "Progress" }).tap();
  await expect(nav.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your progress");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoKatexErrors(page);
  expect(problems.list).toEqual([]);
});
