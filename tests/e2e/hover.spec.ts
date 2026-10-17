// Symbol hover inside rendered math, on the real export: Econ 402A L1 §6 wraps \bar{k} in display math, prose and
// a checkpoint prompt, and hovering (or, at phone width, tapping) it shows its Notation row.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NoteBody } from "../../src/ir";
import { REPO } from "../helpers";
import { expectNoKatexErrors, watchProblems } from "./util";

const SLUG = "econ-402a-l1-solow-growth-model";
const body = JSON.parse(readFileSync(path.join(REPO, "content", "notes", `${SLUG}.json`), "utf8")) as NoteBody;
const KBAR = body.notation.findIndex((r) => r.keys.includes("bar(k)"));
const ALPHA = body.notation.findIndex((r) => r.keys.includes("alpha"));
const STEP = '[data-step-id="6-the-steady-state-1"]';
const tip = (page: Page) => page.getByRole("tooltip");

test.beforeEach(() => {
  expect(KBAR, "the lecture's Notation defines \\bar{k}").toBeGreaterThanOrEqual(0);
});

test("hovering \\bar{k} in §6 shows its meaning, in display math, prose and a checkpoint", async ({ page }) => {
  test.slow();
  const problems = watchProblems(page);
  await page.goto(`#/lesson/${SLUG}?at=6-the-steady-state-2`);
  const step = page.locator(STEP);
  await expect(step).toBeVisible();

  // Display math.
  const display = step.locator(`.block-math .sym-${KBAR}`).first();
  await display.hover();
  await expect(tip(page)).toBeVisible();
  await expect(tip(page)).toContainText("Steady-state values");
  await expect(tip(page)).toContainText("Endogenous");
  await expect(tip(page)).toContainText("Typical: 25, 5, 2.5 in the example");
  await expect(tip(page)).toContainText("from Solow Growth Model");

  // Moving away closes it; another symbol explains itself.
  await page.mouse.move(5, 5);
  await expect(tip(page)).toBeHidden();
  await step.locator(`.block-prose .sym-${ALPHA}`).first().hover();
  await expect(tip(page)).toContainText(body.notation[ALPHA]!.meaning.split(":")[0]!);

  // Inline math in prose, and in a checkpoint prompt.
  await step.locator(`.block-prose .sym-${KBAR}`).first().hover();
  await expect(tip(page)).toContainText("Steady-state values");
  await page.locator(`[data-step-id="6-the-steady-state-2"] .check-prompt .sym`).first().hover();
  await expect(tip(page)).toBeVisible();

  // The symbol chips explain symbols already, so their math is not wrapped again.
  await expect(step.locator(".symbol-chips .sym")).toHaveCount(0);

  // A click pins it; Escape closes it.
  await display.click();
  await page.mouse.move(5, 5);
  await expect(tip(page)).toContainText("Steady-state values");
  await page.keyboard.press("Escape");
  await expect(tip(page)).toBeHidden();

  await expectNoKatexErrors(page);
  expect(problems.list).toEqual([]);
});

test("symbols explain themselves in the notation drawer and the deep-dive panel", async ({ page }) => {
  await page.goto(`#/lesson/${SLUG}?at=6-the-steady-state-1`);
  await page.getByRole("button", { name: /^Symbols/ }).click();
  const drawer = page.getByRole("dialog", { name: /^Symbols in/ });
  await expect(drawer).toBeVisible();
  // The meaning column of C, S, I holds math of its own: C = (1-s)Y.
  const row = drawer.locator("tbody tr").filter({ hasText: "Consumption, saving, investment" });
  await row.locator("td .sym").first().hover();
  await expect(drawer.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer.getByRole("tooltip")).toBeHidden();
  // The first Escape only closed the tooltip.
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  // A deep dive explains symbols with the opened note's own rows.
  await page.locator(`${STEP} a[data-note="steady-state"]`).first().click();
  const dive = page.getByRole("dialog", { name: /Deep dive/ });
  await expect(dive).toBeVisible();
  const sym = dive.locator(".steps .sym").first();
  if ((await sym.count()) > 0) {
    await sym.hover();
    await expect(dive.getByRole("tooltip")).toBeVisible();
  }
  await expectNoKatexErrors(page);
});

test("tapping \\bar{k} at phone width shows its meaning, and tapping elsewhere closes it @phone", async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto(`#/lesson/${SLUG}?at=6-the-steady-state-1`);
  const target = page.locator(`${STEP} .block-math .sym-${KBAR}`).first();
  await target.scrollIntoViewIfNeeded();
  await target.tap();
  await expect(tip(page)).toBeVisible();
  await expect(tip(page)).toContainText("Steady-state values");
  const box = (await tip(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.locator(`${STEP} .step-heading, ${STEP} .section-heading`).first().tap();
  await expect(tip(page)).toBeHidden();
  await expectNoKatexErrors(page);
  expect(problems.list).toEqual([]);
});
