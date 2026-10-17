// Screenshots for review (npm run screens): desktop 1280x800 and phone 390x844, saved to test-results/screens/.
// Progress is seeded so lessons open mid-way, the way a returning reader sees them.
import { test, type Page } from "@playwright/test";
import path from "node:path";
import { REPO } from "../helpers";

const OUT = path.join(REPO, "test-results", "screens");
const FIXTURE = "http://127.0.0.1:4318/";
const SIZES = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
] as const;

type Seed = { slug: string; total: number; furthest: number; stepId: string };

async function seed(page: Page, s: Seed) {
  await page.addInitScript((s: Seed) => {
    const progress = {
      version: 1,
      steps: {},
      notes: { [s.slug]: { total: s.total, seen: s.furthest + 1, furthest: s.furthest, at: Date.now() } },
      checks: {},
      checkpoints: {},
      last: { slug: s.slug, stepId: s.stepId, at: Date.now() },
    };
    localStorage.setItem("mqe-lessons/progress/1", JSON.stringify(progress));
  }, s);
}

async function shot(page: Page, name: string, size: (typeof SIZES)[number]) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500); // let reveal and pane transitions finish
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

test.describe.configure({ mode: "serial" });

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });

    test(`home ${size.name}`, async ({ page }) => {
      await seed(page, { slug: "econ-402a-l1-solow-growth-model", total: 26, furthest: 9, stepId: "7-dynamics-1" });
      await page.goto("#/");
      await shot(page, "home", size);
    });

    test(`solow lesson mid-way ${size.name}`, async ({ page }) => {
      await seed(page, { slug: "econ-402a-l1-solow-growth-model", total: 26, furthest: 8, stepId: "5-investment-vs-depreciation-1" });
      await page.goto("#/lesson/econ-402a-l1-solow-growth-model");
      await page.locator('[data-step-id="5-investment-vs-depreciation-1"]').waitFor();
      if (size.name === "phone") {
        await page.locator('[data-step-id="5-investment-vs-depreciation-1"] .figure').scrollIntoViewIfNeeded();
      }
      await shot(page, "lesson-solow", size);
    });

    test(`solow diagram note ${size.name}`, async ({ page }) => {
      await seed(page, { slug: "solow-diagram", total: 13, furthest: 2, stepId: "definition-1" });
      await page.goto("#/note/solow-diagram");
      await page.locator('[data-step-id="definition-1"]').waitFor();
      await shot(page, "note-solow-diagram", size);
    });

    test(`library ${size.name}`, async ({ page }) => {
      await page.goto("#/library");
      await shot(page, "library", size);
    });

    test(`fixture check step ${size.name}`, async ({ page }) => {
      await seed(page, { slug: "toy-101-l1-growth", total: 12, furthest: 5, stepId: "2-the-steady-state-4" });
      await page.goto(`${FIXTURE}#/lesson/toy-101-l1-growth`);
      const check = page.locator('[data-step-id="2-the-steady-state-4"] .check');
      await check.waitFor();
      await check.scrollIntoViewIfNeeded();
      await shot(page, "fixture-check", size);
      await check.getByText("It doubles").click();
      await check.getByRole("button", { name: "Check answer" }).click();
      await check.locator(".check-why").scrollIntoViewIfNeeded();
      await shot(page, "fixture-check-answered", size);
    });
  });
}

test("extras: deep dive, symbols drawer, dark theme", async ({ page }) => {
  const size = SIZES[0];
  await page.setViewportSize({ width: size.width, height: size.height });
  await seed(page, { slug: "econ-424-l2-between-group-inequality", total: 14, furthest: 4, stepId: "3-the-canonical-model-1" });
  await page.goto("#/lesson/econ-424-l2-between-group-inequality");
  await page.locator('[data-step-id="3-the-canonical-model-1"]').waitFor();
  await shot(page, "lesson-424-l2", size);
  await page.locator('[data-step-id="3-the-canonical-model-1"] a[data-note="canonical-model-of-the-skill-premium"]').first().click();
  await page.getByRole("dialog", { name: /Deep dive/ }).waitFor();
  await shot(page, "deep-dive", size);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Symbols/ }).click();
  await shot(page, "symbols-drawer", size);
  await page.keyboard.press("Escape");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "lesson-424-l2-dark", size);
});
