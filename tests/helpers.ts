// Test helpers: run the vault tool against a synced copy of the fixture vault and export it.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(path.join(REPO, "mqe.config.json"), "utf8")) as { vault: string; python?: string };
const TOOL = path.join(process.env.MQE_VAULT ?? cfg.vault, "_meta", "vault_tool.py");
const PYTHON = process.env.MQE_PYTHON ?? cfg.python ?? "python";

export function vaultTool(...args: string[]): { status: number; out: string } {
  const r = spawnSync(PYTHON, [TOOL, ...args], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" } });
  return { status: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** A fresh directory for test output. Under vitest it sits in the run's scratch root, which tests/global-setup.ts
 *  removes when the run ends. */
export function scratchDir(prefix: string): string {
  return mkdtempSync(path.join(process.env.MQE_SCRATCH ?? tmpdir(), `${prefix}-`));
}

/** Export tests/fixtures/vault (after a sync of a scratch copy) and return the output directory: a new scratch
 *  directory, or `into`, emptied first. */
export function exportFixture(into?: string): string {
  if (into) {
    rmSync(into, { recursive: true, force: true });
    mkdirSync(into, { recursive: true });
  }
  const tmp = into ?? scratchDir("mqe-fixture");
  const vault = path.join(tmp, "vault");
  cpSync(path.join(REPO, "tests", "fixtures", "vault"), vault, { recursive: true });
  for (const args of [["--vault", vault, "sync"], ["--vault", vault, "export", "--out", path.join(tmp, "content")]]) {
    const r = vaultTool(...args);
    if (r.status !== 0) throw new Error(r.out);
  }
  return path.join(tmp, "content");
}
