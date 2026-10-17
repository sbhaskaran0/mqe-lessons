// Behaviour of the lesson player on the fixture vault (tests/fixtures/vault), which has a goal, an mcq and a
// numeric checkpoint: progressive reveal, gating, Skip, Review mode, remembered position, panels and settings.
import { expect, test, type Page } from "@playwright/test";
import { reviewMode, watchProblems } from "./util";

const LESSON = "#/lesson/toy-101-l1-growth";
const STEPS = 18;
const steps = (page: Page) => page.locator(".lesson-main [data-step-id]");
const cont = (page: Page) => page.getByRole("button", { name: "Continue", exact: true });
const skip = (page: Page) => page.getByRole("button", { name: "Skip", exact: true });

async function continueTo(page: Page, count: number) {
  await expect(steps(page).first()).toBeVisible();
  while ((await steps(page).count()) < count) {
    const before = await steps(page).count();
    await cont(page).click();
    await expect(steps(page)).toHaveCount(before + 1);
  }
}

/** window.scrollY once a smooth scroll has finished. */
async function settledScroll(page: Page): Promise<number> {
  let last = -1;
  await expect
    .poll(async () => {
      const y = await page.evaluate(() => window.scrollY);
      const same = y === last;
      last = y;
      return same;
    }, { intervals: [150] })
    .toBe(true);
  return last;
}

test.describe.configure({ mode: "parallel" });

test("steps reveal one at a time; checkpoints gate Continue; Skip is recorded", async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto(LESSON);
  await expect(steps(page)).toHaveCount(1);
  await expect(page.getByText(`Step 1 of ${STEPS}`)).toBeVisible();

  await continueTo(page, 5);
  // Step 5 carries a widget goal: Continue is held until it is met or skipped.
  await expect(page.locator('[data-step-id="2-the-steady-state-3"]')).toBeVisible();
  await expect(cont(page)).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("Reach the goal in the interactive to continue, or skip it.")).toBeVisible();
  // aria-disabled (not disabled) keeps the button focusable; a click on it must do nothing.
  await cont(page).click({ force: true });
  await expect(steps(page)).toHaveCount(5);
  await skip(page).click();
  await expect(steps(page)).toHaveCount(6);

  // Step 6 is a multiple-choice check: a wrong answer still opens the gate, with feedback and the why.
  const mcq = page.locator('[data-step-id="2-the-steady-state-4"] .check');
  await expect(cont(page)).toHaveAttribute("aria-disabled", "true");
  await mcq.getByText("It doubles").click();
  // The verdict's live region is already on the page, empty, so its text is announced when it arrives.
  await expect(mcq.getByRole("status")).toBeEmpty();
  await mcq.getByRole("button", { name: "Check answer" }).click();
  await expect(mcq.getByText("Not quite.")).toBeVisible();
  // Submitting removes the button that had focus: the verdict takes it.
  await expect(mcq.getByRole("status")).toBeFocused();
  await expect(mcq.getByText("In the steady state capital per worker is constant", { exact: false })).toBeVisible();
  await expect(mcq.locator('.mcq-option[data-feedback="correct"]')).toContainText("It is unchanged");
  await expect(mcq.locator('.mcq-option[data-feedback="wrong"]')).toContainText("It doubles");
  await expect(cont(page)).not.toHaveAttribute("aria-disabled", "true");
  await cont(page).click();
  await expect(steps(page)).toHaveCount(7);

  // Step 7 is numeric, answered within tolerance.
  const numeric = page.locator('[data-step-id="2-the-steady-state-5"] .check');
  await numeric.getByLabel("Your answer").fill("25.03");
  await numeric.getByRole("button", { name: "Check answer" }).click();
  await expect(numeric.getByText("Correct.")).toBeVisible();
  await expect(numeric.getByRole("status")).toBeFocused();
  await expect(numeric.locator(".check-why")).toBeVisible();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("mqe-lessons/progress/1") ?? "{}"));
  expect(stored.checkpoints["toy-101-l1-growth#2-the-steady-state-3#1"]).toMatchObject({ kind: "goal", result: "skipped" });
  expect(stored.checks["toy-101-l1-growth#2-the-steady-state-4#0"]).toMatchObject({ result: "incorrect", answer: [0] });
  expect(stored.checks["toy-101-l1-growth#2-the-steady-state-5#0"]).toMatchObject({ result: "correct", answer: 25.03 });
  expect(stored.notes["toy-101-l1-growth"]).toMatchObject({ total: STEPS, furthest: 6 });
  expect(problems.list).toEqual([]);
});

test("a skipped check stays answerable and the furthest step is remembered", async ({ page }) => {
  await page.goto(LESSON);
  await continueTo(page, 5);
  await skip(page).click();
  await expect(steps(page)).toHaveCount(6);
  await skip(page).click(); // the mcq
  await expect(steps(page)).toHaveCount(7);
  const mcq = page.locator('[data-step-id="2-the-steady-state-4"] .check');
  await expect(mcq.getByText("Skipped")).toBeVisible();
  await expect(mcq.locator(".check-why")).toHaveCount(0);

  await page.reload();
  await expect(steps(page)).toHaveCount(7);
  await expect(page.getByText(`Step 7 of ${STEPS}`)).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("mqe-lessons/progress/1") ?? "{}"));
  expect(stored.checks["toy-101-l1-growth#2-the-steady-state-4#0"]).toMatchObject({ result: "skipped", tries: 0 });
});

test("Review mode shows every step and is remembered", async ({ page }) => {
  await page.goto(LESSON);
  await expect(steps(page)).toHaveCount(1);
  await reviewMode(page);
  await expect(steps(page)).toHaveCount(STEPS);
  await expect(cont(page)).toHaveCount(0);
  await expect(page.getByText("Every step is shown.")).toBeVisible();
  // The footer appears once every step is visible.
  await expect(page.locator(".note-footer")).toBeVisible();
  await page.reload();
  await expect(steps(page)).toHaveCount(STEPS);
  await reviewMode(page, false);
  await expect(steps(page)).toHaveCount(1);
});

test("Continue works from the keyboard and moves focus to the step it reveals", async ({ page }) => {
  await page.goto(LESSON);
  await cont(page).focus();
  await page.keyboard.press("Enter");
  await expect(steps(page)).toHaveCount(2);
  await expect(steps(page).nth(1)).toBeFocused();
  // The button is reached again by tabbing through the new step, as any reader would.
  for (let i = 0; i < 40 && !(await cont(page).evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(cont(page)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(steps(page)).toHaveCount(3);
  await expect(steps(page).nth(2)).toBeFocused();
});

test("a new page takes focus; a query-only change keeps it where it is", async ({ page }) => {
  await page.goto(LESSON);
  await cont(page).focus();
  // ?at= changes the hash but not the path: the reader stays on the button.
  await page.evaluate(() => (location.hash = "#/lesson/toy-101-l1-growth?at=1-production-1"));
  await expect(page).toHaveURL(/\?at=1-production-1$/);
  await expect(cont(page)).toBeFocused();
  // A different path is a new page: focus starts in <main>, so the next Tab begins at its content.
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link").click();
  await expect(page).toHaveURL(/#\/course\/toy-101$/);
  await expect(page.locator("main")).toBeFocused();
});

test("the visual pane follows the active step and keeps a widget mounted across its steps", async ({ page }) => {
  await page.goto(LESSON);
  await reviewMode(page);
  const pane = page.locator(".pane");
  await page.locator('[data-step-id="2-the-steady-state-1"]').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector('[data-step-id="2-the-steady-state-1"]')!.scrollIntoView({ block: "start" }));
  await expect(pane.locator("img")).toHaveAttribute("alt", "Toy diagram");
  await page.evaluate(() => document.querySelector('[data-step-id="2-the-steady-state-2"]')!.scrollIntoView({ block: "start" }));
  await expect(pane.locator('.widget-slot[data-widget="toy-steady-state-explorer"]')).toBeVisible();
  const handle = await pane.locator('.widget-slot[data-widget="toy-steady-state-explorer"]').elementHandle();
  await page.evaluate(() => document.querySelector('[data-step-id="2-the-steady-state-3"]')!.scrollIntoView({ block: "start" }));
  await expect(page.locator('[data-step-id="2-the-steady-state-3"]')).toHaveAttribute("data-active", "true");
  // Same widget on consecutive steps: the very same element, not a remount.
  expect(await handle!.evaluate((el) => el.isConnected)).toBe(true);
  // A step without a visual leaves the last one in place, dimmed.
  await page.evaluate(() => document.querySelector('[data-step-id="2-the-steady-state-4"]')!.scrollIntoView({ block: "start" }));
  await expect(pane).toHaveAttribute("data-dim", "true");
  await expect(pane.locator('.widget-slot[data-widget="toy-steady-state-explorer"]')).toBeVisible();
});

test("a note link opens a deep dive, and Back to lesson returns to the same place", async ({ page }) => {
  await page.goto(LESSON);
  await continueTo(page, 2);
  const before = await settledScroll(page);
  await page.locator('[data-step-id="1-production-1"]').getByRole("link", { name: "Toy Production Function" }).click();
  const dive = page.getByRole("dialog", { name: /Deep dive/ });
  await expect(dive).toBeVisible();
  await expect(dive.getByRole("heading", { name: "Toy Production Function" })).toBeVisible();
  await expect(dive.locator("[data-step-id]")).not.toHaveCount(0);
  await expect(page).toHaveURL(/#\/lesson\/toy-101-l1-growth$/);
  // A link inside the panel stacks the next note.
  await dive.getByRole("link", { name: "Toy Growth Model" }).first().click();
  await expect(dive.getByRole("heading", { name: "Toy Growth Model", level: 2 })).toBeVisible();
  await dive.getByRole("button", { name: "Back to lesson" }).click();
  await expect(dive).toBeHidden();
  // Restored to the pixel, give or take sub-pixel rounding of the scroll position.
  expect(Math.abs((await settledScroll(page)) - before)).toBeLessThanOrEqual(1);
  await expect(steps(page)).toHaveCount(2);
});

test("leaving the page from a deep dive starts the new page at the top", async ({ page }) => {
  // A short window makes the lesson tall, so the link sits well down the page.
  await page.setViewportSize({ width: 1280, height: 360 });
  await page.goto(LESSON);
  await reviewMode(page);
  await page.locator('[data-step-id="1-production-1"]').getByRole("link", { name: "Toy Production Function" }).click();
  const dive = page.getByRole("dialog", { name: /Deep dive/ });
  await expect(dive).toBeVisible();
  expect(await page.evaluate(() => window.scrollY), "the lesson was scrolled before the dive opened").toBeGreaterThan(300);
  await dive.getByRole("link", { name: "Open as a full page" }).click();
  await expect(page).toHaveURL(/#\/note\/toy-production-function$/);
  await expect(page.getByRole("heading", { level: 1, name: "Toy Production Function" })).toBeVisible();
  expect(await settledScroll(page)).toBe(0);
});

test("a dive neither takes over \"where you left off\" nor traps a link back to its lesson", async ({ page }) => {
  await page.goto(LESSON);
  await reviewMode(page);
  const left = () => page.evaluate(() => JSON.parse(localStorage.getItem("mqe-lessons/progress/1") ?? "{}").last?.slug);
  await expect.poll(left).toBe("toy-101-l1-growth");
  await page.locator(".lesson-main a[data-note*='1956']").first().click();
  const dive = page.getByRole("dialog", { name: /Deep dive/ });
  await expect(dive).toBeVisible();
  await expect(dive.locator("[data-step-id]").first()).toBeVisible();
  // What the dive shows is recorded as seen, but the lesson stays the place to resume.
  const seen = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("mqe-lessons/progress/1") ?? "{}").steps));
  expect(seen.some((k) => k.includes("1956"))).toBe(true);
  expect(await left()).toBe("toy-101-l1-growth");
  // The paper reads "In the lecture: <this lesson>"; that link used to do nothing and leave the panel open.
  await dive.getByRole("link", { name: "Growth in a Toy Economy" }).first().click();
  await expect(dive).toBeHidden();
  await expect(page).toHaveURL(/#\/lesson\/toy-101-l1-growth$/);
  expect(await left()).toBe("toy-101-l1-growth");
});

test("symbol chips explain a symbol; the Symbols drawer lists the notation; Esc closes it", async ({ page }) => {
  await page.goto(LESSON);
  await continueTo(page, 2);
  const chips = page.locator('[data-step-id="1-production-1"] .symbol-chips');
  await chips.getByRole("button").first().click();
  await expect(chips.locator(".symbol-detail")).toContainText("Capital per worker");
  await expect(chips.locator(".symbol-detail")).toContainText("from Toy Growth Model");
  await page.getByRole("button", { name: /^Symbols \(\d+\)$/ }).click();
  const drawer = page.getByRole("dialog", { name: /Symbols in/ });
  await expect(drawer.locator("tbody tr")).not.toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("settings switch the theme and export progress without browser dialogs", async ({ page }) => {
  page.on("dialog", () => {
    throw new Error("a browser dialog opened");
  });
  await page.goto("#/");
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const status = dialog.getByRole("status");
  await expect(status).toBeEmpty();
  await dialog.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await dialog.getByRole("radio", { name: "System" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export" }).click();
  expect((await download).suggestedFilename()).toMatch(/^mqe-lessons-progress-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(status).toHaveText("Progress exported.");
  await dialog.getByRole("button", { name: "Reset" }).click();
  await dialog.getByRole("button", { name: "Erase progress" }).click();
  await expect(dialog.getByText("Progress reset.")).toBeVisible();
});

test("Start over sends one lesson back to step 1 with its gates closed again", async ({ page }) => {
  page.on("dialog", () => {
    throw new Error("a browser dialog opened");
  });
  await page.goto(LESSON);
  await continueTo(page, 5);
  await skip(page).click();
  await expect(steps(page)).toHaveCount(6);

  // Cancel keeps everything.
  await page.getByRole("button", { name: "Start over" }).click();
  const dialog = page.getByRole("dialog", { name: "Start this lesson over" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(steps(page)).toHaveCount(6);

  await page.getByRole("button", { name: "Start over" }).click();
  await dialog.getByRole("button", { name: "Start over" }).click();
  await expect(steps(page)).toHaveCount(1);
  await expect(page.getByText(`Step 1 of ${STEPS}`)).toBeVisible();
  // The skipped goal is forgotten: step 5 gates Continue again.
  await continueTo(page, 5);
  await expect(cont(page)).toHaveAttribute("aria-disabled", "true");
  // A reload opens at the new position, not the old one.
  await page.reload();
  await expect(steps(page)).toHaveCount(5);
});

test("phone width puts visuals inline in their steps", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LESSON);
  await reviewMode(page);
  await expect(page.locator(".pane")).toHaveCount(0);
  await expect(page.locator('[data-step-id="2-the-steady-state-1"] img[alt="Toy diagram"]')).toBeVisible();
  await expect(page.locator('[data-step-id="2-the-steady-state-2"] .widget-slot[data-widget="toy-steady-state-explorer"]')).toBeAttached();
});

test("search finds a note from the header", async ({ page }) => {
  await page.goto("#/");
  await page.getByRole("combobox", { name: "Search notes" }).fill("toy prod");
  await page.getByRole("option", { name: /Toy Production Function/ }).click();
  await expect(page).toHaveURL(/#\/note\/toy-production-function$/);
  await expect(page.locator(".note-title")).toHaveText("Toy Production Function");
});
