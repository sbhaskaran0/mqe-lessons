// Smoke test over the real export: every route content/index.json implies renders with no console errors, no
// failed requests, no KaTeX errors, and (in Review mode) every step of the note's body. Tests tagged @phone also
// run in the 390px project.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Index, NoteBody } from "../../src/ir";
import { REPO } from "../helpers";
import { expectNoKatexErrors, expectNoSidewaysScroll, reviewMode, watchProblems } from "./util";

const CONTENT = path.join(REPO, "content");
const index = JSON.parse(readFileSync(path.join(CONTENT, "index.json"), "utf8")) as Index;
const body = (slug: string) => JSON.parse(readFileSync(path.join(CONTENT, "notes", `${slug}.json`), "utf8")) as NoteBody;
const stepIds = (b: NoteBody) => b.sections.flatMap((s) => s.steps.map((st) => st.id));
const figures = (b: NoteBody) => b.sections.flatMap((s) => s.steps.flatMap((st) => st.blocks.flatMap((bl) => (bl.t === "figure" ? [bl.src] : []))));

/** Pages that also run at phone width: the two lessons Vasu reviews, plus one of each other page kind. */
const PHONE = new Set([
  "#/",
  "#/library",
  "#/course/econ-424",
  "#/lesson/econ-402a-l1-solow-growth-model",
  "#/lesson/econ-424-l2-between-group-inequality",
  "#/note/solow-diagram",
  "#/note/katz-and-murphy-1992-changes-in-relative-wages",
]);
const tag = (route: string) => (PHONE.has(route) ? " @phone" : "");
/** The phone project is the only run narrower than the desktop's 1280px; desktop pages may be wider than 390 by design. */
const phoneWidth = (page: Page) => page.viewportSize()!.width <= 390;

const hubs = new Map(index.courses.map((c) => [c.hub, c]));

test.describe.configure({ mode: "parallel" });

test(`home${tag("#/")}`, async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto("#/");
  await expect(page.getByRole("heading", { level: 1, name: "MQE Lessons" })).toBeVisible();
  for (const c of index.courses) await expect(page.locator(`a[href="#/course/${c.id}"]`).first()).toBeVisible();
  if (phoneWidth(page)) await expectNoSidewaysScroll(page);
  await page.waitForLoadState("networkidle");
  expect(problems.list).toEqual([]);
});

test(`library${tag("#/library")}`, async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto("#/library");
  const concepts = Object.values(index.notes).filter((m) => m.type === "concept").length;
  await expect(page.getByRole("status").filter({ hasText: /notes?$/ })).toHaveText(`${concepts} notes`);
  await page.getByRole("searchbox", { name: "Search the library" }).fill("solow");
  await expect(page.locator(".note-card").first()).toBeVisible();
  if (phoneWidth(page)) await expectNoSidewaysScroll(page);
  await expectNoKatexErrors(page);
  await page.waitForLoadState("networkidle");
  expect(problems.list).toEqual([]);
});

for (const course of index.courses) {
  const route = `#/course/${course.id}`;
  test(`course ${course.code}${tag(route)}`, async ({ page }) => {
    const problems = watchProblems(page);
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(course.code);
    if (!course.title) await expect(page.getByRole("heading", { level: 1 })).toHaveText(course.code);
    for (const l of course.lectures) await expect(page.locator(`.lecture-path a[href="#/lesson/${l}"]`)).toBeVisible();
    // The hub's own notes render on the course page.
    const ids = stepIds(body(course.hub));
    await expect(page.locator(".course-notes [data-step-id]")).toHaveCount(ids.length);
    if (phoneWidth(page)) await expectNoSidewaysScroll(page);
    await expectNoKatexErrors(page);
    await page.waitForLoadState("networkidle");
    expect(problems.list).toEqual([]);
  });
}

for (const meta of Object.values(index.notes)) {
  if (hubs.has(meta.slug)) continue; // its body is checked on the course page above
  const route = `#/${meta.type === "lecture" ? "lesson" : "note"}/${meta.slug}`;
  test(`${meta.type} ${meta.slug}${tag(route)}`, async ({ page }) => {
    const problems = watchProblems(page);
    const b = body(meta.slug);
    const ids = stepIds(b);
    await page.goto(route);
    await expect(page.locator(".note-title")).toHaveText(meta.title);
    if (ids.length > 0) {
      await reviewMode(page);
      const rendered = await page.locator(".lesson-main [data-step-id]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.stepId));
      expect(rendered).toEqual(ids);
      // Review mode shows every step, so the end-of-lesson card (with its long "Next: <title>" button) is on the page.
      await expect(page.locator(".end-card")).toBeVisible();
      if (phoneWidth(page)) await expectNoSidewaysScroll(page);
    }
    await expectNoKatexErrors(page);
    for (const src of new Set(figures(b))) {
      const r = await page.request.get(src);
      expect(r.status(), src).toBe(200);
    }
    await page.waitForLoadState("networkidle");
    expect(problems.list).toEqual([]);
  });
}

test("the widget gallery renders every widget", async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto("#/dev/widgets");
  const n = Object.keys(index.widgets).length;
  await expect(page.getByRole("heading", { level: 1, name: `Widgets (${n})` })).toBeVisible();
  await expect(page.locator("[data-gallery]")).toHaveCount(n);
  await expect(page.locator("[data-gallery] .w-root")).toHaveCount(n);
  await expect(page.locator('[data-gallery] .w-root[role="alert"]')).toHaveCount(0);
  await expectNoKatexErrors(page);
  await page.waitForLoadState("networkidle");
  expect(problems.list).toEqual([]);
});

test("a course hub link lands on its course page", async ({ page }) => {
  const course = index.courses[0]!;
  await page.goto(`#/note/${course.hub}`);
  await expect(page).toHaveURL(new RegExp(`#/course/${course.id}$`));
});

test("an unknown slug shows the not-found page", async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto("#/note/no-such-note-anywhere");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("There is no page here");
  expect(problems.list).toEqual([]);
});

test("the phone menu closes on Escape, an outside tap and when focus leaves it @phone", async ({ page }) => {
  test.skip(!phoneWidth(page), "the section links only fold into a menu on a phone");
  await page.goto("#/library");
  const nav = page.getByRole("navigation", { name: "Main" });
  const menu = nav.getByRole("button", { name: "Menu" });
  const open = async () => {
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await expect(nav.getByRole("link", { name: "Map" })).toBeVisible();
  };

  await open();
  await nav.getByRole("link", { name: "Map" }).focus();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();

  await open();
  await page.locator("main").tap({ position: { x: 20, y: 300 } });
  await expect(menu).toHaveAttribute("aria-expanded", "false");

  // Tabbing past the last link (to the search box, which follows the menu) closes it as well.
  await open();
  await nav.getByRole("link", { name: /^Review/ }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "Search notes" })).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
});

test("a deep dive with a long note title in its header fits a phone @phone", async ({ page }) => {
  test.skip(!phoneWidth(page), "the overflow is a phone-width problem");
  await page.goto("#/lesson/econ-424-l2-between-group-inequality");
  await reviewMode(page);
  // Open a note, then stack a second one so the header carries the first note's title as a back button.
  await page.locator(".lesson-main .step a[data-note]:not([href^='#/lesson'])").first().click();
  const dive = page.getByRole("dialog", { name: /Deep dive/ });
  await expect(dive).toBeVisible();
  await dive.locator(".steps a[data-note]:not([href^='#/lesson']):not([href^='#/course'])").first().click();
  await expect(dive.locator(".dive-head .btn-ghost")).toBeVisible();
  await expectNoSidewaysScroll(page);
});
