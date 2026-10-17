// Measures every ```interactive view of the real export in the lesson pane (1280x800 by default) and prints, per
// view, whether the plot, the free sliders and the feedback fit without scrolling the pane. Exits 1 if a free slider
// is out of view or a prediction commit scrolled the pane.
//   node tests/widgets/pane-fit.mjs [--phone] [--png=<dir>]   (needs content/ exported; builds into test-results/pane-fit-dist)
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const phone = process.argv.includes("--phone");
const png = process.argv.find((a) => a.startsWith("--png="))?.slice(6);
process.env.MQE_OUT = path.join(REPO, "test-results", "pane-fit-dist"); // rebuilt (and emptied) each run
delete process.env.MQE_CONTENT;
await build({ root: REPO, logLevel: "error" });
const server = await preview({ root: REPO, preview: { port: 4399, strictPort: false, host: "127.0.0.1" }, logLevel: "error" });
const base = `http://127.0.0.1:${server.config.preview.port}/`;

const views = [];
for (const f of readdirSync(path.join(REPO, "content", "notes")).sort()) {
  const body = JSON.parse(readFileSync(path.join(REPO, "content", "notes", f), "utf8"));
  for (const s of body.sections) for (const st of s.steps) for (const b of st.blocks) {
    if (b.t === "interactive" && !(Object.keys(b).length === 2)) views.push({ slug: body.slug, step: st.id, block: b });
  }
}

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
if (only) views.splice(0, views.length, ...views.filter((v) => v.step.includes(only)));
const browser = await chromium.launch();
const contextOptions = phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 800 } };
let page; // a fresh context per view: saved progress would resume the lesson somewhere else
const rows = [];
let bad = 0;

const measure = () =>
  page.evaluate(() => {
    const root = document.querySelector(".widget-slot .w-root, .widget-inline .w-root");
    const pane = document.querySelector(".pane-sticky");
    if (!root) return null;
    const r = root.getBoundingClientRect();
    const scroller = pane ?? document.scrollingElement;
    const pb = pane ? pane.getBoundingClientRect().bottom : window.innerHeight;
    const free = [...root.querySelectorAll(".w-params input[type=range]")].map((i) => i.getBoundingClientRect().bottom);
    const plots = [...root.querySelectorAll(".w-plot")].map((p) => p.getBoundingClientRect());
    const fb = root.querySelector(".w-feedback")?.getBoundingClientRect();
    return {
      paneBottom: Math.round(pb),
      paneTop: pane ? Math.round(pane.getBoundingClientRect().top) : 0,
      rootBottom: Math.round(r.bottom),
      overflow: Math.round(scroller.scrollHeight - scroller.clientHeight),
      scrollTop: Math.round(scroller.scrollTop),
      freeCount: free.length,
      freeBottom: free.length ? Math.round(Math.max(...free)) : null,
      chips: root.querySelectorAll(".w-chip").length,
      plotH: plots.map((p) => Math.round(p.height)),
      plotTop: plots.length ? Math.round(plots[0].top) : null,
      feedbackBottom: fb ? Math.round(fb.bottom) : null,
      locked: [...root.querySelectorAll(".w-chip")].length,
      order: [...root.querySelectorAll(".w-plot, .w-params, .w-chips")].map((e) => e.className.split(" ")[0]).filter((c, i, a) => a.indexOf(c) === i).join(">"),
    };
  });

/** Open the lesson in Review mode (every step present) and scroll to the step until it is the active one. */
async function open(v) {
  await page?.context().close();
  page = await (await browser.newContext(contextOptions)).newPage();
  await page.goto(`${base}#/lesson/${v.slug}`);
  const sw = page.getByRole("switch", { name: "Review mode" });
  await sw.waitFor();
  if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
  const step = page.locator(`[data-step-id="${v.step}"]`);
  await step.waitFor();
  await step.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.locator(`[data-step-id="${v.step}"][data-active="true"]`).waitFor({ timeout: 8000 });
}

for (const v of views) {
  let widget;
  try {
    await open(v);
    widget = page.locator(`.widget-slot[data-widget="${v.block.widget}"] .w-root:not(.w-skeleton)`).first();
    await widget.waitFor({ timeout: 8000 });
  } catch {
    rows.push({ view: `${v.slug}#${v.step}`, note: "no widget shown" });
    continue;
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  const row = { view: `${v.block.widget} @ ${v.slug.slice(0, 22)}#${v.step.slice(0, 26)}` };
  const a = await measure();
  Object.assign(row, { state: v.block.predict ? "ask" : v.block.goal ? "goal" : "view", ...a });
  rows.push(row);
  if (png) await page.screenshot({ path: path.join(png, `${v.block.widget}-${v.step}.png`.replace(/[^\w.-]/g, "_")) });
  if (v.block.predict && v.block.predict.options) {
    const before = a.scrollTop;
    try {
      await widget.getByRole("radio").first().click({ timeout: 4000 });
      await widget.getByRole("button", { name: "Commit prediction" }).click({ timeout: 4000 });
    } catch {
      rows.push({ view: `${v.block.widget}#${v.step}`, note: "could not commit the prediction (it was not asking)" });
      if (png) await page.screenshot({ path: path.join(png, `FAIL-${v.step}.png`.replace(/[^\w.-]/g, "_")) });
      continue;
    }
    await page.waitForTimeout(900);
    const b = await measure();
    if (!b) {
      rows.push({ view: `${v.block.widget}#${v.step}`, note: "the widget disappeared after the commit" });
      if (png) await page.screenshot({ path: path.join(png, `GONE-${v.step}.png`.replace(/[^\w.-]/g, "_")) });
      continue;
    }
    rows.push({ view: "  after commit", state: "revealed", ...b, jumped: b.scrollTop !== before || b.plotTop < b.paneTop });
    if (b.scrollTop !== before || b.plotTop < b.paneTop) bad++;
    if (png) await page.screenshot({ path: path.join(png, `${v.block.widget}-${v.step}-revealed.png`.replace(/[^\w.-]/g, "_")) });
  }
}

const fmt = (r) =>
  r.note
    ? `${r.view}: ${r.note}`
    : [r.view.padEnd(62), String(r.state).padEnd(8), `plot ${r.plotH.join("+")}`.padEnd(11), `free ${r.freeCount}`.padEnd(7), `chips ${r.chips}`.padEnd(8), `slider-bottom ${r.freeBottom ?? "-"}`.padEnd(19), `pane-bottom ${r.paneBottom}`.padEnd(16), `overflow ${r.overflow}`.padEnd(12), `scrollTop ${r.scrollTop}`.padEnd(12), r.order, r.freeBottom !== null && r.freeBottom > r.paneBottom ? "  <-- HIDDEN" : "", r.jumped ? "  <-- PANE JUMPED" : ""].join(" ");
for (const r of rows) {
  console.log(fmt(r));
  if (r.freeBottom !== null && r.freeBottom !== undefined && r.freeBottom > r.paneBottom) bad++;
}
await browser.close();
server.httpServer.close();
console.log(bad ? `\n${bad} problem(s)` : "\nevery free slider is in view");
process.exit(bad ? 1 : 0);
