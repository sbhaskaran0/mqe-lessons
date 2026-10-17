// Shared e2e helpers: collect everything that counts as a broken page while a test runs.
import { expect, type Page } from "@playwright/test";

export type Problems = { list: string[] };

/** Console errors, uncaught exceptions, failed requests and HTTP errors, as readable lines. */
export function watchProblems(page: Page): Problems {
  const problems: Problems = { list: [] };
  page.on("console", (m) => {
    if (m.type() === "error") problems.list.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.list.push(`uncaught: ${e.message}`));
  page.on("requestfailed", (r) => {
    // A navigation away from a page aborts its in-flight image loads; that is not a broken asset.
    if (r.failure()?.errorText !== "net::ERR_ABORTED") problems.list.push(`request failed: ${r.url()} (${r.failure()?.errorText})`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) problems.list.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  return problems;
}

export async function expectNoKatexErrors(page: Page): Promise<void> {
  const bad = await page.locator(".katex-error").evaluateAll((els) => els.map((e) => `${e.getAttribute("title") ?? ""} :: ${e.textContent ?? ""}`));
  expect(bad, "KaTeX could not render").toEqual([]);
}

/** Turn Review mode on (every step shown) if the page has the switch and it is off. */
export async function reviewMode(page: Page, on = true): Promise<void> {
  const sw = page.getByRole("switch", { name: "Review mode" });
  await expect(sw).toBeVisible();
  if ((await sw.getAttribute("aria-checked")) !== String(on)) await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", String(on));
}

/** Phone width: the page, and every open dialog, must fit the viewport. A nowrap button wider than the screen makes
 *  the whole page scroll sideways, and on a phone nothing says why. */
export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "the page scrolls sideways").toBeLessThanOrEqual(width);
  const dialogs = await page.evaluate(() => [...document.querySelectorAll("dialog[open]")].map((d) => [d.scrollWidth, d.clientWidth]));
  for (const [scroll, client] of dialogs) expect(scroll, "a dialog scrolls sideways").toBeLessThanOrEqual(client!);
}
