// npm run validate [dir] -> check an export (default content/) against the IR, its references and widget tests.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateContent } from "../src/validate";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.resolve(process.argv[2] ?? path.join(repo, "content"));
const { errors, notes, stats } = validateContent(dir);
for (const n of notes) console.log(`note  ${n}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(
  `validate: ${stats.notes} notes, ${stats.steps} steps, ${stats.widgets} widgets, ${stats.datasets} datasets, ` +
    `${stats.assets} assets; ${errors.length} error(s)`,
);
process.exit(errors.length ? 1 : 0);
