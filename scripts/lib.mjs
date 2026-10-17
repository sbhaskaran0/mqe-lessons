// Shared by the npm scripts: repo paths, mqe.config.json, and running the vault's Python tool.
// Paths go to child processes as argument arrays (never through a shell), so the vault's space is safe.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CONTENT = path.join(REPO, "content");

/** Vault path and Python executable: mqe.config.json, overridable with MQE_VAULT / MQE_PYTHON. */
export function config() {
  const file = path.join(REPO, "mqe.config.json");
  const cfg = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const vault = path.resolve(process.env.MQE_VAULT ?? cfg.vault ?? "");
  const python = process.env.MQE_PYTHON ?? cfg.python ?? (process.platform === "win32" ? "python" : "python3");
  const tool = path.join(vault, "_meta", "vault_tool.py");
  if (!existsSync(tool)) fail(`no vault tool at ${tool} - set "vault" in mqe.config.json (or MQE_VAULT)`);
  return { vault, python, tool };
}

/** Run `vault_tool.py <args>`; returns the exit status. */
export function vaultTool(args, { quiet = false } = {}) {
  const { python, tool } = config();
  const r = spawnSync(python, [tool, ...args], {
    stdio: quiet ? "pipe" : "inherit",
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
  });
  if (r.error) fail(`could not run ${python}: ${r.error.message} - set "python" in mqe.config.json`);
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Run a command from the repo root, inheriting output; returns the exit status. `env` adds to the environment. */
export function run(cmd, args, env) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: REPO, ...(env ? { env: { ...process.env, ...env } } : {}) });
  if (r.error) fail(`could not run ${cmd}: ${r.error.message}`);
  return r.status ?? 1;
}

export function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}
