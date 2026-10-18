"""`vault_tool.py data status` on a copy of the fixture vault: clean, a notebook touched after the export, a raw input
touched after it, a hash mismatch, and a missing raw input (informational only)."""
import os
import pathlib
import tempfile
import time
import unittest

from helpers import fixture_vault, run_tool

EXPORT = "_data/exports/toy-saving-rates.csv"
NOTEBOOK = "_data/notebooks/toy-saving.ipynb"
REGISTRY = "_data/registry.yaml"


class DataStatus(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.vault = fixture_vault(self._tmp.name)
        # Checkout order decides which fixture file is newer; pin the export to a known time.
        self.made = time.time() - 1000
        self.touch(EXPORT, 0)
        self.touch(NOTEBOOK, -500)

    def tearDown(self):
        self._tmp.cleanup()

    def touch(self, rel, delta):
        """Set a file's mtime to `delta` seconds after the export."""
        os.utime(self.vault / rel, (self.made + delta, self.made + delta))

    def status(self):
        return run_tool("--vault", self.vault, "data", "status")

    def test_clean(self):
        code, out = self.status()
        self.assertEqual(code, 0, out)
        self.assertIn("2 dataset(s), 0 stale, 0 hash mismatch(es), 0 missing export(s)", out)

    def test_missing_raw_input_is_informational(self):
        code, out = self.status()
        self.assertEqual(code, 0, out)
        self.assertIn("info   toy-saving-rates: raw input C:/toy/survey.csv missing (informational)", out)

    def test_notebook_newer_than_export(self):
        self.touch(NOTEBOOK, 500)
        code, out = self.status()
        self.assertEqual(code, 1, out)
        self.assertIn("stale  toy-saving-rates: notebook", out)
        self.assertIn("is newer than exports/toy-saving-rates.csv", out)
        self.assertIn("1 stale, 0 hash mismatch(es)", out)

    def test_notebook_within_filesystem_slack_is_not_newer(self):
        self.touch(NOTEBOOK, 1)
        self.assertEqual(self.status()[0], 0)

    def test_existing_raw_input_newer_than_export(self):
        raw = pathlib.Path(self._tmp.name) / "survey.csv"
        raw.write_text("a,b\n1,2\n", encoding="utf-8")
        os.utime(raw, (self.made + 900, self.made + 900))
        reg = self.vault / REGISTRY
        reg.write_text(reg.read_text(encoding="utf-8").replace("C:/toy/survey.csv", raw.as_posix()), encoding="utf-8", newline="\n")
        code, out = self.status()
        self.assertEqual(code, 1, out)
        self.assertIn("stale  toy-saving-rates: raw input", out)
        self.assertNotIn("missing (informational)", out)

    def test_hash_mismatch(self):
        path = self.vault / EXPORT
        path.write_text(path.read_text(encoding="utf-8") + "2021,rich,0.3\n", encoding="utf-8", newline="\n")
        self.touch(EXPORT, 0)
        code, out = self.status()
        self.assertEqual(code, 1, out)
        self.assertIn("hash   toy-saving-rates: sha256 of exports/toy-saving-rates.csv does not match", out)
        self.assertIn("0 stale, 1 hash mismatch(es)", out)

    def test_missing_export_file(self):
        (self.vault / EXPORT).unlink()
        code, out = self.status()
        self.assertEqual(code, 1, out)
        self.assertIn("gone   toy-saving-rates", out)

    def test_unknown_subcommand_exits_nonzero(self):
        code, _ = run_tool("--vault", self.vault, "data", "refresh")
        self.assertNotEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
