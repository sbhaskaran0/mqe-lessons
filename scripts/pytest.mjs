// npm run test:py -> the Python tests in tests/py (stdlib unittest; they import vault_tool from the configured vault).
import { spawnSync } from "node:child_process";
import { config, REPO } from "./lib.mjs";

const { python } = config();
const r = spawnSync(python, ["-m", "unittest", "discover", "-s", "tests/py", ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: REPO,
  env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
});
process.exit(r.status ?? 1);
