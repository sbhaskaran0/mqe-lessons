// Screenshots of the Phase 4 learning features for review (npx playwright test --project=learning-screens), desktop
// 1280x800 and phone 390x844, saved to test-results/screens/: a practice set mid-way, the progress dashboard with
// something to review, and the \bar{k} hover in Econ 402A L1 §6.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NoteBody } from "../../src/ir";
import { REPO } from "../helpers";

const OUT = path.join(REPO, "test-results", "screens");
const SIZES = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
] as const;
const SET = "econ-430-l1-practice-questions";
const LECTURE = "econ-402a-l1-solow-growth-model";
const solow = JSON.parse(readFileSync(path.join(REPO, "content", "notes", `${LECTURE}.json`), "utf8")) as NoteBody;
const KBAR = solow.notation.findIndex((r) => r.keys.includes("bar(k)"));

/** A returning learner: part of Econ 402A L1 read, one checkpoint wrong and one skipped, some practice graded. */
async function seed(page: Page) {
  await page.addInitScript(
    ({ set, lecture }) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      const now = Date.now();
      const h = 3_600_000;
      const steps: Record<string, number> = {};
      ["intro-1", "intro-2", "1-goal-and-assumptions-1", "1-goal-and-assumptions-2", "2-capital-accumulation-1", "3-per-worker-units-1"].forEach((id, i) => {
        steps[`${lecture}#${id}`] = now - 5 * h + i * 60_000;
      });
      const progress = {
        version: 1,
        steps,
        notes: { [lecture]: { total: 50, seen: 6, furthest: 12, at: now - 2 * h } },
        checks: {
          [`${lecture}#6-the-steady-state-2#0`]: { result: "incorrect", answer: 2.1, tries: 1, at: now - 2 * h },
          [`${lecture}#4-a-worked-example-2#0`]: { result: "skipped", tries: 0, at: now - 3 * h },
          [`${lecture}#1-goal-and-assumptions-2#0`]: { result: "correct", answer: [1], tries: 1, at: now - 4 * h },
        },
        checkpoints: {},
        practice: {
          [`${set}#practice-q1`]: { grade: "got", first: "got", at: now - 50 * 60_000 },
          [`${set}#practice-q2`]: { grade: "notyet", first: "notyet", at: now - 45 * 60_000 },
          [`${set}#practice-q8`]: { grade: "notyet", first: "notyet", at: now - 40 * 60_000 },
        },
        last: { slug: lecture, stepId: "3-per-worker-units-1", at: now - 2 * h },
      };
      localStorage.setItem("mqe-lessons/progress/1", JSON.stringify(progress));
    },
    { set: SET, lecture: LECTURE },
  );
}

async function shot(page: Page, name: string, size: (typeof SIZES)[number]) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 1,
      ...(size.name === "phone" ? { isMobile: true, hasTouch: true } : {}),
    });

    test(`practice set ${size.name}`, async ({ page }) => {
      await seed(page);
      await page.goto(`#/practice/${SET}`);
      const q3 = page.locator('[data-practice-id="q3"]');
      const reveal = q3.getByRole("button", { name: "Show answer" });
      if (size.name === "phone") await reveal.tap();
      else await reveal.click();
      await expect(q3.getByRole("region", { name: /Worked answer/ })).toBeVisible();
      // Desktop shows the set's head and the first questions; the phone shows a revealed answer and the grading.
      if (size.name === "phone") await q3.locator(".pq-actions").scrollIntoViewIfNeeded();
      else await page.locator('[data-practice-id="q2"]').scrollIntoViewIfNeeded();
      await shot(page, "practice-430", size);
    });

    test(`progress dashboard ${size.name}`, async ({ page }) => {
      await seed(page);
      await page.goto("#/progress");
      await expect(page.locator(".review-item-prompt").first()).toBeVisible();
      await shot(page, "progress-dashboard", size);
    });

    test(`hover kbar ${size.name}`, async ({ page }) => {
      await page.goto(`#/lesson/${LECTURE}?at=6-the-steady-state-1`);
      const target = page.locator(`[data-step-id="6-the-steady-state-1"] .block-math .sym-${KBAR}`).first();
      await target.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -160));
      if (size.name === "phone") await target.tap();
      else await target.hover();
      await expect(page.getByRole("tooltip")).toContainText("Steady-state values");
      await shot(page, "hover-kbar", size);
    });
  });
}
