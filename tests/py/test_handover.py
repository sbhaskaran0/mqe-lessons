"""The handover from the Cowork ingest to the interactive pass (H2): `interactive: pending` in lecture frontmatter,
the handover warnings `check` gives for pending and interactive lectures, and the `pending` report."""
import json
import pathlib
import tempfile
import unittest

from helpers import edit, fixture_vault, run_tool, strip_items, untag, vt

LECTURE = "Courses/Toy 101/Lectures/Toy 101 L1 Growth.md"
PRODUCTION = "Concepts/Toy Production Function.md"
OBJECTIVES = ("1. Explain why a higher saving rate raises the level of output per worker but not its long-run growth.\n"
              "2. Derive the steady state $\\bar{k}$ from investment equal to depreciation.\n"
              "3. Find the golden-rule saving rate.\n")


class Objectives(unittest.TestCase):
    def test_numbered_list_under_the_heading(self):
        body = "## What to be able to do\n\n1. Derive $k$.\n2) Show it.\n\n## Concepts in this lecture\n\n[[X]]\n"
        self.assertEqual(vt.objectives(body), [(1, "Derive $k$."), (2, "Show it.")])

    def test_missing_empty_and_unnumbered(self):
        self.assertIsNone(vt.objectives("## Other\n\n1. x\n"))
        self.assertIsNone(vt.objectives("## What to be able to do\n\n## Next\n"))
        self.assertEqual(vt.objectives("## What to be able to do\n\n- Derive k.\n"), [])


class Handover(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.vault = fixture_vault(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def mutate(self, path, old, new, count=1):
        edit(self.vault / path, old, new, count)

    def set_flag(self, value):
        self.mutate(LECTURE, "interactive: true", f"interactive: {value}")

    def check(self):
        return run_tool("--vault", self.vault, "check")

    def handover(self, out):
        return [l.split("handover: ", 1)[1] for l in out.splitlines() if l.startswith("warn") and "handover: " in l]

    def export(self, name):
        out = pathlib.Path(self._tmp.name) / name
        status, log = run_tool("--vault", self.vault, "export", "--out", out)
        self.assertEqual(status, 0, log)
        return out

    def test_pending_is_valid_and_ready_when_complete(self):
        self.set_flag("pending")
        status, out = self.check()
        self.assertEqual(status, 0, out)
        self.assertEqual(self.handover(out), [], out)
        status, out = run_tool("--vault", self.vault, "pending")
        self.assertEqual(status, 0, out)
        self.assertIn("Toy 101 L1 Growth  (Courses/Toy 101/Lectures/Toy 101 L1 Growth.md)\n  - ready for the interactive pass", out)
        self.assertIn("pending: 1 lecture(s) waiting for the interactive pass, 0 with handover gaps", out)

    def test_other_values_are_errors(self):
        self.set_flag("maybe")
        status, out = self.check()
        self.assertEqual(status, 1, out)
        self.assertIn("interactive must be true or false, or pending", out)

    def test_pending_needs_no_checkpoints_but_true_does(self):
        strip_items(self.vault / LECTURE)           # goals, predictions and derivations count as checkpoints too
        run_tool("--vault", self.vault, "sync")
        _, out = self.check()
        self.assertIn("interactive lecture has no checkpoints", out)
        self.set_flag("pending")
        _, out = self.check()
        self.assertNotIn("no checkpoints", out)

    def test_missing_objectives(self):
        self.set_flag("pending")
        untag(self.vault / LECTURE)          # tags need the list they point into
        self.mutate(LECTURE, "## What to be able to do\n\n" + OBJECTIVES, "")
        _, out = self.check()
        self.assertEqual(self.handover(out), ["no '## What to be able to do' list - the interactive pass draws its checks from it"])

    def test_unnumbered_objectives(self):
        self.mutate(LECTURE, OBJECTIVES, OBJECTIVES.replace("1. ", "- ").replace("2. ", "- ").replace("3. ", "- "))
        _, out = self.check()
        self.assertEqual(self.handover(out), ["'## What to be able to do' is not a numbered list - write each objective as '1. …'"])

    def test_derive_objective_without_displayed_equations(self):
        self.mutate(LECTURE, "$$y = Ak^{\\alpha}$$", "$y = Ak^{\\alpha}$")
        _, out = self.check()
        self.assertEqual(self.handover(out), ["objectives ask to derive, show or prove, but the lecture has no displayed equations ($$…$$) to derive from"])
        self.mutate(LECTURE, "2. Derive the steady state", "2. Compute the steady state")
        _, out = self.check()
        self.assertEqual(self.handover(out), [], out)

    def test_linked_concept_without_notation(self):
        self.mutate(PRODUCTION, "$$y = f(k) = Ak^{\\alpha}$$", "$y = f(k) = Ak^{\\alpha}$")
        self.mutate(PRODUCTION, "## Notation", "## Symbols")
        _, out = self.check()                       # (the graph keeps notation, so check also asks for a sync)
        self.assertEqual(self.handover(out), ["linked concept [[Toy Production Function]] uses maths but has no '## Notation' table"])
        self.set_flag("pending")
        _, out = run_tool("--vault", self.vault, "pending")
        self.assertIn("  - linked concept [[Toy Production Function]] uses maths", out)
        self.assertIn("1 with handover gaps", out)

    def test_non_interactive_lectures_get_no_handover_warnings(self):
        self.set_flag("false")
        untag(self.vault / LECTURE)          # tags need the list they point into
        self.mutate(LECTURE, "## What to be able to do\n\n" + OBJECTIVES, "")
        status, out = self.check()
        self.assertEqual((status, self.handover(out)), (0, []), out)
        status, out = run_tool("--vault", self.vault, "pending")
        self.assertEqual(status, 0, out)
        self.assertIn("pending: 0 lecture(s)", out)

    def test_export_treats_pending_like_false_but_says_so(self):
        self.set_flag("false")
        a = self.export("false")
        self.mutate(LECTURE, "interactive: false", "interactive: pending")
        b = self.export("pending")
        files = sorted(p.relative_to(a) for p in a.rglob("*") if p.is_file())
        self.assertEqual(files, sorted(p.relative_to(b) for p in b.rglob("*") if p.is_file()))
        meta = json.loads((b / "index.json").read_text(encoding="utf-8"))["notes"]["toy-101-l1-growth"]
        self.assertEqual(meta["interactive"], "pending")              # NoteMeta carries only "pending" for now
        # Editing the lecture between the two exports moves its file time, so "updated" may differ by a second.
        noise = ('"generated_at"', '"updated"', '"interactive": "pending"')
        for rel in files:
            strip = lambda t: "\n".join(l for l in t.split("\n") if not any(n in l for n in noise))
            self.assertEqual(strip((a / rel).read_text(encoding="utf-8", errors="replace")),
                             strip((b / rel).read_text(encoding="utf-8", errors="replace")), rel)


if __name__ == "__main__":
    unittest.main()
