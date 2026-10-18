// Playwright: a smoke pass over every route of the real export (desktop), a phone-width pass over a sample,
// behaviour tests against the fixture vault (which has checks, goals and widgets), and the two pilot lessons played end
// to end (pilots.spec.ts). Each runs against a production
// build served by `vite preview` (tests/e2e/serve.ts). The screenshot project runs only when asked for
// (`npm run screens`, i.e. --project=screens), so the default run stays a test run.
import { defineConfig } from "@playwright/test";

// MQE_E2E_PORT moves the real-export server; MQE_E2E_ONLY=real leaves the fixture server (and its slow export and
// build) out. `npm run lesson` sets both, plus MQE_LESSON, which adds the `lesson` project. All are unset by default.
const REAL_PORT = Number(process.env.MQE_E2E_PORT ?? 4317);
const REAL = `http://127.0.0.1:${REAL_PORT}/`;
const FIXTURE = "http://127.0.0.1:4318/";
const tsx = "node node_modules/tsx/dist/cli.mjs tests/e2e/serve.ts";
// Workers re-read this file without the CLI arguments; the environment carries the choice over to them.
if (process.argv.some((a) => a === "--project=screens" || a === "--project=map-screens" || a === "--project=learning-screens" || a === "screens")) process.env.MQE_SCREENS = "1";
const screens = process.env.MQE_SCREENS === "1";

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/playwright",
  fullyParallel: true,
  // Three local workers: at five (50% of this laptop's cores) the KaTeX-heavy pages time out whenever something else
  // (an editor's language server, the dev server) is busy. MQE_E2E_WORKERS overrides it on a quiet machine.
  workers: process.env.MQE_E2E_WORKERS ? Number(process.env.MQE_E2E_WORKERS) : process.env.CI ? 2 : 3,
  reporter: process.env.CI ? "dot" : [["line"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // The trace keeps the action log, errors and network, but not DOM snapshots or screenshots. Snapshotting a lesson's
  // page (a Review-mode lesson is thousands of KaTeX nodes) around every action made the parallel run 10-30x slower
  // once five workers shared the CPU: a 10 s pilot test took 3.7 min with five copies at once, 20 s without snapshots.
  // That, not the app, produced the intermittent timeouts. For a full trace pass `--trace on` and `--workers=1`.
  use: { browserName: "chromium", trace: { mode: "retain-on-failure", snapshots: false, screenshots: false, sources: false } },
  projects: [
    { name: "smoke", testMatch: "smoke.spec.ts", use: { baseURL: REAL, viewport: { width: 1280, height: 800 } } },
    {
      name: "phone",
      testMatch: "smoke.spec.ts",
      grep: /@phone/,
      use: { baseURL: REAL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
    { name: "fixture", testMatch: /(fixture|derive|review|exam|data-chart-lookup)\.spec\.ts$/, use: { baseURL: FIXTURE, viewport: { width: 1280, height: 800 } } },
    // The Phase 2 pilots played end to end on the real export, at desktop and phone width.
    { name: "pilots", testMatch: "pilots.spec.ts", grepInvert: /@phone/, use: { baseURL: REAL, viewport: { width: 1280, height: 800 } } },
    {
      name: "pilots-phone",
      testMatch: "pilots.spec.ts",
      grep: /@phone/,
      use: { baseURL: REAL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
    // The prerequisite map and the library facets (map.spec.ts), at desktop and phone width.
    { name: "map", testMatch: "map.spec.ts", grepInvert: /@phone/, use: { baseURL: REAL, viewport: { width: 1280, height: 800 } } },
    {
      name: "map-phone",
      testMatch: "map.spec.ts",
      grep: /@phone/,
      use: { baseURL: REAL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
    // Practice sets, the progress dashboard and symbol hover in math (practice.spec.ts, hover.spec.ts).
    { name: "learning", testMatch: /(^|[\\/])(practice|hover)\.spec\.ts$/, grepInvert: /@phone/, use: { baseURL: REAL, viewport: { width: 1280, height: 800 } } },
    {
      name: "learning-phone",
      testMatch: /(^|[\\/])(practice|hover)\.spec\.ts$/,
      grep: /@phone/,
      use: { baseURL: REAL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
    // One lecture, step by step, with a screenshot per interactive or check step (lesson.spec.ts): only `npm run lesson`.
    ...(process.env.MQE_LESSON
      ? [{ name: "lesson", testMatch: "lesson.spec.ts", timeout: 120_000, use: { baseURL: REAL, viewport: { width: 1280, height: 800 } } }]
      : []),
    ...(screens
      ? [
          { name: "screens", testMatch: "screens.spec.ts", use: { baseURL: REAL } },
          { name: "map-screens", testMatch: "map-screens.spec.ts", use: { baseURL: REAL } },
          { name: "learning-screens", testMatch: "practice-screens.spec.ts", use: { baseURL: REAL } },
        ]
      : []),
  ],
  webServer: [
    { command: `${tsx} real ${REAL_PORT}`, url: REAL, reuseExistingServer: false, timeout: 180_000, stdout: "pipe" },
    ...(process.env.MQE_E2E_ONLY === "real"
      ? []
      : [{ command: `${tsx} fixture 4318`, url: FIXTURE, reuseExistingServer: false, timeout: 180_000, stdout: "pipe" as const }]),
  ],
});
