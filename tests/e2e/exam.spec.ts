// The mixed exam on the fixture vault (baseURL http://127.0.0.1:4318/; the `fixture` project in playwright.config.ts has to
// match this file). Toy 101 L1 has three checkpoints: a multiple choice (objective 1), a numeric one (objective 2) and
// a varied numeric one with no objective. A short exam is set up, sat with confidence ratings, finished and read back.
import { expect, test, type Page } from "@playwright/test";
import { expectNoSidewaysScroll, watchProblems } from "./util";

const SLUG = "toy-101-l1-growth";
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("mqe-lessons/progress/1") ?? "{}"));

/** Opens the lecture, so it counts as started and is ticked on the setup screen. */
async function startedLecture(page: Page) {
  await page.goto(`#/lesson/${SLUG}`);
  await expect(page.locator(".lesson-main [data-step-id]").first()).toBeVisible();
  await page.goto("#/exam");
}

/** Answers the question on screen: the first option of a multiple choice, a wrong number otherwise. */
async function answer(page: Page, level: string) {
  await page.getByRole("button", { name: level, exact: true }).click();
  const input = page.getByLabel("Your answer");
  if (await input.count()) await input.fill("1");
  else await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: /Next question|Finish exam/ }).click();
}

async function sitExam(page: Page, shots: string) {
  await expect(page.getByLabel(/Growth in a Toy Economy/)).toBeChecked();
  await page.screenshot({ path: `test-results/exam/${shots}-setup.png`, fullPage: true });
  await page.getByLabel("Number of questions").fill("3");
  await page.getByRole("button", { name: "Start exam" }).click();
  await expect(page.getByRole("heading", { name: "Question 1 of 3" })).toBeFocused();
  // Held back: no verdict, no explanation, a confidence prompt.
  await expect(page.getByText("How sure are you?")).toBeVisible();
  await expect(page.locator(".check-why, .check-verdict")).toHaveCount(0);
  await page.screenshot({ path: `test-results/exam/${shots}-progress.png`, fullPage: true });
  await answer(page, "Sure");
  await expect(page.getByRole("heading", { name: "Question 2 of 3" })).toBeVisible();
  await expect(page.locator(".check-why")).toHaveCount(0);
  await answer(page, "Guessing");
  await expect(page.getByRole("heading", { name: "Question 3 of 3" })).toBeVisible();
  await answer(page, "Fairly sure");
  await expect(page.getByRole("heading", { name: "Exam results" })).toBeVisible();
}

test("a short exam: set up, sit, finish, read the breakdown", async ({ page }) => {
  const problems = watchProblems(page);
  await startedLecture(page);
  const before = (await stored(page)).checks ?? {};
  await sitExam(page, "desktop");

  await expect(page.getByRole("status")).toContainText(/of 3 right/);
  await expect(page.locator(".exam-result")).toHaveCount(3);
  await expect(page.locator(".exam-result .check-why")).toHaveCount(3);
  await expect(page.locator(".exam-result").first().getByRole("link", { name: /Open in the lecture/ })).toHaveAttribute("href", new RegExp(`#/lesson/${SLUG}\\?at=`));
  const objectives = page.locator(".exam-objectives");
  await expect(objectives).toContainText("Growth in a Toy Economy");
  await expect(objectives).toContainText("Explain why a higher saving rate raises the level");
  await expect(objectives).toContainText("Derive the steady state");
  await expect(objectives).toContainText("Untagged");
  await page.screenshot({ path: "test-results/exam/desktop-results.png", fullPage: true });

  const data = await stored(page);
  expect(data.exams).toHaveLength(1);
  expect(data.exams[0].items).toHaveLength(3);
  expect(data.exams[0].finishedAt).toBeGreaterThan(0);
  expect(Object.values(data.confidence).flat().map((r) => (r as { level: number }).level).sort()).toEqual([1, 2, 3]);
  // Lesson results are untouched by the exam.
  expect(data.checks ?? {}).toEqual(before);

  // The results survive a reload, and the setup screen lists the exam.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Exam results" })).toBeVisible();
  await page.getByRole("link", { name: "New exam" }).click();
  await expect(page.getByRole("heading", { name: "Past exams" })).toBeVisible();
  expect(problems.list).toEqual([]);
});

test("an exam in progress survives a reload, and the progress page links to it", async ({ page }) => {
  await startedLecture(page);
  await page.getByLabel("Number of questions").fill("3");
  await page.getByRole("button", { name: "Start exam" }).click();
  await expect(page.getByRole("heading", { name: "Question 1 of 3" })).toBeVisible();
  const prompt = await page.locator(".exam-card .check-prompt").textContent();
  await answer(page, "Sure");
  await expect(page.getByRole("heading", { name: "Question 2 of 3" })).toBeVisible();
  const second = await page.locator(".exam-card .check-prompt").textContent();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Question 2 of 3" })).toBeVisible();
  await expect(page.locator(".exam-card .check-prompt")).toHaveText(second!);
  expect(second).not.toBe(prompt);
  await page.goto("#/progress");
  await expect(page.getByRole("link", { name: /Mixed exams taken/ })).toContainText("Resume your exam");
});

test("calibration appears on the progress page once five answers are rated", async ({ page }) => {
  await page.goto("#/progress");
  await expect(page.getByRole("heading", { name: "Your progress" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How sure versus how right" })).toHaveCount(0);
  await page.evaluate(() => {
    const key = "mqe-lessons/progress/1";
    const data = JSON.parse(localStorage.getItem(key) ?? "null") ?? { version: 1, steps: {}, notes: {}, checks: {}, checkpoints: {} };
    data.confidence = { "toy-101-l1-growth#2-the-steady-state-4#0": [3, 3, 3, 1, 2].map((level, i) => ({ level, correct: i !== 2, at: i })) };
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.reload();
  await expect(page.getByText("When you say Sure you are right 67% of the time.")).toBeVisible();
  await page.screenshot({ path: "test-results/exam/desktop-calibration.png", fullPage: true });
});

test("the exam fits a phone @phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startedLecture(page);
  await expectNoSidewaysScroll(page);
  await sitExam(page, "phone");
  await expectNoSidewaysScroll(page);
  await page.screenshot({ path: "test-results/exam/phone-results.png", fullPage: true });
});
