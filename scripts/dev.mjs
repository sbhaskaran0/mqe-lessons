// npm run dev: export the vault, start Vite, and re-export whenever the vault changes so edits made in Obsidian
// show up live. A failed export (check errors) is printed and the last good content/ stays in place. `sync` rewrites
// the generated files (_meta/graph.json, _meta/Concept Index.md), which are not watched, and the frontmatter of notes
// whose derived lessons/courses changed, which are: sync names those notes, and their watcher events are dropped for
// one debounce window so a sync does not set off another round. sync itself skips a note saved while it ran.
import { watch } from "chokidar";
import { spawn } from "node:child_process";
import path from "node:path";
import { createServer } from "vite";
import { config, CONTENT, REPO } from "./lib.mjs";

const DEBOUNCE_MS = 500;
const { vault, python, tool } = config();
// MQE_CONTENT (also read by vite.config.ts) lets a dev session run on another export directory.
const OUT = process.env.MQE_CONTENT ? path.resolve(process.env.MQE_CONTENT) : CONTENT;

function runTool(args) {
  return new Promise((resolve) => {
    const child = spawn(python, [tool, ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (e) => resolve({ status: 1, out: `could not run ${python}: ${e.message}` }));
    child.on("close", (status) => resolve({ status: status ?? 1, out: out.trim() }));
  });
}

/** Vault-relative paths changed since the last round (filled by the watcher in step 3). */
const changed = new Set();
/** Vault-relative paths sync just wrote -> until when their watcher events are sync's own echo, not an edit. */
const ownWrites = new Map();

/** `sync` then `export`. Any prose edit changes the generated graph, which `check` (and so `export`) insists is
 *  current; syncing first is what makes an Obsidian edit flow straight through. MQE_DEV_SYNC=0 skips it. */
async function exportVault() {
  if (process.env.MQE_DEV_SYNC !== "0") {
    const sync = await runTool(["--vault", vault, "sync"]);
    const until = Date.now() + DEBOUNCE_MS;
    for (const m of sync.out.matchAll(/^sync: wrote (.+)$/gm)) {
      const p = m[1].trim();
      // the event may already be queued (sync takes a while); then it is dropped here instead
      if (!changed.delete(p)) ownWrites.set(p, until);
    }
    if (sync.status !== 0) return sync;
  }
  return runTool(["--vault", vault, "export", "--out", OUT]);
}

const stamp = () => new Date().toLocaleTimeString();

function report({ status, out }, started) {
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (status === 0) {
    const summary = out.split(/\r?\n/).find((l) => l.startsWith("export:")) ?? "export: ok";
    console.log(`[${stamp()}] ${summary} (${secs}s)`);
    return true;
  }
  console.error(`\n[${stamp()}] export failed - keeping the last good content/. Fix these and save again:\n`);
  console.error(out.split(/\r?\n/).map((l) => `  ${l}`).join("\n"));
  console.error("");
  return false;
}

// 1. Export first, so the server never starts on stale or missing content.
const first = Date.now();
if (!report(await exportVault(), first)) {
  console.error("The dev server starts anyway with whatever content/ holds; it reloads once an export succeeds.\n");
}

// 2. Vite through its JS API.
const server = await createServer({ root: REPO, configFile: path.join(REPO, "vite.config.ts") });
await server.listen();
server.printUrls();

// 3. Watch the vault. chokidar 5 has no globs, so filtering is by path: notes (*.md), figures, widget specs and
// data exports matter; Obsidian's and Claudian's state, the tool's generated files and temp files do not.
const IGNORED_DIRS = new Set([".obsidian", ".claudian", ".git", ".trash", "node_modules", "__pycache__"]);
const IGNORED_FILES = new Set(["_meta/graph.json", "_meta/Concept Index.md", "_meta/Model Library.md", "_meta/Backlog.md"]);
const WATCHED_DIRS = ["Attachments/", "Interactives/", "_data/"];

const rel = (p) => path.relative(vault, p).split(path.sep).join("/");
function ignored(p, stats) {
  const r = rel(p);
  if (!r || r.startsWith("..")) return false;
  if (r.split("/").some((part) => IGNORED_DIRS.has(part))) return true;
  if (IGNORED_FILES.has(r) || r.endsWith(".tmp") || r.endsWith("~")) return true;
  if (stats?.isFile()) return !(r.endsWith(".md") || WATCHED_DIRS.some((d) => r.startsWith(d)));
  return false;
}

let timer;
let running = false;
let again = false;

async function reexport() {
  if (running) {
    again = true;
    return;
  }
  if (!changed.size) return;
  running = true;
  const files = [...changed];
  changed.clear();
  const shown = files.slice(0, 3).join(", ") + (files.length > 3 ? ` and ${files.length - 3} more` : "");
  console.log(`[${stamp()}] vault changed (${shown}); re-exporting`);
  const started = Date.now();
  if (report(await exportVault(), started)) server.ws.send({ type: "full-reload", path: "*" });
  running = false;
  if (again) {
    again = false;
    void reexport();
  }
}

const watcher = watch(vault, { ignored, ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 } });
watcher.on("all", (event, p) => {
  if (event === "addDir" || event === "unlinkDir") return;
  const until = ownWrites.get(rel(p));
  if (until !== undefined) {
    ownWrites.delete(rel(p));
    if (Date.now() <= until) return;
  }
  changed.add(rel(p));
  clearTimeout(timer);
  timer = setTimeout(() => void reexport(), DEBOUNCE_MS);
});
watcher.on("ready", () => console.log(`[${stamp()}] watching ${vault} for changes`));
watcher.on("error", (e) => console.error(`watch error: ${e.message}`));

const shutdown = async () => {
  await watcher.close();
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
