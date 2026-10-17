// The prerequisite map (#/map) and the library's facets (#/library), on the real export. Tests tagged @phone run
// in the 390px project, everything else at 1280x800.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Index } from "../../src/ir";
import { courseScope } from "../../src/map/graph";
import { REPO } from "../helpers";
import { watchProblems } from "./util";

const index = JSON.parse(readFileSync(path.join(REPO, "content", "index.json"), "utf8")) as Index;
const concepts = Object.values(index.notes).filter((m) => m.type === "concept");
const SOLOW = "solow-growth-model";
const COBB_DOUGLAS = "cobb-douglas-production-function";

test.describe.configure({ mode: "parallel" });

test("the map renders every concept with no console errors", async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto("#/map");
  await expect(page.getByRole("heading", { level: 1, name: "Prerequisite map" })).toBeVisible();
  await expect(page.locator(".map-node")).toHaveCount(concepts.length);
  await expect(page.locator(".map-edge")).not.toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(problems.list).toEqual([]);
});

test("selecting Solow highlights its prerequisite Cobb-Douglas as an ancestor, and the card lists it", async ({ page }) => {
  await page.goto("#/map");
  await page.locator(`.map-node[data-slug="${SOLOW}"]`).click();
  await expect(page.locator(`.map-node[data-slug="${SOLOW}"]`)).toHaveAttribute("data-rel", "self");
  await expect(page.locator(`.map-node[data-slug="${COBB_DOUGLAS}"]`)).toHaveAttribute("data-rel", "ancestor");
  // Something Solow does not touch is dimmed; something that builds on it is a descendant.
  const dependents = concepts.filter((m) => m.requires.includes(SOLOW));
  expect(dependents.length).toBeGreaterThan(0);
  await expect(page.locator(`.map-node[data-slug="${dependents[0]!.slug}"]`)).toHaveAttribute("data-rel", "descendant");
  await expect(page.locator('.map-node[data-rel="other"]').first()).toBeAttached();

  const card = page.getByRole("complementary", { name: /Solow Growth Model, details/ });
  await expect(card.getByRole("heading", { level: 2, name: "Solow Growth Model" })).toBeVisible();
  await expect(card.getByRole("heading", { name: "Builds on" })).toBeVisible();
  await expect(card.getByRole("heading", { name: "Needed for" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Cobb-Douglas Production Function" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/map\\?node=${SOLOW}$`));
});

test("Open lesson navigates to the note", async ({ page }) => {
  await page.goto(`#/map?node=${SOLOW}`);
  await page.getByRole("link", { name: /Open lesson/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/note/${SOLOW}$`));
  await expect(page.locator(".note-title")).toHaveText("Solow Growth Model");
});

test("a card link selects the prerequisite and centres it", async ({ page }) => {
  await page.goto(`#/map?node=${SOLOW}`);
  await page.getByRole("complementary").getByRole("button", { name: "Cobb-Douglas Production Function" }).click();
  await expect(page.locator(`.map-node[data-slug="${COBB_DOUGLAS}"]`)).toHaveAttribute("data-rel", "self");
  await expect(page.locator(`.map-node[data-slug="${SOLOW}"]`)).toHaveAttribute("data-rel", "descendant");
  await expect(page.getByRole("complementary", { name: /Cobb-Douglas Production Function, details/ })).toBeVisible();
});

test("filtering by Econ 402A shows its covered concepts and their prerequisite closure", async ({ page }) => {
  const scope = courseScope(index, "Econ 402A");
  expect(scope.size).toBeLessThan(concepts.length);
  await page.goto("#/map");
  await page.getByLabel("Course").selectOption("Econ 402A");
  await expect(page.locator(".map-node")).toHaveCount(scope.size);
  await expect(page.locator(`.map-node[data-slug="${SOLOW}"]`)).toBeAttached();
  // Study order includes a Math Prep prerequisite the course does not cover itself.
  const outsider = [...scope].find((s) => !index.notes[s]!.courses.includes("Econ 402A"));
  expect(outsider).toBeDefined();
  await expect(page.locator(`.map-node[data-slug="${outsider}"]`)).toBeAttached();
  await expect(page).toHaveURL(/#\/map\?course=Econ\+402A/);
  // Survives a reload.
  await page.reload();
  await expect(page.locator(".map-node")).toHaveCount(scope.size);
  await expect(page.getByLabel("Course")).toHaveValue("Econ 402A");
});

test("the domain filter narrows the map and the facts and papers toggle adds notes", async ({ page }) => {
  await page.goto("#/map");
  await page.getByLabel("Domain").selectOption("labor");
  const labor = concepts.filter((m) => m.domain === "labor" || (m.domains ?? []).includes("labor")).length;
  await expect(page.locator(".map-node")).toHaveCount(labor);
  await page.getByLabel("Domain").selectOption("");
  await page.getByRole("switch", { name: "Facts and papers" }).click();
  await expect(page.locator(".map-node")).not.toHaveCount(concepts.length);
  expect(await page.locator('.map-node[data-type="fact"], .map-node[data-type="paper"]').count()).toBeGreaterThan(0);
});

test("search highlights a node and centres it", async ({ page }) => {
  await page.goto("#/map");
  await page.getByRole("searchbox", { name: "Find a concept on the map" }).fill("solow growth");
  const node = page.locator(`.map-node[data-slug="${SOLOW}"]`);
  await expect(node).toHaveAttribute("data-match", "true");
  // The match animates into the middle of the canvas.
  await expect
    .poll(async () => {
      const [n, c] = await Promise.all([node.boundingBox(), page.locator(".map-canvas").boundingBox()]);
      if (!n || !c) return Infinity;
      return Math.hypot(n.x + n.width / 2 - (c.x + c.width / 2), n.y + n.height / 2 - (c.y + c.height / 2));
    })
    .toBeLessThan(40);
  await page.getByRole("searchbox", { name: "Find a concept on the map" }).press("Enter");
  await expect(node).toHaveAttribute("data-rel", "self");
});

test("arrow keys move through neighbours and Enter opens the lesson", async ({ page }) => {
  await page.goto(`#/map?node=${SOLOW}`);
  const solow = page.locator(`.map-node[data-slug="${SOLOW}"]`);
  await solow.focus();
  const prerequisites = new Set(index.notes[SOLOW]!.requires);
  await page.keyboard.press("ArrowLeft");
  const moved = await page.locator('.map-node[data-rel="self"]').getAttribute("data-slug");
  expect(prerequisites.has(moved!)).toBe(true);
  await page.keyboard.press("ArrowRight");
  const back = await page.locator('.map-node[data-rel="self"]').getAttribute("data-slug");
  expect(index.notes[back!]!.requires).toContain(moved);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#/note/${back}$`));
});

test("the wheel zooms, Fit brings the whole map back", async ({ page }) => {
  await page.goto("#/map");
  const viewport = page.locator(".map-viewport");
  const before = await viewport.evaluate((el) => el.style.transform);
  const box = (await page.locator(".map-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await expect.poll(() => viewport.evaluate((el) => el.style.transform)).not.toBe(before);
  const scale = (t: string) => Number(/scale\(([\d.]+)\)/.exec(t)![1]);
  const zoomed = scale(await viewport.evaluate((el) => el.style.transform));
  expect(zoomed).toBeGreaterThan(scale(before));
  await page.getByRole("button", { name: "Fit to screen" }).click();
  await expect.poll(async () => scale(await viewport.evaluate((el) => el.style.transform))).toBeCloseTo(scale(before), 2);
});

test("the study-order list shows every note after its prerequisites @phone", async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto("#/map");
  // A phone gets the layered list instead of the canvas.
  await expect(page.locator(".map-list")).toBeVisible();
  await expect(page.locator(".map-canvas")).toHaveCount(0);
  await expect(page.locator(".map-list-item")).toHaveCount(concepts.length);
  await expect(page.getByRole("heading", { level: 2, name: /^Step 1/ })).toBeVisible();
  // Solow sits in a later step than Cobb-Douglas, which it builds on.
  const stepOf = (slug: string) =>
    page.locator(`.map-layer:has([data-slug="${slug}"]) .map-layer-title`).evaluate((el) => Number(/Step (\d+)/.exec(el.textContent ?? "")![1]));
  expect(await stepOf(SOLOW)).toBeGreaterThan(await stepOf(COBB_DOUGLAS));
  // No horizontal scrolling on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator(`.map-list-item[data-slug="${SOLOW}"]`).click();
  await expect(page).toHaveURL(new RegExp(`#/note/${SOLOW}$`));
  await page.waitForLoadState("networkidle");
  expect(problems.list).toEqual([]);
});

test("the filters work in the phone list too @phone", async ({ page }) => {
  await page.goto("#/map");
  await page.getByLabel("Course").selectOption("Econ 430");
  await expect(page.locator(".map-list-item")).toHaveCount(courseScope(index, "Econ 430").size);
  await page.getByRole("radio", { name: "Map" }).click();
  await expect(page.locator(".map-canvas")).toBeVisible();
});

// ---------- library facets ----------

test.describe("library facets", () => {
  const status = (page: import("@playwright/test").Page) => page.getByRole("status").filter({ hasText: /notes?/ });

  test("multi-select chips combine, counts follow, and the URL carries the state", async ({ page }) => {
    const problems = watchProblems(page);
    await page.goto("#/library");
    await expect(status(page)).toHaveText(`${concepts.length} notes`);

    const labor = concepts.filter((m) => m.domain === "labor" || (m.domains ?? []).includes("labor"));
    await page.getByRole("checkbox", { name: /^Labor\s*\d/ }).click();
    await expect(status(page)).toHaveText(`${labor.length} notes`);
    await expect(page).toHaveURL(/#\/library\?domain=labor$/);

    // A second chip in another facet narrows; the count on a sibling chip drops with it.
    const inequality = labor.filter((m) => m.domain === "inequality" || (m.domains ?? []).includes("inequality")).length;
    await expect(page.getByRole("checkbox", { name: /^Inequality\s*\d/ })).toContainText(String(inequality));
    await page.getByRole("checkbox", { name: /^Econ 424\s*\d/ }).click();
    await expect(page).toHaveURL(/course=Econ\+424/);
    const both = labor.filter((m) => m.courses.includes("Econ 424")).length;
    await expect(status(page)).toHaveText(`${both} notes`);

    // Types are multi-select too.
    await page.getByRole("checkbox", { name: /^Facts\s*\d/ }).click();
    await expect(page).toHaveURL(/type=concept%2Cfact/);
    const withFacts = Object.values(index.notes).filter((m) => (m.type === "concept" || m.type === "fact") && (m.domain === "labor" || (m.domains ?? []).includes("labor")) && m.courses.includes("Econ 424")).length;
    await expect(status(page)).toHaveText(`${withFacts} notes`);

    // Shareable: the same URL in a fresh load gives the same view.
    await page.reload();
    await expect(status(page)).toHaveText(`${withFacts} notes`);
    await expect(page.getByRole("checkbox", { name: /^Labor\s*\d/ })).toHaveAttribute("aria-checked", "true");
    await page.waitForLoadState("networkidle");
    expect(problems.list).toEqual([]);
  });

  test("sort by study order puts prerequisites before what builds on them", async ({ page }) => {
    await page.goto("#/library?sort=study");
    await expect(page.locator(".note-card").first()).toBeVisible();
    const slugs = await page.locator(".note-card").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.note!));
    expect(slugs.indexOf(COBB_DOUGLAS)).toBeGreaterThanOrEqual(0);
    expect(slugs.indexOf(COBB_DOUGLAS)).toBeLessThan(slugs.indexOf(SOLOW));
    await page.goto("#/library?sort=recent");
    await expect(page.getByLabel("Sort by")).toHaveValue("recent");
  });

  test("the progress facet reads the progress store", async ({ page }) => {
    await page.addInitScript((slug) => {
      localStorage.setItem(
        "mqe-lessons/progress/1",
        JSON.stringify({ version: 1, steps: {}, notes: { [slug]: { total: 10, seen: 10, furthest: 9, at: Date.now() } }, checks: {}, checkpoints: {} }),
      );
    }, SOLOW);
    await page.goto("#/library?status=done");
    await expect(status(page)).toHaveText("1 note");
    await expect(page.locator(`.note-card[data-note="${SOLOW}"]`)).toBeVisible();
  });

  test("an empty result offers to clear the filters", async ({ page }) => {
    await page.goto("#/library?type=paper&has=interactive");
    await expect(status(page)).toHaveText("0 notes");
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/#\/library$/);
    await expect(status(page)).toHaveText(`${concepts.length} notes`);
  });

  test("search still works and ranks by relevance @phone", async ({ page }) => {
    await page.goto("#/library");
    await page.getByRole("searchbox", { name: "Search the library" }).fill("solow");
    await expect(page.locator(".note-card").first()).toBeVisible();
    await expect(page.getByLabel("Sort by")).toHaveValue("");
    await expect(page.getByRole("option", { name: "Relevance" })).toBeAttached();
    // Filters sit behind a button on a phone.
    await page.getByRole("button", { name: /^Filters/ }).click();
    await expect(page.getByRole("checkbox", { name: /^Facts\s*\d/ })).toBeVisible();
  });
});
