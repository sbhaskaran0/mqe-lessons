// Screenshots of the map and the library facets (npx playwright test --project=map-screens), at desktop 1280x800
// and phone 390x844, saved to test-results/screens/. Some notes are seeded as started or finished so the
// progress rings and the progress facet have something to show.
import { test, type Page } from "@playwright/test";
import path from "node:path";
import { REPO } from "../helpers";

const OUT = path.join(REPO, "test-results", "screens");
const SIZES = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
] as const;

const SEEDED: [slug: string, seen: number, total: number][] = [
  ["cobb-douglas-production-function", 8, 8],
  ["steady-state", 6, 6],
  ["capital-accumulation-equation", 5, 5],
  ["solow-growth-model", 9, 26],
  ["balanced-growth-path", 2, 9],
  ["ols-estimator", 7, 7],
  ["homoskedasticity", 3, 8],
];

async function seed(page: Page) {
  await page.addInitScript((seeded) => {
    const notes = Object.fromEntries(seeded.map(([slug, seen, total]) => [slug, { total, seen, furthest: seen - 1, at: Date.now() }]));
    localStorage.setItem("mqe-lessons/progress/1", JSON.stringify({ version: 1, steps: {}, notes, checks: {}, checkpoints: {} }));
  }, SEEDED);
}

async function shot(page: Page, name: string, size: (typeof SIZES)[number]) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700); // let the pan animation settle
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

test.describe.configure({ mode: "serial" });

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });

    test(`map ${size.name}`, async ({ page }) => {
      await seed(page);
      await page.goto("#/map");
      await page.locator(".map-node, .map-list-item").first().waitFor();
      await shot(page, "map", size);
    });

    test(`map selected ${size.name}`, async ({ page }) => {
      await seed(page);
      await page.goto("#/map?course=Econ+402A&node=solow-growth-model");
      await page.locator(".map-node, .map-list-item").first().waitFor();
      if (size.name === "phone") {
        // The phone's list has no selection; show the map view with its bottom card instead.
        await page.getByRole("radio", { name: "Map" }).click();
        await page.locator(".map-card").waitFor();
      }
      await shot(page, "map-selected", size);
    });

    test(`library facets ${size.name}`, async ({ page }) => {
      await seed(page);
      await page.goto("#/library?type=concept,fact&domain=macroeconomics,econometrics&sort=study");
      await page.locator(".note-card").first().waitFor();
      if (size.name === "phone") await page.getByRole("button", { name: /^Filters/ }).click();
      await shot(page, "library-facets", size);
    });
  });
}
