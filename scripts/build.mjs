// npm run build: check (fail on errors) -> export -> validate -> tests -> typecheck -> vite build -> e2e on the
// built site.
import { run, vaultTool } from "./lib.mjs";

const node = process.execPath;
const steps = [
  ["check the vault", () => vaultTool(["check"]).status],
  ["export the vault", () => run(node, ["scripts/vault.mjs", "export"])],
  ["validate content/", () => run(node, ["node_modules/tsx/dist/cli.mjs", "scripts/validate.ts"])],
  ["vitest", () => run(node, ["node_modules/vitest/vitest.mjs", "run"])],
  ["python tests", () => run(node, ["scripts/pytest.mjs"])],
  ["typecheck", () => run(node, ["node_modules/typescript/bin/tsc", "--noEmit"])],
  ["vite build", () => run(node, ["node_modules/vite/bin/vite.js", "build"])],
  // The e2e servers serve the dist/ just built instead of building it again.
  ["e2e on the built site", () => ((process.env.MQE_E2E_PREBUILT = "1"), run(node, ["node_modules/@playwright/test/cli.js", "test"]))],
];

for (const [name, step] of steps) {
  console.log(`\n== ${name}`);
  const status = step();
  if (status !== 0) {
    console.error(`\nbuild failed at: ${name}`);
    process.exit(status);
  }
}
console.log("\nbuild: ok");
