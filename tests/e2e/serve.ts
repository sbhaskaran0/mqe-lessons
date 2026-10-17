// Static server for the e2e runs: `vite preview` of a production build, the same thing `npm run preview` serves.
//   tsx tests/e2e/serve.ts real <port>     builds content/ into dist/ (skipped when MQE_E2E_PREBUILT=1), serves dist/
//                                          MQE_E2E_SITE=<dir> serves that already-built site instead (npm run lesson keeps one)
//   tsx tests/e2e/serve.ts fixture <port>  exports tests/fixtures/vault, builds it into test-results/e2e-fixture, serves that
import { existsSync } from "node:fs";
import path from "node:path";
import { build, preview } from "vite";
import { exportFixture, REPO } from "../helpers";

const [which, portArg] = process.argv.slice(2);
const port = Number(portArg);
if ((which !== "real" && which !== "fixture") || !Number.isInteger(port)) {
  console.error("usage: tsx tests/e2e/serve.ts real|fixture <port>");
  process.exit(2);
}

if (which === "fixture") {
  // A fixed folder, rebuilt each run: Playwright stops this server with a kill, so it gets no chance to clean up.
  const site = path.join(REPO, "test-results", "e2e-fixture");
  process.env.MQE_CONTENT = exportFixture(site);
  process.env.MQE_OUT = path.join(site, "dist");
  await build({ root: REPO, logLevel: "warn" });
} else {
  delete process.env.MQE_CONTENT;
  delete process.env.MQE_OUT;
  if (!existsSync(path.join(REPO, "content", "index.json"))) {
    console.error("content/index.json is missing - run `npm run export` first");
    process.exit(1);
  }
  const site = process.env.MQE_E2E_SITE;
  if (site) {
    if (!existsSync(path.join(site, "index.html"))) {
      console.error(`MQE_E2E_SITE has no index.html: ${site}`);
      process.exit(1);
    }
    process.env.MQE_OUT = site; // vite preview serves build.outDir, which vite.config.ts reads from MQE_OUT
  } else if (process.env.MQE_E2E_PREBUILT !== "1" || !existsSync(path.join(REPO, "dist", "index.html"))) {
    await build({ root: REPO, logLevel: "warn" });
  }
}

const server = await preview({ root: REPO, preview: { port, strictPort: true, host: "127.0.0.1" }, logLevel: "warn" });
console.log(`${which} content served at http://127.0.0.1:${port}/`);
const stop = () => server.httpServer.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
