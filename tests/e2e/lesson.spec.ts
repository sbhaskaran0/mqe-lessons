// One lecture, step by step, for `npm run lesson` (the `lesson` project exists only when MQE_LESSON names a slug).
// Review mode shows every step; for each step that holds an interactive widget or a checkpoint the test brings the step
// into view, waits for its widget to render, and saves a screenshot to test-results/lesson/<slug>/<stepId>.png.
// manifest.json beside them lists each shot with the step's block kinds, for the review-sheet tool.
import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Block, Index, NoteBody } from "../../src/ir";
import { REPO } from "../helpers";
import { expectNoKatexErrors, reviewMode, watchProblems } from "./util";

const slug = process.env.MQE_LESSON ?? "";
const CONTENT = path.join(REPO, "content");
const OUT = path.join(REPO, "test-results", "lesson", slug);

const index = JSON.parse(readFileSync(path.join(CONTENT, "index.json"), "utf8")) as Index;
const meta = index.notes[slug];
const body = meta ? (JSON.parse(readFileSync(path.join(CONTENT, "notes", `${slug}.json`), "utf8")) as NoteBody) : undefined;

const kindOf = (b: Block) => (b.t === "check" ? `check:${b.kind}` : b.t === "interactive" ? `interactive:${b.widget}` : b.t);
const rel = (p: string) => path.relative(REPO, p).split(path.sep).join("/");

type Shot = { stepId: string; heading: string | null; blockKinds: string[]; screenshot: string; active: boolean; widgetRendered: boolean | null };

test(`lesson ${slug}`, async ({ page }) => {
  expect(meta, `no note "${slug}" in content/index.json`).toBeTruthy();
  const note = body!;
  const route = `#/${meta!.type === "lecture" ? "lesson" : "note"}/${slug}`;
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const problems = watchProblems(page);
  await page.goto(route);
  await expect(page.locator(".note-title")).toHaveText(meta!.title);
  await reviewMode(page);

  const steps = note.sections.flatMap((s) => s.steps);
  const wanted = steps.filter((st) => st.blocks.some((b) => b.t === "interactive" || b.t === "check" || b.t === "derive"));
  const shots: Shot[] = [];
  let settled = false;
  const manifest = () =>
    writeFileSync(
      path.join(OUT, "manifest.json"),
      `${JSON.stringify({ slug, title: meta!.title, route, steps: steps.length, shots }, null, 2)}\n`,
      "utf8",
    );

  try {
    for (const st of wanted) {
      const el = page.locator(`.lesson-main [data-step-id="${st.id}"]`);
      await el.evaluate((e) => e.scrollIntoView({ block: "start", behavior: "instant" }));
      // The visual pane follows the step that is active; a step the page cannot scroll far enough to activate is
      // recorded, not failed (the last step of a short lecture).
      const active = await expect(el).toHaveAttribute("data-active", "true", { timeout: 3000 }).then(() => true, () => false);
      const hasWidget = st.blocks.some((b) => b.t === "interactive");
      let widgetRendered: boolean | null = null;
      // The pane only shows the active step's visual, so a step that could not be activated can't be judged here.
      if (hasWidget && active) {
        // A planned placeholder renders its static figure ("Interactive coming"), not a live widget; both count.
        const visual = ".pane .w-root, .lesson-main .w-root, .pane .w-planned, .lesson-main .w-planned";
        widgetRendered = await expect(page.locator(visual).first()).toBeVisible({ timeout: 10_000 }).then(() => true, () => false);
        // The first widget waits for the runtime chunk and its data; later ones only need a frame or two to draw.
        if (!settled) await page.waitForLoadState("networkidle");
        settled = true;
        await page.waitForTimeout(150);
      }
      const file = path.join(OUT, `${st.id}.png`);
      // A step with a widget is shot as the page (step and pane side by side); a check-only step as its own article,
      // since its checkpoint can sit below the fold.
      if (hasWidget) await page.screenshot({ path: file, animations: "disabled" });
      else await el.screenshot({ path: file, animations: "disabled" });
      shots.push({ stepId: st.id, heading: st.heading ?? null, blockKinds: st.blocks.map(kindOf), screenshot: rel(file), active, widgetRendered });
    }
  } finally {
    manifest();
  }

  expect(shots.filter((s) => s.widgetRendered === false).map((s) => s.stepId), "steps whose widget did not render").toEqual([]);
  await expect(page.locator('.w-root[role="alert"]')).toHaveCount(0);
  await expectNoKatexErrors(page);
  expect(problems.list).toEqual([]);
});
