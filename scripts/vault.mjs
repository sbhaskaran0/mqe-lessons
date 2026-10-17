// npm run check | sync | export  ->  the vault's _meta/vault_tool.py, with the vault from mqe.config.json.
// `export` writes the player's input to content/ (gitignored).
import { CONTENT, vaultTool } from "./lib.mjs";

const [command, ...rest] = process.argv.slice(2);
const args = command === "export" ? ["export", "--out", CONTENT, ...rest] : [command, ...rest];
process.exit(vaultTool(args).status);
