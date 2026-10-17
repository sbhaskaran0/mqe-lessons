// Vitest global setup: one scratch root per run for everything tests write (fixture exports, edited copies), removed
// when the run ends so temp folders don't pile up. Workers start after this and inherit MQE_SCRATCH.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export default function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "mqe-test-"));
  process.env.MQE_SCRATCH = root;
  return () => rmSync(root, { recursive: true, force: true, maxRetries: 3 });
}
