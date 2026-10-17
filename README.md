# MQE Lessons

A Brilliant-style lesson player compiled from the MQE Obsidian vault. The vault is the only source of truth: this
repo renders what `vault_tool.py export` writes and never parses vault markdown itself. The export (`content/`) is
committed, so a clone can build and serve the site without the vault.

## How it fits together

```
vault (C:/Users/siddh/MQE materials)              this repo
  notes, Attachments/, Interactives/, _data/
  _meta/vault_tool.py  check -> export ------->   content/   index.json + notes/<slug>.json + assets/  (generated)
                                                  src/ir.ts  the contract (zod), checked by `npm run validate`
```

- `content/index.json`: navigation. Courses, domains, tags, every note's metadata and edges, widget specs and datasets.
- `content/notes/<slug>.json`: one note's notation table and its sections, cut into steps of blocks.
- `content/assets/`: every embedded figure and every registered dataset export.

## Commands

| Command | What it does |
| --- | --- |
| `npm run check` | `vault_tool.py check` on the vault (must report 0 errors) |
| `npm run export` | Writes the vault's IR into `content/` (refuses while `check` has errors) |
| `npm run validate` | Validates `content/` against `src/ir.ts`, every slug, asset and symbol chip, and recomputes each widget's `tests` |
| `npm test` | vitest (IR, expressions) and the Python tests in `tests/py` (chunker goldens, check rules, determinism) |
| `npm run build` | check, then export, then validate, then all tests |

The vault path and Python executable live in `mqe.config.json` (or set `MQE_VAULT` / `MQE_PYTHON`).

After an intended chunker change, regenerate the golden files and review the diff:
`UPDATE_GOLDEN=1 python -m unittest discover -s tests/py -p test_chunker.py`.

## Deploy

The site is static (hash routes, relative URLs) and is hosted on Netlify; `netlify.toml` publishes `dist/`. To publish
the current vault:

```
npm run export && npm run validate
npx vite build
npx netlify-cli deploy --prod
```

Commit and push `content/` afterwards, so the repo matches the site.

## Tests

- `tests/fixtures/vault`: a small synthetic vault that follows every rule. It holds widgets of three types, checkpoints and a registered dataset. The Python tests break it one rule at a time.
- `tests/py/fixtures/notes`: snapshots of real notes, so the chunker goldens don't change when the vault does.
