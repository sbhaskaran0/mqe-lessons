// npm run lesson -- "<lecture>" [--no-sync] [--port N]
// Everything needed to trust one lecture after an edit, in one command, with a timing per stage:
//   sync + check the vault -> export -> validate -> resolve the lecture -> refresh the test site ->
//   smoke test of that lecture -> step-by-step run with a screenshot per interactive or check step.
// <lecture> is a slug or a title prefix ("Econ 402A L1"). Exits non-zero at the first failing stage.
// Later waves add a stage by appending a [name, fn] pair to `steps`; fn returns an exit status (0 = ok), or
// throws an Error whose message is shown.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { CONTENT, REPO, run, vaultTool } from "./lib.mjs";

const node = process.execPath;
const bin = (p) => path.join(REPO, "node_modules", ...p.split("/"));
const VITE = bin("vite/bin/vite.js");
const PLAYWRIGHT = bin("@playwright/test/cli.js");
const TSX = bin("tsx/dist/cli.mjs");

/** Where the lecture runs are served from: a production build of the app that keeps the app's own dist/ alone. The
 *  app loads content at runtime, so a content-only change just replaces the content files here. */
const SITE = path.join(REPO, "test-results", "lesson-site", "dist");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const portAt = args.indexOf("--port");
const port = portAt >= 0 ? Number(args[portAt + 1]) : 4327;
const query = args.filter((a, i) => !a.startsWith("--") && !(portAt >= 0 && i === portAt + 1)).join(" ").trim();
if (!query || !Number.isInteger(port)) {
  console.error('usage: npm run lesson -- "<lecture slug or title prefix>" [--no-sync] [--port N]');
  process.exit(2);
}

/** Filled in by the stages: the resolved lecture. */
const ctx = { slug: "", title: "" };

// ---- resolving the lecture ----------------------------------------------------------------------------------

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** `q` is a whole-word prefix of `s` ("econ 402a l1" matches "econ 402a l1 solow ..." but not "econ 402a l10 ..."). */
const prefixOf = (q, s) => s === q || s.startsWith(`${q} `);

function resolveLecture(index, text) {
  const lectures = Object.values(index.notes).filter((n) => n.type === "lecture");
  const q = norm(text);
  const names = (n) => [n.slug, n.name, n.title, [n.course, n.lecture != null ? `L${n.lecture}` : "", n.title].join(" ")].map(norm);
  const tiers = [
    (n) => names(n).includes(q), // the slug, name or title in full
    (n) => names(n).some((s) => prefixOf(q, s)),
    (n) => names(n).some((s) => s.includes(q)),
  ];
  for (const tier of tiers) {
    const hits = lectures.filter(tier);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new Error(`"${text}" matches ${hits.length} lectures; be more specific:\n${hits.map((n) => `  ${n.name}  (${n.slug})`).join("\n")}`);
  }
  const words = q.split(" ");
  const close = lectures
    .map((n) => ({ n, score: words.filter((w) => norm(n.name).split(" ").includes(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => `  ${x.n.name}  (${x.n.slug})`);
  throw new Error(`no lecture matches "${text}".${close.length ? `\nclosest:\n${close.join("\n")}` : "\nrun `npm run export` and look in content/index.json for the lecture names."}`);
}

// ---- the test site -------------------------------------------------------------------------------------------

/** Newest modification time under the app's source files (what a built bundle depends on). */
function newestSource() {
  let newest = 0;
  const visit = (p) => {
    const st = statSync(p);
    if (st.isDirectory()) for (const f of readdirSync(p)) visit(path.join(p, f));
    else newest = Math.max(newest, st.mtimeMs);
  };
  visit(path.join(REPO, "src"));
  for (const f of ["index.html", "vite.config.ts", "tsconfig.json", "package.json", "package-lock.json"]) {
    const p = path.join(REPO, f);
    if (existsSync(p)) newest = Math.max(newest, statSync(p).mtimeMs);
  }
  return newest;
}

/** A fresh content export in a site whose bundle is current: build when the app changed or no build exists, else copy. */
function prepareSite() {
  const entry = path.join(SITE, "index.html");
  if (!existsSync(entry) || statSync(entry).mtimeMs < newestSource()) {
    console.log("app changed since the last lesson build: building the site");
    return run(node, [VITE, "build", "--logLevel", "warn"], { MQE_OUT: SITE });
  }
  // The bundle (index.html, app/) is kept; everything else in the site is a copy of content/, replaced whole.
  for (const f of readdirSync(SITE)) if (f !== "app" && f !== "index.html") rmSync(path.join(SITE, f), { recursive: true, force: true });
  for (const f of readdirSync(CONTENT)) cpSync(path.join(CONTENT, f), path.join(SITE, f), { recursive: true });
  console.log("app unchanged: reused the build, refreshed the content files");
  return 0;
}

/** Playwright against the real export only, on `port`, served from SITE. */
function playwright(extra, env = {}) {
  return run(node, [PLAYWRIGHT, "test", "--reporter=line", ...extra], {
    MQE_E2E_ONLY: "real",
    MQE_E2E_PORT: String(port),
    MQE_E2E_SITE: SITE,
    ...env,
  });
}

// ---- the stages ----------------------------------------------------------------------------------------------

const steps = [
  ...(flag("--no-sync") ? [] : [["sync the vault", () => vaultTool(["sync"]).status]]),
  ["check the vault", () => vaultTool(["check"]).status],
  ["export the vault", () => run(node, [path.join(REPO, "scripts", "vault.mjs"), "export"])],
  ["validate content/", () => run(node, [TSX, path.join(REPO, "scripts", "validate.ts")])],
  [
    "resolve the lecture",
    () => {
      const index = JSON.parse(readFileSync(path.join(CONTENT, "index.json"), "utf8"));
      const n = resolveLecture(index, query);
      ctx.slug = n.slug;
      ctx.title = n.name;
      console.log(`${n.name}  ->  ${n.slug}`);
      return 0;
    },
  ],
  ["refresh the test site", () => (mkdirSync(path.dirname(SITE), { recursive: true }), prepareSite())],
  // The smoke test titles each note `${type} ${slug}`; the optional tail is its @phone tag.
  ["smoke test of the lecture", () => playwright(["--project=smoke", "--grep", `lecture ${ctx.slug}( @phone)?$`])],
  ["step through the lecture, with screenshots", () => playwright(["--project=lesson"], { MQE_LESSON: ctx.slug })],
  // Reads the export and the manifest just written, so it comes after the screenshots (H6a). Well under 2 s.
  ["write the review sheet", () => run(node, [path.join(REPO, "scripts", "review-sheet.mjs"), ctx.slug])],
  // Wave 2+: append further [name, fn] stages here (derivation checker tests, ...).
];

const timings = [];
function summary() {
  console.log("\n== timings");
  for (const [name, s, status] of timings) console.log(`  ${status === 0 ? "ok  " : "FAIL"}  ${s.toFixed(1).padStart(6)}s  ${name}`);
  console.log(`  total ${timings.reduce((t, x) => t + x[1], 0).toFixed(1)}s`);
}

for (const [name, step] of steps) {
  console.log(`\n== ${name}`);
  const t0 = performance.now();
  let status;
  try {
    status = step();
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : e}`);
    status = 1;
  }
  timings.push([name, (performance.now() - t0) / 1000, status]);
  if (status !== 0) {
    summary();
    console.error(`\nlesson FAILED at: ${name}`);
    process.exit(status || 1);
  }
}
summary();
console.log(`\nlesson ok: ${ctx.title}\n  screenshots: test-results/lesson/${ctx.slug}/ (manifest.json lists them)
  review sheet: test-results/review/${ctx.slug}.html`);
