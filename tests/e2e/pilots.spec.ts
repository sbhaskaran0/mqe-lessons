// The two Phase 2 pilots, played end to end on the real export the way a learner would: Continue through the lesson,
// answer checkpoints (right and wrong), reach widget goals with real keyboard and mouse input, commit predictions,
// and check that progress records each of them and that the numbers on screen are the ones
// docs/proposals/verify_pilots.py recomputes. Tests tagged @phone run at 390px (project pilots-phone); the rest at
// 1280px (project pilots). Screenshots for review go to test-results/screens/.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NoteBody } from "../../src/ir";
import { REPO } from "../helpers";
import { reviewMode, watchProblems } from "./util";

const SOLOW = "econ-402a-l1-solow-growth-model";
const OLS = "econ-430-l3-the-method-of-least-squares";
const SCREENS = path.join(REPO, "test-results", "screens");

// Values verify_pilots.py recomputes in Python (and the widgets' own `tests` pin): the notes' example economy
// (s = alpha = 1/2, delta = 0.1, A = 1) and the seeded food sample.
const KBAR = "25.00";
const CBAR = "2.500";
const KBAR2_DELTA = "16.00"; // delta 0.1 -> 0.125
const SSR_MIN = 315723.861282;
const B2_OLS = "10.21";
const PATH = { 1: "100", 2: "95", 3: "90.4", 51: "28.9" }; // k_t at the notes' periods, formatted .3~r

type Progress = { derives?: Record<string, { result: string }>; checks: Record<string, { result: string; answer?: unknown }>; checkpoints: Record<string, { kind: string; result: string; answer?: { option?: number } }> };

const body = (slug: string) => JSON.parse(readFileSync(path.join(REPO, "content", "notes", `${slug}.json`), "utf8")) as NoteBody;

/** Step ids in reveal order, and the key progress stores a block's result under (slug#step#blockIndex). `nth` finds a
 *  step by what it holds (the n-th check, the first step showing a widget) so that authors inserting steps, as the
 *  derivation exercises did, do not break the journeys. */
function lesson(slug: string) {
  const steps = body(slug).sections.flatMap((s) => s.steps);
  const ids = steps.map((s) => s.id);
  const key = (stepId: string, t: "check" | "interactive" | "derive") => {
    const step = steps.find((s) => s.id === stepId)!;
    return `${slug}#${stepId}#${step.blocks.findIndex((b) => b.t === t)}`;
  };
  const nth = (t: "check" | "interactive" | "derive", n = 0, widget?: string) => {
    const hits = steps.filter((s) => s.blocks.some((b) => b.t === t && (!widget || (b.t === "interactive" && b.widget === widget))));
    const hit = hits[n];
    if (!hit) throw new Error(`${slug} has no ${t}${widget ? ` of ${widget}` : ""} number ${n}`);
    return hit.id;
  };
  return { ids, key, nth };
}

const stepEls = (page: Page) => page.locator(".lesson-main [data-step-id]");
const step = (page: Page, id: string) => page.locator(`.lesson-main [data-step-id="${id}"]`);
const cont = (page: Page) => page.getByRole("button", { name: "Continue", exact: true });
const pane = (page: Page) => page.locator(".pane");
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("mqe-lessons/progress/1") ?? "{}") as Progress);

/** Press Continue until `id` is revealed and active. Every step on the way must be ungated, except a derivation
 *  exercise, which is skipped through its gate (solveDerive answers the ones a journey wants to exercise). */
async function continueTo(page: Page, ids: string[], id: string) {
  const want = ids.indexOf(id) + 1;
  await expect(stepEls(page).first()).toBeVisible();
  while ((await stepEls(page).count()) < want) {
    const before = await stepEls(page).count();
    const gatedByDerive = (await stepEls(page).last().locator(".derive").count()) > 0 && (await cont(page).getAttribute("aria-disabled")) === "true";
    if (gatedByDerive) await page.getByRole("button", { name: "Skip", exact: true }).click();
    else {
      await expect(cont(page)).not.toHaveAttribute("aria-disabled", "true");
      await cont(page).click();
    }
    await expect(stepEls(page)).toHaveCount(before + 1);
  }
  await expect(step(page, id)).toHaveAttribute("data-active", "true");
}

/** Types a derivation's target line, the way a learner would, and waits for the card to say it is complete. The checker
 *  loads on first use, so the input is the sign it is ready. */
async function solveDerive(page: Page, stepId: string, line: string) {
  const d = step(page, stepId).locator(".derive");
  const input = d.getByLabel("Your next line");
  await expect(input).toBeVisible({ timeout: 45_000 });
  await input.fill(line);
  await input.press("Enter");
  await expect(d.getByText("Derivation complete.")).toBeVisible();
  await expect(cont(page)).not.toHaveAttribute("aria-disabled", "true");
}

async function skipGate(page: Page) {
  await expect(cont(page)).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "Skip", exact: true }).click();
}

async function answerMcq(check: Locator, option: number, verdict: "Correct." | "Not quite.") {
  await check.locator(".mcq-option").nth(option).click();
  await check.getByRole("button", { name: "Check answer" }).click();
  await expect(check.getByText(verdict)).toBeVisible();
}

async function answerNumeric(check: Locator, value: string, verdict: "Correct." | "Not quite.") {
  await check.getByLabel("Your answer").fill(value);
  await check.getByRole("button", { name: "Check answer" }).click();
  await expect(check.getByText(verdict)).toBeVisible();
}

/** A parameter slider moved from the keyboard, one step per key press, as a learner would. (Keys go to the focused
 *  slider directly: locator.press would re-check actionability before every press.) */
async function pressSlider(slider: Locator, key: "ArrowLeft" | "ArrowRight" | "PageDown" | "PageUp", times: number) {
  await slider.focus();
  for (let i = 0; i < times; i++) await slider.page().keyboard.press(key);
}

/** A widget in the pane, once it has mounted. Its first appearance downloads and starts the widget runtime, which is
 *  CPU-bound and can take many seconds while the whole suite saturates the machine; this waits for that (and only
 *  that) with a wider budget, so the checks that follow keep the usual timeout. */
async function mounted(slot: Locator) {
  await expect(slot.locator(".w-root")).toBeVisible({ timeout: 45_000 });
}

/** Presses a button in the visual pane from the keyboard. A click would do, except when Playwright retries one (the
 *  widget still settling on a busy machine): retries scroll with a forced alignment, Chrome scrolls the window for an
 *  element inside the sticky pane, the reading position lands on the previous step and the pane swaps the widget out.
 *  Focus scrolls only when it must, which the pane never needs from the window. */
async function press(control: Locator) {
  await expect(control).toBeEnabled();
  await control.focus();
  await expect(control).toBeFocused();
  await control.page().keyboard.press("Enter");
}

/** A parameter's range input (drag handles on the plot are sliders too, so address it by parameter id). */
const param = (scope: Locator, id: string) => scope.locator(`[data-param="${id}"] input[type="range"]`);
async function moveKtTo25(kt: Locator) {
  await pressSlider(kt, "PageDown", 6);
  await expect(kt).toHaveValue("28");
  await pressSlider(kt, "ArrowLeft", 6);
  await expect(kt).toHaveValue("25");
}

const readout = (scope: Locator, id: string) => scope.locator(`[data-readout="${id}"] output`);
const num = (s: string) => Number(s.replace(/[−–]/g, "-").replace(/,/g, ""));

async function shot(page: Page, name: string, target?: Locator) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(450); // let the reveal and pane transitions settle
  const size = page.viewportSize()!;
  await (target ?? page).screenshot({ path: path.join(SCREENS, `${name}-${size.width}x${size.height}.png`) });
}

/** The value in the dynamics hover card at period t. The pointer's x is calibrated from two hovers, then nudged a
 *  pixel at a time until the card names t. */
async function hoverPeriod(page: Page, panel: Locator, t: number): Promise<string> {
  await panel.locator(".w-plot").scrollIntoViewIfNeeded();
  const box = (await panel.locator(".w-plot").boundingBox())!;
  const y = box.y + box.height / 2;
  const card = panel.locator(".w-hover");
  const periodAt = async (x: number) => {
    await page.mouse.move(x, y);
    await page.waitForTimeout(60); // the card follows the pointer on the next render
    if (!(await card.count())) return NaN;
    return Number(/=\s*(-?\d+)/.exec(await card.locator(".w-hover-t").innerText())?.[1]);
  };
  const xa = box.x + box.width * 0.3;
  const xb = box.x + box.width * 0.7;
  const [ta, tb] = [await periodAt(xa), await periodAt(xb)];
  if (!Number.isFinite(ta) || !Number.isFinite(tb) || ta === tb) throw new Error(`hover card did not follow the pointer (${ta}, ${tb})`);
  const perPeriod = (xb - xa) / (tb - ta);
  let x = xa + (t - ta) * perPeriod;
  for (let i = 0; i < 12; i++) {
    const now = await periodAt(x);
    if (now === t) return card.locator(".w-hover-v").first().innerText();
    x += Number.isFinite(now) ? Math.sign(t - now) * Math.max(1, Math.abs(t - now) * perPeriod * 0.5) : 1;
  }
  throw new Error(`no hover card for t = ${t}`);
}

// Real lessons with live widgets: slower than the smoke pages, especially when the projects run side by side. Budgets
// are wall-clock: on the development laptop the full suite has taken these tests anywhere from 1x to 4x their quiet
// time as the CPU clock throttles, so they leave room for that rather than for anything waiting on a bug.
test.describe.configure({ mode: "parallel", timeout: 150_000 });

test("Pilot A: Econ 402A L1 Solow, played with Continue", async ({ page }) => {
  test.setTimeout(300_000); // 50 steps: about 35 s on a quiet machine, 150 s seen under the full suite
  const problems = watchProblems(page);
  const { ids, key, nth } = lesson(SOLOW);
  const derive = nth("derive"); // §3, the per-worker law of motion: answered; the other derivations are skipped
  const golden = nth("interactive", 0, "solow-golden-rule-explorer");
  await page.goto(`#/lesson/${SOLOW}`);
  await expect(stepEls(page)).toHaveCount(1);

  // §1: a multiple-choice checkpoint gates Continue; answered right.
  await continueTo(page, ids, "1-goal-and-assumptions-2");
  await expect(cont(page)).toHaveAttribute("aria-disabled", "true");
  await answerMcq(step(page, "1-goal-and-assumptions-2").locator(".check"), 2, "Correct.");

  // §3: a derivation gates Continue until its target line is typed.
  await continueTo(page, ids, derive);
  await expect(cont(page)).toHaveAttribute("aria-disabled", "true");
  await solveDerive(page, derive, "k_(t+1) = s A k_t^alpha + (1-delta) k_t");

  // §4: a numeric checkpoint, right (Revision Q4: k_{t+1} = 15.6).
  await continueTo(page, ids, "4-a-worked-example-2");
  await answerNumeric(step(page, "4-a-worked-example-2").locator(".check"), "15.6", "Correct.");

  // §5: the lecture figure in the pane, then the steady-state explorer with a goal that gates Continue.
  await continueTo(page, ids, "5-investment-vs-depreciation-1");
  await expect(pane(page).locator("img")).toHaveAttribute("alt", /investment vs depreciation/i);
  await continueTo(page, ids, "5-investment-vs-depreciation-2");
  const steady = pane(page).locator('.widget-slot[data-widget="solow-steady-state-explorer"]');
  await mounted(steady);
  await expect(pane(page).locator(".pane-prompt")).toContainText("Drag the point");
  await expect(readout(steady, "dk_out")).toHaveText(/^[−-]5\.00$/);
  await expect(cont(page)).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("Reach the goal in the interactive to continue, or skip it.")).toBeVisible();
  // k_t from 100 down to the crossing at 25: PageDown moves a tenth of the range (12), each arrow half a unit.
  await moveKtTo25(param(steady, "kt"));
  await expect(readout(steady, "dk_out")).toHaveText(/^[−-]?0\.00$/);
  await expect(step(page, "5-investment-vs-depreciation-2").locator('.goal[data-state="met"]')).toContainText("Goal reached");
  await expect(steady.locator('[data-goal="met"]')).toBeVisible();
  await expect(cont(page)).not.toHaveAttribute("aria-disabled", "true");
  const host = await steady.elementHandle();

  // §6: the same widget, the same mounted host, a new view with a prediction; then k-bar and c-bar.
  await continueTo(page, ids, "6-the-steady-state-1");
  expect(await host!.evaluate((el) => el.isConnected)).toBe(true);
  await expect(readout(steady, "kbar_out")).toHaveCount(0); // hidden until the prediction is committed
  await press(steady.getByRole("radio", { name: /To the right/ }));
  await press(steady.getByRole("button", { name: "Commit prediction" }));
  await expect(steady.getByText("Right. Watch it play out.")).toBeVisible();
  await expect(readout(steady, "kbar_out")).toHaveText(KBAR);
  await expect(readout(steady, "cbar_out")).toHaveText(CBAR);
  await shot(page, "pilot-solow-steady");

  // §6: a numeric checkpoint answered wrongly (c-bar is 1.677, not 2).
  await continueTo(page, ids, "6-the-steady-state-2");
  await answerNumeric(step(page, "6-the-steady-state-2").locator(".check"), "2", "Not quite.");

  // §7: figure, then the convergence widget: the pane switches widget; periods count from 1 as in the notes.
  await continueTo(page, ids, "7-dynamics-1");
  await expect(pane(page).locator("img")).toHaveAttribute("alt", /transition path/i);
  await continueTo(page, ids, "7-dynamics-2");
  const dyn = pane(page).locator('.widget-slot[data-widget="solow-convergence-and-shocks"]');
  await mounted(dyn);
  await expect(steady).toHaveCount(0);
  await press(dyn.getByRole("radio", { name: /fast at first/ }));
  await press(dyn.getByRole("button", { name: "Commit prediction" }));
  const capitalPlot = dyn.locator('[data-panel="levels_k"]');
  for (const [t, v] of Object.entries(PATH)) expect(await hoverPeriod(page, capitalPlot, Number(t))).toBe(v);
  await page.mouse.move(0, 0);

  // §8: the depreciation shock; delta_2 from 0.1 to 0.125 (five key presses) brings k-bar_2 to 16.
  await continueTo(page, ids, "8-shocks-3");
  await expect(cont(page)).toHaveAttribute("aria-disabled", "true");
  await expect(readout(dyn, "kbar1_out")).toHaveText(KBAR);
  await pressSlider(param(dyn, "delta2"), "ArrowRight", 5);
  await expect(readout(dyn, "kbar2_out")).toHaveText(KBAR2_DELTA);
  await expect(step(page, "8-shocks-3").locator('.goal[data-state="met"]')).toBeVisible();
  await page.evaluate(() => document.querySelector(".pane-sticky")?.scrollTo({ top: 0 }));
  await shot(page, "pilot-solow-dynamics");

  // Two checkpoints skipped on the way to the golden rule.
  await continueTo(page, ids, "8-shocks-5");
  await skipGate(page);
  await expect(stepEls(page)).toHaveCount(ids.indexOf("8-shocks-6") + 1);
  await skipGate(page);
  await continueTo(page, ids, "9-consumption-2");
  await answerMcq(step(page, "9-consumption-2").locator(".check"), 1, "Correct.");

  // §10: the golden-rule goal; s from 0.30 to 0.50 = alpha. c-bar peaks at 2.5.
  await continueTo(page, ids, golden); // the derivation before it is skipped on the way
  const goldenW = pane(page).locator('.widget-slot[data-widget="solow-golden-rule-explorer"]');
  await mounted(goldenW);
  await expect(readout(goldenW, "cbar_out")).toHaveText("2.100");
  await pressSlider(param(goldenW, "s"), "ArrowRight", 20);
  await expect(readout(goldenW, "cbar_out")).toHaveText(CBAR);
  await expect(step(page, golden).locator('.goal[data-state="met"]')).toBeVisible();
  await shot(page, "pilot-solow-golden-goal");

  const p = await stored(page);
  expect(p.checks[key("1-goal-and-assumptions-2", "check")]).toMatchObject({ result: "correct", answer: [2] });
  expect(p.checks[key("4-a-worked-example-2", "check")]).toMatchObject({ result: "correct", answer: 15.6 });
  expect(p.checks[key("6-the-steady-state-2", "check")]).toMatchObject({ result: "incorrect", answer: 2 });
  expect(p.checks[key("8-shocks-5", "check")]).toMatchObject({ result: "skipped" });
  expect(p.checkpoints[key("5-investment-vs-depreciation-2", "interactive")]).toMatchObject({ kind: "goal", result: "met" });
  expect(p.checkpoints[key("8-shocks-3", "interactive")]).toMatchObject({ kind: "goal", result: "met" });
  expect(p.checkpoints[key(golden, "interactive")]).toMatchObject({ kind: "goal", result: "met" });
  expect(p.derives?.[key(derive, "derive")]).toMatchObject({ result: "done" });
  expect(p.checkpoints[`${key("6-the-steady-state-1", "interactive")}#predict`]).toMatchObject({ kind: "predict", result: "correct", answer: { option: 0 } });
  expect(p.checkpoints[`${key("7-dynamics-2", "interactive")}#predict`]).toMatchObject({ kind: "predict", result: "correct", answer: { option: 1 } });
  expect(problems.list).toEqual([]);
});

test("Pilot A: coming back to a predicted step shows the first guess, revealed, and does not ask again", async ({ page }) => {
  const { key } = lesson(SOLOW);
  await page.goto(`#/lesson/${SOLOW}`);
  await reviewMode(page);
  const at = (id: string) => page.evaluate((id) => document.querySelector(`[data-step-id="${id}"]`)!.scrollIntoView({ block: "start" }), id);
  await at("6-the-steady-state-1");
  const steady = pane(page).locator('.widget-slot[data-widget="solow-steady-state-explorer"]');
  await mounted(steady);
  await press(steady.getByRole("radio", { name: /To the left/ }));
  await press(steady.getByRole("button", { name: "Commit prediction" }));
  await expect(steady.getByText(/Not quite: the answer is/)).toBeVisible();
  // Committing keeps the plot where it was: the pane did not scroll, and the plot is still in view.
  expect(await pane(page).locator(".pane-sticky").evaluate((el) => el.scrollTop)).toBe(0);
  await expect(steady.locator(".w-plot")).toBeInViewport();
  // Away and back: the step starts committed and revealed with the learner's recorded choice; there is nothing to ask.
  await at("5-investment-vs-depreciation-2");
  await expect(step(page, "5-investment-vs-depreciation-2")).toHaveAttribute("data-active", "true");
  await at("6-the-steady-state-1");
  await expect(step(page, "6-the-steady-state-1")).toHaveAttribute("data-active", "true");
  await expect(steady.getByRole("button", { name: "Commit prediction" })).toHaveCount(0);
  await expect(steady.getByRole("radio", { name: /To the left/ })).toHaveAttribute("aria-checked", "true");
  await expect(steady.getByRole("radio", { name: /To the right/ })).toBeDisabled();
  await expect(steady.getByText(/Not quite: the answer is/)).toBeVisible();
  const p = await stored(page);
  expect(p.checkpoints[`${key("6-the-steady-state-1", "interactive")}#predict`]).toMatchObject({ result: "incorrect", answer: { option: 1 } });
});

test("Pilot A: coming back to a step whose goal was met shows the success state", async ({ page }) => {
  const { key } = lesson(SOLOW);
  await page.goto(`#/lesson/${SOLOW}`);
  await reviewMode(page);
  const at = (id: string) => page.evaluate((id) => document.querySelector(`[data-step-id="${id}"]`)!.scrollIntoView({ block: "start" }), id);
  await at("5-investment-vs-depreciation-2");
  const steady = pane(page).locator('.widget-slot[data-widget="solow-steady-state-explorer"]');
  await mounted(steady);
  await moveKtTo25(param(steady, "kt"));
  await expect(steady.locator('[data-goal="met"]')).toBeVisible();
  const first = (await stored(page)).checkpoints[key("5-investment-vs-depreciation-2", "interactive")]!;
  await at("6-the-steady-state-1");
  await expect(step(page, "6-the-steady-state-1")).toHaveAttribute("data-active", "true");
  await at("5-investment-vs-depreciation-2");
  await expect(step(page, "5-investment-vs-depreciation-2")).toHaveAttribute("data-active", "true");
  await expect(steady.locator('[data-goal="met"]')).toBeVisible();
  // Not re-recorded: the time the goal was first reached stays.
  expect((await stored(page)).checkpoints[key("5-investment-vs-depreciation-2", "interactive")]).toEqual(first);
});

test("Pilot B: Econ 430 L3, fit the line by hand until the SSR goal fires, then reveal OLS", async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchProblems(page);
  const { ids, key, nth } = lesson(OLS);
  const [right, wrong] = [nth("check", 0), nth("check", 1)]; // the derivations between the checks are not counted
  const derive = nth("derive");
  await page.goto(`#/lesson/${OLS}`);
  await continueTo(page, ids, "2-least-squares-1");
  const fit = pane(page).locator('.widget-slot[data-widget="ols-line-fitter"]');
  await mounted(fit);
  await expect(cont(page)).toHaveAttribute("aria-disabled", "true");
  await fitByHand(page, fit);
  await expect(step(page, "2-least-squares-1").locator('.goal[data-state="met"]')).toContainText("Goal reached");
  await expect(cont(page)).not.toHaveAttribute("aria-disabled", "true");

  await press(fit.getByRole("button", { name: "Reveal OLS" }));
  const b2 = fit.locator('[data-param="b2"] .w-param-value');
  await expect(b2).toHaveText(B2_OLS);
  const ssr = num(await readout(fit, "ssr").innerText());
  expect(Math.abs(ssr - SSR_MIN) / SSR_MIN).toBeLessThan(5e-4); // shown to four significant figures
  const min = num((await fit.locator('[data-readout="ssr"] .w-readout-sub').innerText()).replace(/^min\s*/, ""));
  expect(Math.abs(min - SSR_MIN) / SSR_MIN).toBeLessThan(5e-4);
  await shot(page, "pilot-ols");

  // The checkpoints that follow: one right, one wrong.
  await continueTo(page, ids, right);
  await answerMcq(step(page, right).locator(".check"), 2, "Correct.");
  // After the first-order-conditions check: the SSR bowl and both sums, with a goal that both reach zero.
  const bowlStep = nth("interactive", 1, "ols-line-fitter");
  await continueTo(page, ids, bowlStep);
  const bowl = pane(page).locator('.widget-slot[data-widget="ols-line-fitter"]');
  await mounted(bowl);
  await expect(bowl.locator('[data-panel="ssr_bowl"] [data-level]').first()).toBeAttached();
  await expect(bowl.locator('[data-panel="ssr_bowl"] [data-handle="here"]')).toBeVisible();
  await expect(cont(page)).toHaveAttribute("aria-disabled", "true");
  await pressSlider(param(bowl, "b1"), "PageDown", 2);
  await pressSlider(param(bowl, "b1"), "ArrowLeft", 47);
  await expect(param(bowl, "b1")).toHaveValue("83");
  await pressSlider(param(bowl, "b2"), "PageUp", 2);
  await pressSlider(param(bowl, "b2"), "ArrowRight", 44);
  await expect(param(bowl, "b2")).toHaveValue("10.2");
  expect(Math.abs(num(await readout(bowl, "resid_sum").innerText()))).toBeLessThan(40);
  await expect(step(page, bowlStep).locator('.goal[data-state="met"]')).toContainText("Goal reached");
  // The first derivation (the first-order conditions to b1 and b2) is answered with its target; the next is skipped.
  await continueTo(page, ids, derive);
  await solveDerive(page, derive, "b_2 = sum((x-xbar)(y-ybar))/sum((x-xbar)^2)");
  await continueTo(page, ids, wrong);
  await answerMcq(step(page, wrong).locator(".check"), 1, "Not quite.");
  const p = await stored(page);
  expect(p.checkpoints[key("2-least-squares-1", "interactive")]).toMatchObject({ kind: "goal", result: "met" });
  expect(p.checks[key(right, "check")]).toMatchObject({ result: "correct" });
  expect(p.checks[key(wrong, "check")]).toMatchObject({ result: "incorrect" });
  expect(p.derives?.[key(derive, "derive")]).toMatchObject({ result: "done" });
  expect(problems.list).toEqual([]);
});

/** Drag the line's shift and tilt handles with the mouse to roughly the best fit, then fine-tune b1 and b2 from the
 *  keyboard, keeping each key press only while it lowers the SSR, until the goal fires. */
async function fitByHand(page: Page, fit: Locator) {
  const shift = fit.locator('[data-handle="intercept"]');
  const tilt = fit.locator('[data-handle="slope"]');
  const centre = async (l: Locator) => {
    const b = (await l.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  // The line starts at b1 = 250, b2 = 2; the shift handle sits on x = 0 and the tilt handle at x = 0.88 * 36.
  const x2 = 0.88 * 36;
  const s0 = await centre(shift);
  const t0 = await centre(tilt);
  const pxPerUnit = (t0.y - s0.y) / (2 * x2); // screen y per unit of y (negative: up is smaller)
  const yAt = (v: number) => s0.y + (v - 250) * pxPerUnit;
  const drag = async (from: { x: number; y: number }, toY: number) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, toY, { steps: 12 });
    await page.mouse.up();
  };
  await drag(s0, yAt(83));
  await drag(await centre(tilt), yAt(83 + 10.2 * x2));
  await expect(fit.locator('[data-param="b2"] .w-param-value')).not.toHaveText("2.00");

  const met = fit.locator('[data-goal="met"]');
  const excess = async () => num(await readout(fit, "ssr_excess").innerText());
  for (const id of ["b2", "b1", "b2", "b1"]) {
    if (await met.count()) return;
    const slider = fit.locator(`[data-param="${id}"] input`);
    await slider.focus();
    for (const [key, back] of [["ArrowRight", "ArrowLeft"], ["ArrowLeft", "ArrowRight"]] as const) {
      let best = await excess();
      for (let i = 0; i < 40 && !(await met.count()); i++) {
        await page.keyboard.press(key);
        const now = await excess();
        if (now >= best) {
          await page.keyboard.press(back);
          break;
        }
        best = now;
      }
    }
  }
  await expect(met).toBeVisible();
}

test("Pilot A at phone width: the widget sits inline under its prompt, and its goal works @phone", async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchProblems(page);
  const { key } = lesson(SOLOW);
  await page.goto(`#/lesson/${SOLOW}`);
  await reviewMode(page);
  await expect(page.locator(".pane")).toHaveCount(0);
  const s = step(page, "5-investment-vs-depreciation-2");
  const inline = s.locator('.widget-slot[data-widget="solow-steady-state-explorer"]');
  await inline.scrollIntoViewIfNeeded();
  await expect(s.locator(".interactive-prompt")).toContainText("Drag the point");
  // The prompt comes before the widget.
  const [promptBox, widgetBox] = [await s.locator(".interactive-prompt").boundingBox(), await inline.boundingBox()];
  expect(promptBox!.y).toBeLessThan(widgetBox!.y);
  await moveKtTo25(param(inline, "kt"));
  await expect(s.locator('.goal[data-state="met"]')).toBeVisible();
  expect((await stored(page)).checkpoints[key("5-investment-vs-depreciation-2", "interactive")]).toMatchObject({ result: "met" });
  // No horizontal scroll at 390px.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await inline.locator(".w-stage").scrollIntoViewIfNeeded();
  await shot(page, "pilot-solow-steady-phone");
  expect(problems.list).toEqual([]);
});

test("Pilot B at phone width: fit the line inline @phone", async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchProblems(page);
  await page.goto(`#/lesson/${OLS}`);
  await reviewMode(page);
  const fit = step(page, "2-least-squares-1").locator('.widget-slot[data-widget="ols-line-fitter"]');
  await fit.scrollIntoViewIfNeeded();
  await fitByHand(page, fit);
  await fit.getByRole("button", { name: "Reveal OLS" }).click();
  await expect(fit.locator('[data-param="b2"] .w-param-value')).toHaveText(B2_OLS);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await fit.locator(".w-stage").scrollIntoViewIfNeeded();
  await shot(page, "pilot-ols-phone");
  expect(problems.list).toEqual([]);
});

test("a widget's note page shows it in explore mode, with where it is used", async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto("#/note/ols-line-fitter");
  const fit = pane(page).locator('.widget-slot[data-widget="ols-line-fitter"]');
  await expect(fit.locator('[data-mode="explore"]')).toBeVisible();
  // Explore: nothing locked (no chips), no goal.
  await expect(fit.locator(".w-chip")).toHaveCount(0);
  const used = page.locator(".used-in");
  await expect(used.getByRole("heading", { name: "Used in" })).toBeVisible();
  await expect(used.locator(".used-in-note").first()).toContainText("Simple Linear Regression");
  const stepLink = used.getByRole("link", { name: "2. Least squares" });
  await expect(stepLink).toHaveAttribute("href", `#/lesson/${OLS}?at=2-least-squares-1`);
  await stepLink.click();
  await expect(step(page, "2-least-squares-1")).toBeVisible();
  await expect(pane(page).locator('.widget-slot[data-widget="ols-line-fitter"]')).toBeVisible();
  expect(problems.list).toEqual([]);
});
