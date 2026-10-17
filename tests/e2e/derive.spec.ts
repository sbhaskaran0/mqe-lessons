// The derivation exercise on the fixture vault: Toy 101 L1 §5 "Solve for the steady state" has a justify step, one
// typed step (the target) and a hint. Runs on the fixture server (baseURL http://127.0.0.1:4318/); the `fixture`
// project in playwright.config.ts has to match this file.
import { expect, test, type Page } from "@playwright/test";
import { reviewMode, watchProblems } from "./util";

const SLUG = "toy-101-l1-growth";
const STEP = "5-deriving-the-steady-state-2";
const KEY = `${SLUG}#${STEP}#0`;
const TARGET = "kbar = (sA/δ)^(1/(1−α))";

const cont = (page: Page) => page.getByRole("button", { name: "Continue", exact: true });
const derive = (page: Page) => page.locator(`[data-step-id="${STEP}"] .derive`);
const stored = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem("mqe-lessons/progress/1") ?? "{}").derives?.[k], KEY);

async function open(page: Page) {
  await page.goto(`#/lesson/${SLUG}?at=${STEP}`);
  await expect(derive(page)).toBeVisible();
  // The checker loads on demand: wait for the input it brings.
  await expect(derive(page).getByLabel("Your next line")).toBeVisible();
}

test.describe.configure({ mode: "parallel" });

test("the derive step gates Continue; typing the target and answering the question finishes it", async ({ page }) => {
  const problems = watchProblems(page);
  await open(page);
  await expect(cont(page)).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("Finish the derivation to continue, or skip it.")).toBeVisible();

  const d = derive(page);
  const input = d.getByLabel("Your next line");
  // Live preview while typing, and a readable error for an unknown symbol.
  await input.fill(TARGET);
  await expect(d.locator(".derive-preview")).toContainText("I read this as");
  await input.fill("kbar = q");
  await expect(d.locator(".derive-preview")).toContainText("Not readable yet");

  // The target alone does not finish it: the justify question is still open.
  await input.fill(TARGET);
  await input.press("Enter");
  await expect(d.locator(".derive-verdict")).toContainText("Answer the question above to finish");
  await expect(d.locator(".derive-verdict")).toBeFocused();
  await expect(cont(page)).toHaveAttribute("aria-disabled", "true");
  expect((await stored(page)).result).toBe("open");

  const question = d.getByRole("form", { name: "Question for step 1" });
  await question.getByRole("radio").first().check();
  await question.getByRole("button", { name: "Check answer" }).click();
  await expect(question.getByRole("status")).toContainText("Not quite");
  await question.getByRole("radio").nth(1).check();
  await question.getByRole("button", { name: "Check answer" }).click();

  await expect(d.getByText("Derivation complete.")).toBeVisible();
  await expect(d.getByRole("list", { name: "Worked derivation" })).toBeVisible();
  await expect(d.getByLabel("Your next line")).toHaveCount(0);
  await expect(cont(page)).not.toHaveAttribute("aria-disabled", "true");
  expect(await stored(page)).toMatchObject({ result: "done", justified: [0], state: { done: true } });

  // It survives a reload.
  await page.reload();
  await expect(derive(page).getByText("Derivation complete.")).toBeVisible();
  expect(problems.list).toEqual([]);
});

test("a wrong line shows the author's message; Step by step names the step and offers the hint", async ({ page }) => {
  await open(page);
  const d = derive(page);
  await d.getByLabel("Your next line").fill("kbar = (sA/δ)^(1/α)");
  await d.getByRole("button", { name: "Check line" }).click();
  await expect(d.locator(".derive-verdict")).toContainText("dividing by");

  await d.getByRole("checkbox", { name: "Step by step" }).check();
  const next = d.locator(".derive-next");
  // Step 1 is the justify question, which comes first.
  await expect(next).toContainText("Answer the question above");
  const question = d.getByRole("form", { name: "Question for step 1" });
  await question.getByRole("radio").nth(1).check();
  await question.getByRole("button", { name: "Check answer" }).click();
  await expect(next).toContainText("Take the");
  await next.getByRole("button", { name: "Show hint" }).click();
  await expect(next).toContainText("Raise both sides to the same power");
  expect((await stored(page)).hints).toBe(1);
});

test("Show worked derivation gives up and opens the gate", async ({ page }) => {
  await open(page);
  const d = derive(page);
  await d.getByRole("button", { name: "Show worked derivation" }).click();
  await expect(d.getByRole("heading", { name: "Worked derivation" })).toBeFocused();
  await expect(d.getByRole("list", { name: "Worked derivation" })).toBeVisible();
  await expect(cont(page)).not.toHaveAttribute("aria-disabled", "true");
  expect((await stored(page)).result).toBe("gave-up");
});

test("Skip opens the gate, and the derivation stays answerable afterwards", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  expect((await stored(page)).result).toBe("skipped");
  const d = derive(page);
  await expect(d.getByText("Skipped")).toBeVisible();
  await expect(d.getByLabel("Your next line")).toBeVisible();
});

test("Review mode shows the worked derivation without the input", async ({ page }) => {
  await page.goto(`#/lesson/${SLUG}`);
  await reviewMode(page);
  const d = derive(page);
  await d.scrollIntoViewIfNeeded();
  await expect(d.getByRole("list", { name: "Worked derivation" })).toBeVisible();
  await expect(d.getByLabel("Your next line")).toHaveCount(0);
});
