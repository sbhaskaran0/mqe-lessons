// Spaced review on the fixture vault (baseURL http://127.0.0.1:4318/; the `fixture` project in playwright.config.ts has to
// match this file): a check answered wrong in the lesson is retried, comes back the next day on #/review, shown
// unanswered, and a right answer there reschedules it without touching the lesson's record. The clock is Date only
// (page.clock.setFixedTime), so the app's timers and animations still run.
import { expect, test, type Page } from "@playwright/test";
import { expectNoSidewaysScroll, watchProblems } from "./util";

const SLUG = "toy-101-l1-growth";
const STEP = "2-the-steady-state-4";
const KEY = `${SLUG}#${STEP}#0`;
const day = (d: number, h = 10) => new Date(2026, 9, d, h, 0);
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("mqe-lessons/progress/1") ?? "{}"));

/** In the lesson at the multiple-choice check, answer it wrong. */
async function missTheCheck(page: Page) {
  await page.goto(`#/lesson/${SLUG}?at=${STEP}`);
  const mcq = page.locator(`[data-step-id="${STEP}"] .check`);
  await mcq.getByText("It doubles").click();
  await mcq.getByRole("button", { name: "Check answer" }).click();
  await expect(mcq.getByText("Not quite.")).toBeVisible();
  return mcq;
}

test.describe.configure({ mode: "parallel" });

test("a missed check can be retried, then comes back next day on #/review and is answered right", async ({ page }) => {
  const problems = watchProblems(page);
  await page.clock.setFixedTime(day(16));
  const mcq = await missTheCheck(page);

  // F1: Try again clears the answer and hides the verdict and the why; a right second answer is final.
  await mcq.getByRole("button", { name: "Try again" }).click();
  await expect(mcq.getByText("Not quite.")).toHaveCount(0);
  await expect(mcq.locator(".check-why")).toHaveCount(0);
  await expect(mcq.getByLabel("It doubles")).not.toBeChecked();
  await expect(mcq.getByLabel("It doubles")).toBeFocused();
  await mcq.getByText("It is unchanged").click();
  await mcq.getByRole("button", { name: "Check answer" }).click();
  await expect(mcq.getByText("Correct.")).toBeVisible();
  await expect(mcq.getByRole("button", { name: "Try again" })).toHaveCount(0);
  let data = await stored(page);
  expect(data.checks[KEY]).toMatchObject({ result: "correct", firstTry: "incorrect", tries: 2 });
  // The miss is on the schedule from the first wrong answer; the retry does not take it off.
  const tomorrow = day(17, 0).getTime();
  expect(data.leitner[KEY]).toMatchObject({ box: 1, due: tomorrow, lapses: 0 });

  // Today: nothing is due, and the page says when something is.
  await page.goto("#/review");
  await expect(page.getByRole("heading", { name: "Nothing due" })).toBeVisible();
  await expect(page.getByText("tomorrow")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Review" })).toBeVisible();
  await expect(page.locator(".nav-badge")).toHaveCount(0);

  // Tomorrow morning: one item is due, with a badge in the header and an entry on the dashboard.
  await page.clock.setFixedTime(day(17, 9));
  await page.reload();
  await expect(page.locator(".nav-badge")).toHaveText("1");
  await expect(page.getByRole("heading", { name: "Due today" })).toBeVisible();
  const card = page.locator(".review-card");
  await expect(card).toHaveCount(1);
  await expect(card.getByText("If the saving rate doubles", { exact: false })).toBeVisible();
  // Shown unanswered, although the lesson has a right answer on record.
  await expect(card.getByRole("status")).toBeEmpty();
  await expect(card.getByLabel("It is unchanged")).not.toBeChecked();
  await expect(card.getByRole("link", { name: /Open in the lecture/ })).toHaveAttribute("href", `#/lesson/${SLUG}?at=${STEP}`);

  await page.screenshot({ path: "test-results/review/review-desktop.png", fullPage: true });
  await card.getByText("It is unchanged").click();
  await card.getByRole("button", { name: "Check answer" }).click();
  await expect(card.getByText("Correct.")).toBeVisible();
  await expect(card.getByRole("status")).toBeFocused();
  await expect(card.getByText("Back in 3 days")).toBeVisible();
  await expect(page.getByText("Done for today: 1 of 1 right.")).toBeVisible();
  await page.screenshot({ path: "test-results/review/review-done-desktop.png", fullPage: true });

  data = await stored(page);
  expect(data.leitner[KEY]).toMatchObject({ box: 2, due: day(20, 0).getTime(), lapses: 0 });
  // The review did not touch what the lesson recorded.
  expect(data.checks[KEY]).toMatchObject({ result: "correct", firstTry: "incorrect", tries: 2 });

  // Reloading finds nothing due; the dashboard links to the review.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Nothing due" })).toBeVisible();
  await expect(page.getByText("in 3 days")).toBeVisible();
  await page.goto("#/progress");
  const due = page.getByRole("link", { name: /Due today/ });
  await expect(due).toContainText("0");
  await due.click();
  await expect(page).toHaveURL(/#\/review$/);
  expect(problems.list).toEqual([]);
});

test("a wrong answer on review starts the item over at box 1 with a lapse", async ({ page }) => {
  await page.clock.setFixedTime(day(16));
  await missTheCheck(page);
  await page.clock.setFixedTime(day(17, 9));
  await page.goto("#/review");
  await page.reload();
  const card = page.locator(".review-card");
  await card.getByText("It falls to zero").click();
  await card.getByRole("button", { name: "Check answer" }).click();
  await expect(card.getByText("Not quite.")).toBeVisible();
  await expect(card.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(card.getByText("Not yet. Back tomorrow.")).toBeVisible();
  const data = await stored(page);
  expect(data.leitner[KEY]).toMatchObject({ box: 1, due: day(18, 0).getTime(), lapses: 1 });
  expect(data.checks[KEY]).toMatchObject({ result: "incorrect", tries: 1 });
});

test("the review page fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(day(16));
  await missTheCheck(page);
  await page.clock.setFixedTime(day(17, 9));
  await page.goto("#/review");
  await page.reload();
  await expect(page.locator(".review-card .check")).toBeVisible();
  await expectNoSidewaysScroll(page);
  await page.screenshot({ path: "test-results/review/review-phone.png", fullPage: true });
  // The Review link folds into the menu with its badge.
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Review/ })).toBeVisible();
  await page.screenshot({ path: "test-results/review/review-phone-menu.png" });
});
