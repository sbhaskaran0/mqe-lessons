// A precomputed data-chart on the fixture vault (Toy Bandwidth Lookup, placed in the concept note Toy Kernel
// Smoothing): moving a slider redraws the looked-up rows, the probe moves by the keyboard, the labelled kernel is a
// radio group, the goal (which reads at()) is met, and the two panels sit side by side when there is room.
import { expect, test, type Page } from "@playwright/test";
import { watchProblems } from "./util";

const NOTE = "#/note/toy-kernel-smoothing";
const widget = (page: Page) => page.locator(".w-root").filter({ has: page.locator('[data-panel="density"]') });
/** The note, continued to its "Try it" step, whose widget then shows (in the visual pane, or inline on a phone). */
async function open(page: Page) {
  await page.goto(NOTE);
  const tryIt = page.locator('.lesson-main [data-step-id^="try-it"]');
  while (!(await tryIt.count())) await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(widget(page).locator('[data-panel="error"] .w-plot')).toBeVisible();
}
const kde = (page: Page) => widget(page).locator('[data-el="kde"] path.w-curve');

test("a slider move redraws the rows; the probe, the kernel choice and the goal work by keyboard and click", async ({ page }) => {
  const problems = watchProblems(page);
  await open(page);
  const w = widget(page);
  await expect(kde(page)).toBeVisible();
  await expect(w.locator('[data-el="rug"] line')).toHaveCount(5);
  await expect(w.locator('[data-el="hist"] rect')).toHaveCount(4);

  const before = await kde(page).getAttribute("d");
  const h = w.locator('[data-param="h"] input[type="range"]');
  await h.focus();
  await page.keyboard.press("ArrowRight");
  await expect(h).toHaveValue("1");
  await expect.poll(() => kde(page).getAttribute("d")).not.toBe(before);
  await expect(w.locator('[data-readout="ise_now"] output')).toHaveText("0.030");

  const kernel = w.getByRole("radiogroup", { name: "Kernel" });
  await expect(kernel.getByRole("radio", { name: "Gaussian" })).toHaveAttribute("aria-checked", "true");
  const atH1 = await kde(page).getAttribute("d");
  await kernel.getByRole("radio", { name: "Box" }).click();
  await expect(kernel.getByRole("radio", { name: "Box" })).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => kde(page).getAttribute("d")).not.toBe(atH1);
  await expect(w.locator('[data-readout="ise_now"] output')).toHaveText("0.020");
  await expect(w.getByText("That is the smallest error")).toHaveCount(0);

  const probe = w.locator('[data-handle="probe"]');
  await probe.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(probe).toHaveAttribute("aria-valuetext", "Probe x 2.0, Probe y 0.10");
  await expect(w.getByText("That is the smallest error")).toBeVisible();
  expect(problems.list).toEqual([]);
});

test("the panels sit side by side in a wide widget and stack in a narrow one", async ({ page }) => {
  for (const width of [1920, 1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    const w = widget(page);
    const room = (await w.boundingBox())!.width;
    const a = (await w.locator('[data-panel="density"]').boundingBox())!;
    const b = (await w.locator('[data-panel="error"]').boundingBox())!;
    if (room >= 660) expect(Math.abs(a.y - b.y), `side by side at ${width}px`).toBeLessThan(2);
    else expect(b.y, `stacked at ${width}px`).toBeGreaterThanOrEqual(a.y + a.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});
