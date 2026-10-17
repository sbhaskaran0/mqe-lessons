"""Shared by the Python tests: vault_tool imported from the vault named in mqe.config.json, fixture paths,
and a runner that calls the tool in its own process (so --vault never leaks between tests)."""
import importlib.util
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True          # importing vault_tool must never leave __pycache__ in the vault

REPO = pathlib.Path(__file__).resolve().parents[2]
FIXTURE_VAULT = REPO / "tests" / "fixtures" / "vault"
NOTES = REPO / "tests" / "py" / "fixtures" / "notes"
GOLDEN = REPO / "tests" / "py" / "golden"

_cfg = json.loads((REPO / "mqe.config.json").read_text(encoding="utf-8"))
VAULT = pathlib.Path(os.environ.get("MQE_VAULT") or _cfg["vault"])
TOOL = VAULT / "_meta" / "vault_tool.py"
EXPORT_HELPER = VAULT / "_data" / "mqe_export.py"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


vt = load_module("vault_tool", TOOL)


def run_tool(*args):
    """(exit status, stdout + stderr) of `vault_tool.py <args>`."""
    r = subprocess.run([sys.executable, str(TOOL), *map(str, args)], capture_output=True, text=True,
                       encoding="utf-8", env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    return r.returncode, r.stdout + r.stderr


def fixture_vault(tmp):
    """A synced copy of tests/fixtures/vault under tmp."""
    dst = pathlib.Path(tmp) / "vault"
    shutil.copytree(FIXTURE_VAULT, dst)
    status, out = run_tool("--vault", dst, "sync")
    assert status == 0, out
    return dst


def edit(path, old, new, count=1):
    """Replace text in a fixture file, failing loudly if the text is not there."""
    path = pathlib.Path(path)
    text = path.read_text(encoding="utf-8")
    assert old in text, f"{old!r} not in {path.name}"
    path.write_text(text.replace(old, new, count), encoding="utf-8", newline="\n")


def strip_items(path):
    """Remove every ```interactive fence and every callout from a note: no checks, derivations or placements left."""
    path = pathlib.Path(path)
    text = re.sub(r"^```interactive\n.*?^```\n", "", path.read_text(encoding="utf-8"), flags=re.M | re.S)
    path.write_text("\n".join(l for l in text.split("\n") if not l.startswith(">")), encoding="utf-8", newline="\n")


def untag(path):
    """Remove every 'objective: …' tag from a note (fences and callouts alike)."""
    path = pathlib.Path(path)
    text = re.sub(r"^(?:> )?objective: .*\n", "", path.read_text(encoding="utf-8"), flags=re.M)
    path.write_text(text, encoding="utf-8", newline="\n")
