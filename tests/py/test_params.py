"""Parameterized numeric checks (PLAN.md, "Interface note: params"): 'vary:' and 'compute:' on a numeric check.
Python splits the structure and checks the bindings; `validate` (src/params) evaluates the formula."""
import json
import pathlib
import shutil
import tempfile
import unittest

from helpers import edit, fixture_vault, run_tool, vt

LECTURE = "Courses/Toy 101/Lectures/Toy 101 L1 Growth.md"
TITLE = "With $s = 0.3$, $A = 1$, $\\alpha = 0.5$ and $\\delta = 0.1$, what is $\\bar{k}$?"
VARY = "vary: $s \\in [0.2, 0.4]$ step 0.05; $\\delta \\in \\{0.05, 0.08, 0.1\\}$"
COMPUTE = "compute: $\\left(\\frac{sA}{\\delta}\\right)^{\\frac{1}{1-\\alpha}}$"


def parse(*keys, title=TITLE, answer="answer: 9 ± 1%"):
    return vt.parse_check("-", title, [answer, *keys, "", "**Why:** square $sA/\\delta$."])


class Parse(unittest.TestCase):
    def test_a_varied_check(self):
        chk, errs = parse(VARY, COMPUTE, "wrong: $sA/\\delta$ — that is $sA/\\delta$ before the power")
        self.assertEqual(errs, [])
        self.assertEqual(chk["vary"], [{"sym": "s", "lo": 0.2, "hi": 0.4, "step": 0.05},
                                       {"sym": "\\delta", "values": [0.05, 0.08, 0.1]}])
        self.assertEqual(chk["compute"], "\\left(\\frac{sA}{\\delta}\\right)^{\\frac{1}{1-\\alpha}}")
        self.assertEqual([(b["sym"], b["value"], b["span"]) for b in chk["bindings"]],
                         [("s", 0.3, "$s = 0.3$"), ("A", 1.0, "$A = 1$"), ("\\alpha", 0.5, "$\\alpha = 0.5$"),
                          ("\\delta", 0.1, "$\\delta = 0.1$")])
        self.assertEqual(chk["wrongCompute"], [{"tex": "sA/\\delta", "md": "that is $sA/\\delta$ before the power"}])
        self.assertNotIn("wrong", chk)

    def test_a_span_binding_several_symbols(self):
        chk, errs = parse("vary: $a \\in [1, 3]$", "compute: $a + b$", title="With $a = 2, b = 3$, what is $a + b$?",
                          answer="answer: 5 ± 0.01")
        self.assertEqual(errs, [])
        self.assertEqual([(b["sym"], b["span"]) for b in chk["bindings"]], [("a", "$a = 2, b = 3$"), ("b", "$a = 2, b = 3$")])

    def test_a_plain_check_is_unchanged(self):
        chk, errs = parse()
        self.assertEqual(errs, [])
        self.assertEqual(set(chk), {"kind", "prompt", "answer", "tol", "why"})

    def test_each_error(self):
        cases = [
            ((VARY,), "'vary:' and 'compute:' go together"),
            ((COMPUTE,), "'vary:' and 'compute:' go together"),
            ((VARY, "compute: sA/\\delta"), "compute: 'sA/\\delta' must be one formula in '$…$'"),
            (("vary: $s$ from 0.2 to 0.4", COMPUTE), "vary: '$s$ from 0.2 to 0.4' must look like"),
            (("vary: $s \\in [0.4, 0.2]$", COMPUTE), "vary: $s$: the range [0.4, 0.2] must run from low to high"),
            (("vary: $s \\in [0.2, 0.4]$ step 0.03", COMPUTE), "vary: $s$: step 0.03 must be positive and divide [0.2, 0.4] evenly"),
            (("vary: $s \\in \\{0.3\\}$", COMPUTE), "must be a range '[0.2, 0.4]' (with an optional 'step') or a set of at least two numbers"),
            (("vary: $q \\in [1, 2]$", COMPUTE), "vary: $q$ has no '$q = <number>$' in the question - its base value comes from there"),
            (("vary: $s \\in [0.4, 0.6]$", COMPUTE), "vary: $s$: the question's value 0.3 lies outside [0.4, 0.6]"),
            (("vary: $s \\in [0.2, 0.4]$; $s \\in [0.1, 0.5]$", COMPUTE), "vary: $s$ is listed twice"),
            ((VARY, VARY, COMPUTE), "has two 'vary:' lines"),
            ((VARY, COMPUTE, "wrong: 3 — x"), "wrong: 3 is a fixed number on a varied check"),
            ((VARY, COMPUTE, "wrong: $sA/\\delta$"), "wrong: line needs '$formula$ — message' on a varied check"),
            (("wrong: $sA/\\delta$ — x",), "wrong: $sA/\\delta$ is a formula - formula wrong answers need 'vary:' and 'compute:'"),
        ]
        for keys, expected in cases:
            with self.subTest(expected=expected):
                chk, errs = parse(*keys)
                self.assertTrue(any(expected in e for e in errs), errs)
        _, errs = parse(VARY, COMPUTE, title="With $s = 0.3$ or $s = 0.3$, $A = 1$, $\\alpha = 0.5$, $\\delta = 0.1$?")
        self.assertIn("vary: $s$ is set 2 times in the question - write '$s = <number>$' once", errs)
        _, errs = parse(VARY, COMPUTE, answer="answer: 9")
        self.assertIn("a varied check needs a tolerance, e.g. 'answer: 9 ± 1%' - a drawn answer is rarely a round number", errs)
        _, errs = vt.parse_check("-", TITLE, ["- [x] a", "- [ ] b", VARY, "**Why:** w"])
        self.assertIn("'vary:' and 'compute:' go with 'answer:' - a multiple-choice check has no number to vary", errs)


class Fixture(unittest.TestCase):
    """The fixture lecture's varied check: `check` names the line, and the export carries the fields."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.vault = fixture_vault(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_check_names_the_line(self):
        edit(self.vault / LECTURE, "> vary: $s \\in [0.2, 0.4]$ step 0.05", "> vary: $s \\in [0.5, 0.9]$ step 0.05")
        status, out = run_tool("--vault", self.vault, "check")
        self.assertEqual(status, 1, out)
        self.assertIn("check at line 142: vary: $s$: the question's value 0.3 lies outside [0.5, 0.9]", out)

    def test_export(self):
        out = pathlib.Path(self._tmp.name) / "content"
        status, log = run_tool("--vault", self.vault, "export", "--out", out)
        self.assertEqual(status, 0, log)
        body = json.loads((out / "notes/toy-101-l1-growth.json").read_text(encoding="utf-8"))
        (chk,) = [b for s in body["sections"] for st in s["steps"] for b in st["blocks"] if b.get("vary")]
        self.assertEqual((chk["answer"], chk["tol"], chk["compute"]), (9.0, 0.09, "\\left(\\frac{sA}{\\delta}\\right)^{\\frac{1}{1-\\alpha}}"))
        self.assertEqual(list(chk), ["t", "kind", "prompt", "answer", "tol", "vary", "compute", "bindings", "wrongCompute", "why"])


if __name__ == "__main__":
    unittest.main()
