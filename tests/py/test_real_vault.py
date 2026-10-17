"""The real vault (mqe.config.json): check is clean, export covers every note, and export is deterministic."""
import json
import pathlib
import tempfile
import unittest

from helpers import VAULT, run_tool, vt


class RealVault(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (VAULT / "_meta" / "vault_tool.py").is_file():
            raise unittest.SkipTest(f"no vault at {VAULT}")
        cls._tmp = tempfile.TemporaryDirectory()
        cls.a, cls.b = pathlib.Path(cls._tmp.name) / "a", pathlib.Path(cls._tmp.name) / "b"
        cls.runs = [run_tool("export", "--out", d) for d in (cls.a, cls.b)]

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_check_has_no_errors(self):
        status, out = run_tool("check")
        self.assertEqual(status, 0, out)

    def test_export_succeeds(self):
        for status, out in self.runs:
            self.assertEqual(status, 0, out)

    def test_export_covers_every_note(self):
        index = json.loads((self.a / "index.json").read_text(encoding="utf-8"))
        db, _ = vt.load()
        typed = {vt.slugify(n["name"]) for n in db.values() if vt.ntype(n) in vt.EXPORT_TYPES}
        self.assertGreaterEqual(len(typed), 160)
        self.assertEqual(set(index["notes"]), typed)
        self.assertEqual({p.stem for p in (self.a / "notes").glob("*.json")}, typed)
        self.assertEqual(index["vault"]["errors"], 0)

    def test_export_is_deterministic(self):
        files = sorted(p.relative_to(self.a) for p in self.a.rglob("*") if p.is_file())
        self.assertEqual(files, sorted(p.relative_to(self.b) for p in self.b.rglob("*") if p.is_file()))
        for rel in files:
            x, y = (self.a / rel).read_bytes(), (self.b / rel).read_bytes()
            if rel.name == "index.json":
                strip = lambda raw: b"\n".join(l for l in raw.split(b"\n") if b'"generated_at"' not in l)
                x, y = strip(x), strip(y)
            self.assertEqual(x, y, f"{rel} differs between two exports")


if __name__ == "__main__":
    unittest.main()
