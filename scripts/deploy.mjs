// npm run deploy [-- "commit message"]: check (fail on errors) -> export -> validate -> vitest -> commit and push
// content/ -> vite build -> Netlify production deploy. Skips the e2e run of `npm run build`; only content/ is
// committed, so code changes stay for a reviewed commit.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { REPO, fail, run, vaultTool } from "./lib.mjs";

const node = process.execPath;
const message = process.argv.slice(2).join(" ") || "Content update";
// npx is a .cmd shim on Windows, which spawnSync won't run without a shell; npm's own npx-cli.js runs under node.
if (!process.env.npm_execpath) fail("run this as `npm run deploy`");
const npx = path.join(path.dirname(process.env.npm_execpath), "npx-cli.js");

function commitContent() {
  if (run("git", ["add", "content"]) !== 0) return 1;
  const staged = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: REPO }).status;
  if (staged === 0) {
    console.log("content/ unchanged - nothing to commit");
  } else if (run("git", ["commit", "-q", "-m", message]) !== 0) {
    return 1;
  }
  const other = spawnSync("git", ["status", "--porcelain"], { cwd: REPO, encoding: "utf8" }).stdout.trim();
  if (other) console.warn(`not committed (outside content/):\n${other}`);
  return run("git", ["push", "-q"]);
}

const steps = [
  ["check the vault", () => vaultTool(["check"]).status],
  ["export the vault", () => run(node, ["scripts/vault.mjs", "export"])],
  ["validate content/", () => run(node, ["node_modules/tsx/dist/cli.mjs", "scripts/validate.ts"])],
  ["vitest", () => run(node, ["node_modules/vitest/vitest.mjs", "run"])],
  ["commit and push content/", commitContent],
  ["vite build", () => run(node, ["node_modules/vite/bin/vite.js", "build"])],
  ["netlify deploy", () => run(node, [npx, "netlify-cli", "deploy", "--prod", "--dir", "dist", "--no-build"])],
];

for (const [name, step] of steps) {
  console.log(`\n== ${name}`);
  const status = step();
  if (status !== 0) {
    console.error(`\ndeploy failed at: ${name}`);
    process.exit(status);
  }
}
console.log("\ndeploy: ok - https://mqe-lessons.netlify.app");
