"""Practice sets (`NoteBody.practice`): question items read from a practice note, answers attached from its paired
answers note. Uses the real-note snapshots in fixtures/notes (the same db as test_chunker) and the fixture vault."""
import json
import pathlib
import tempfile
import unittest

from helpers import fixture_vault, run_tool, vt
from test_chunker import fixture_db

EX = vt.Exporter(fixture_db(), {}, {})


def practice(name):
    return EX.body(name.lower()).get("practice")


def item(p, number):
    return next(i for i in p["items"] if i["number"] == number)


class Solow(unittest.TestCase):
    p = practice("Econ 402A L1 Solow Revision Lesson")

    def test_items_only_from_the_practice_section(self):
        # Part 0's table and the lesson's earlier parts hold no items; Part 7 numbers 1-14.
        self.assertEqual(self.p["answers"], "econ-402a-l1-solow-revision-answers")
        self.assertEqual([i["number"] for i in self.p["items"]], [str(n) for n in range(1, 15)])
        self.assertEqual([i["id"] for i in self.p["items"]][:3], ["q1", "q2", "q3"])

    def test_groups_come_from_bold_labels(self):
        groups = {i["number"]: i["group"] for i in self.p["items"]}
        self.assertEqual(groups["1"], "A. Concepts")
        self.assertEqual(groups["4"], "B. Calculations (basic model, $A = 1$)")
        self.assertEqual(groups["8"], "C. Diagrams (describe in words, or sketch on paper)")
        self.assertEqual(groups["14"], "D. Growth version")

    def test_prompt_keeps_sub_options(self):
        q = item(self.p, "12")
        self.assertTrue(q["prompt"].startswith("Multiple choice"))
        for opt in ("a) $\\tilde{k}$ falls", "\nb) $\\tilde{k}$ rises and per-worker growth falls", "\nc) ", "\nd) Only aggregate growth falls"):
            self.assertIn(opt, q["prompt"])
        self.assertFalse(q["prompt"].startswith("12."))

    def test_answers_keep_the_verdict_not_the_number(self):
        self.assertTrue(item(self.p, "12")["answer"].startswith("**(b).** Lower"))
        self.assertTrue(item(self.p, "2")["answer"].startswith("**False.** A higher saving rate"))
        self.assertTrue(item(self.p, "4")["answer"].startswith("Investment $= 0.3"))
        self.assertTrue(all(i.get("answer") for i in self.p["items"]))
        self.assertNotIn("## ", item(self.p, "3")["answer"])

    def test_links_resolve_wikilinks_in_answers(self):
        q1 = item(self.p, "1")
        self.assertEqual(q1["links"], ["endogenous-and-exogenous-variables"])
        self.assertIn("(note:endogenous-and-exogenous-variables)", q1["answer"])

    def test_the_question_note_still_renders_as_a_lesson(self):
        body = EX.body("econ 402a l1 solow revision lesson")
        self.assertIn("part-0-symbol-cheat-sheet", [s["id"] for s in body["sections"]])
        self.assertIn("part-7-practice-questions", [s["id"] for s in body["sections"]])

    def test_answers_note_has_no_practice(self):
        self.assertNotIn("practice", EX.body("econ 402a l1 solow revision answers"))


class Econ430(unittest.TestCase):
    p = practice("Econ 430 L1 Practice Questions")

    def test_items_and_groups(self):
        self.assertEqual(self.p["answers"], "econ-430-l1-practice-answers")
        self.assertEqual([i["number"] for i in self.p["items"]], [str(n) for n in range(1, 27)])
        groups = {i["number"]: i["group"] for i in self.p["items"]}
        self.assertEqual((groups["1"], groups["8"], groups["17"], groups["26"]),
                         ("A. Derivations", "B. Short conceptual", "C. Interpretation", "D. Harder / synthesis"))

    def test_every_question_is_answered(self):
        self.assertEqual([i["number"] for i in self.p["items"] if not i.get("answer")], [])

    def test_prompt_and_answer_links(self):
        q1 = item(self.p, "1")
        self.assertIn("ols-estimator", q1["links"])
        self.assertTrue(q1["prompt"].endswith("→ [OLS Estimator](note:ols-estimator)"))
        self.assertTrue(q1["answer"].startswith("$\\partial SSR/\\partial b_1"))
        # Links from the answer join the prompt's: Q8's prompt links nothing, its answer points to Homoskedasticity.
        self.assertEqual(item(self.p, "8")["links"], ["homoskedasticity"])
        self.assertEqual(item(self.p, "12")["links"], ["conditional-mean-vs-linear-projection"])
        self.assertTrue(item(self.p, "12")["answer"].startswith("**Incorrect.** Any bivariate"))

    def test_last_answer_runs_to_the_end(self):
        self.assertTrue(item(self.p, "26")["answer"].endswith("→ [Bootstrapping OLS](note:bootstrapping-ols)"))


class Rules(unittest.TestCase):
    """The region, continuation and matching rules on small synthetic notes."""

    def test_intro_list_before_the_first_group_is_skipped(self):
        body = "# T\n\n1. Read the lecture.\n2. Then try these.\n\n## A. Easy\n\n1. First?\n2. Second?\n"
        self.assertEqual(vt.practice_questions(body), [("1", "A. Easy", "First?"), ("2", "A. Easy", "Second?")])

    def test_practice_heading_bounds_the_region(self):
        body = ("## Part 1 — Ideas\n\n1. Not a question.\n\n## Practice\n\n**A. One**\n\n1. Q one\n   $$x$$\n\n"
                "   more text\n2. Q two\nlazy line\n\n## Summary\n\n3. Not a question either.\n")
        self.assertEqual(vt.practice_questions(body),
                         [("1", "A. One", "Q one\n$$x$$\n\nmore text"), ("2", "A. One", "Q two\nlazy line")])

    def test_answers_span_blocks_until_the_next_lead(self):
        body = ("## A. One\n\n**1. True.** Because.\n\n$$\ny = 1\n$$\n\n- a point\n\n**2.** Short.\n\n"
                "```\n**3.** inside a fence\n```\n")
        self.assertEqual(vt.practice_answers(body), [
            ("1", "A. One", "**True.** Because.\n\n$$\ny = 1\n$$\n\n- a point"),
            ("2", "A. One", "Short.\n\n```\n**3.** inside a fence\n```"),
        ])

    def test_numbering_that_repeats_matches_on_group(self):
        db = {
            "q": {"name": "Q", "path": None, "fm": {"type": "practice", "course": "X 1", "lecture": "L1"}, "offset": 0,
                  "body": "## A. One\n\n1. a?\n\n## B. Two\n\n1. b?\n"},
            "q answers": {"name": "Q Answers", "path": None, "fm": {"type": "practice", "course": "X 1", "lecture": "L1"},
                          "offset": 0, "body": "[[Q]]\n\n## A. One\n\n**1.** alpha\n\n## B. Two\n\n**1.** beta\n"},
        }
        p = vt.Exporter(db, {}, {}).practice("q")
        self.assertEqual([(i["id"], i["answer"]) for i in p["items"]], [("qa1", "alpha"), ("qb1", "beta")])


class FixtureVault(unittest.TestCase):
    def test_export_carries_practice(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault = fixture_vault(tmp)
            status, out = run_tool("--vault", vault, "export", "--out", f"{tmp}/content")
            self.assertEqual(status, 0, out)
            q = json.loads((pathlib.Path(tmp) / "content/notes/toy-101-l1-questions.json").read_text(encoding="utf-8"))
            a = json.loads((pathlib.Path(tmp) / "content/notes/toy-101-l1-answers.json").read_text(encoding="utf-8"))
            self.assertEqual(q["practice"]["answers"], "toy-101-l1-answers")
            self.assertEqual([(i["id"], i["answer"][:10]) for i in q["practice"]["items"]],
                             [("q1", "$\\bar{k} ="), ("q2", "No: saving")])
            self.assertNotIn("group", q["practice"]["items"][0])
            self.assertNotIn("practice", a)


if __name__ == "__main__":
    unittest.main()
