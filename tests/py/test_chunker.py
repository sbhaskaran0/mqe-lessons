"""The chunker (`vault_tool.py export`): golden files for snapshots of real notes - a concept, a lecture, a fact,
a paper, a practice note - plus a synthetic note that exercises every rule in handoff section 6.

Snapshots live in fixtures/notes, so vault edits never break these tests. After an intended chunker change,
regenerate with UPDATE_GOLDEN=1 and review the diff."""
import os
import unittest

from helpers import GOLDEN, NOTES, vt

GOLDEN_NOTES = [
    "Solow Growth Model",
    "Solow Diagram",
    "Econ 402A L1 Solow Growth Model",
    "US Skill Premium Since 1963",
    "Katz and Murphy 1992 - Changes in Relative Wages",
    "Econ 402A L1 Solow Revision Lesson",
    "Math Prep L1 Matrix Algebra Essentials",
    "Chunker Edge Cases",
]


def fixture_db():
    """The fixture notes, plus an empty concept for every other link target so links resolve the same way
    wherever the tests run."""
    db = {}
    for p in sorted(NOTES.glob("*.md")):
        text = p.read_text(encoding="utf-8")
        fm, body = vt.parse(p, text)
        db[p.stem.lower()] = {"name": p.stem, "path": p, "fm": fm, "body": body, "offset": 0}
    for n in list(db.values()):
        for t in vt.links(n["body"]) + vt.fm_links(n["fm"]):
            db.setdefault(t.lower(), {"name": t, "path": NOTES / f"{t}.md", "fm": {"type": "concept"}, "body": "", "offset": 0})
    return db


def body_of(name):
    return vt.Exporter(fixture_db(), {}, {}).body(name.lower())


def steps(body, section=None):
    return [st for s in body["sections"] if section in (None, s["id"]) for st in s["steps"]]


class Golden(unittest.TestCase):
    def test_golden_files(self):
        ex = vt.Exporter(fixture_db(), {}, {})
        for name in GOLDEN_NOTES:
            with self.subTest(note=name):
                text = vt._dump(ex.body(name.lower()))
                golden = GOLDEN / f"{vt.slugify(name)}.json"
                if os.environ.get("UPDATE_GOLDEN"):
                    golden.write_text(text, encoding="utf-8", newline="\n")
                self.assertTrue(golden.exists(), f"no golden file {golden.name} - run with UPDATE_GOLDEN=1")
                self.assertEqual(golden.read_text(encoding="utf-8"), text, f"{name}: chunker output changed")


class Rules(unittest.TestCase):
    """Each chunking rule, asserted directly on the synthetic note."""

    @classmethod
    def setUpClass(cls):
        cls.body = body_of("Chunker Edge Cases")
        cls.sections = {s["id"]: s for s in cls.body["sections"]}

    def test_lead_before_first_heading_is_an_intro_section(self):
        intro = self.body["sections"][0]
        self.assertEqual((intro["id"], intro["role"], intro["heading"]), ("intro", "other", ""))

    def test_intuition_is_one_step_with_why_it_matters_highlighted(self):
        s = self.sections["in-plain-english"]
        self.assertEqual(s["role"], "intuition")
        self.assertEqual(len(s["steps"]), 1)
        self.assertGreater(s["steps"][0]["words"], vt.STEP_WORDS)
        why = s["steps"][0]["blocks"][-1]
        self.assertEqual((why["t"], why["kind"]), ("callout", "why"))
        self.assertEqual(why["md"], "The intuition comes first and stays whole.")

    def test_colon_lead_in_math_and_where_sentence_stay_together(self):
        (step,) = self.sections["definition"]["steps"]
        self.assertEqual([b["t"] for b in step["blocks"]], ["prose", "math", "prose"])
        self.assertTrue(step["blocks"][2]["md"].startswith("where"))

    def test_notation_goes_to_the_drawer_not_a_step(self):
        self.assertNotIn("notation", self.sections)
        self.assertEqual(self.body["notationIntro"], "Prose above the table goes to the notation drawer.")
        own, borrowed = self.body["notation"][:4], self.body["notation"][4:]
        self.assertEqual([r["tex"] for r in own], ["$y$", "$k$", "$\\alpha$", "$sf(k)$"])
        self.assertTrue(all("from" not in r for r in own))
        self.assertEqual(own[3]["keys"], ["~sf(k)"])
        # symbols the note's own table lacks are borrowed from the concepts it links, and marked as such
        self.assertEqual({r["tex"]: r["from"] for r in borrowed},
                         {"$A$": "solow-growth-model", "$s$": "solow-growth-model", "$f(k) = Ak^{\\alpha}$": "solow-growth-model"})

    def test_each_visual_joins_the_text_that_introduces_it(self):
        visual = steps(self.body, "visuals")
        first, second = visual[0]["blocks"], visual[1]["blocks"]
        self.assertEqual([b["t"] for b in first], ["prose", "figure"])
        self.assertEqual(first[1]["caption"], "Caption for the first figure.")
        self.assertEqual([b["t"] for b in second], ["prose", "figure", "prose"])
        self.assertIn("introduces the second figure", second[0]["md"])
        self.assertIn("after the second figure", second[2]["md"])

    def test_symbol_chips_list_the_rows_used_in_the_step(self):
        visual = steps(self.body, "visuals")
        self.assertEqual(visual[0]["symbols"], ["$k$"])
        self.assertEqual(visual[1]["symbols"], ["$k$", "$sf(k)$", "$s$", "$f(k) = Ak^{\\alpha}$"])

    def test_comments_are_dropped_and_manual_breaks_respected(self):
        dumped = vt._dump(self.body)
        self.assertNotIn("private comment", dumped)
        self.assertNotIn("%%", dumped)
        visual = steps(self.body, "visuals")
        self.assertEqual(visual[2]["blocks"][0]["md"], "After a manual break.")

    def test_interactive_block(self):
        widget = next(b for st in steps(self.body, "visuals") for b in st["blocks"] if b["t"] == "interactive")
        self.assertEqual(widget["widget"], "chunker-widget")
        self.assertEqual((widget["state"], widget["lock"], widget["show"]), ({"s": 0.4}, ["A"], ["saving"]))
        self.assertEqual(widget["prompt"], "Raise $s$ and watch the [Solow Diagram](note:solow-diagram).")

    def test_checkpoints_are_steps_of_their_own(self):
        checks = [st for st in steps(self.body, "visuals") if any(b["t"] == "check" for b in st["blocks"])]
        self.assertEqual([len(st["blocks"]) for st in checks], [1, 1])
        mcq, num = (st["blocks"][0] for st in checks)
        self.assertEqual([o["correct"] for o in mcq["options"]], [False, True])
        self.assertEqual(mcq["why"], "Because it is.")
        self.assertAlmostEqual(num["answer"], 2 / 3)
        self.assertEqual(num["tol"], 0.005)

    def test_h3_starts_a_step_and_names_it(self):
        last = steps(self.body, "visuals")[-1]
        self.assertEqual(last["heading"], "A subheading")
        self.assertEqual(last["blocks"][0]["md"], "Text under the subheading.")

    def test_long_lists_are_cut_between_items(self):
        parts = [b["md"] for st in steps(self.body, "long-list") for b in st["blocks"]]
        self.assertTrue(parts[0].endswith(":"))
        items = "\n".join(parts[1:])
        self.assertEqual(sum(line.startswith("- ") for line in items.split("\n")), 4)
        self.assertGreater(len(steps(self.body, "long-list")), 1)
        self.assertTrue(all(st["words"] <= vt.STEP_WORDS + 40 for st in steps(self.body, "long-list")))

    def test_quotes_callouts_and_navigation(self):
        blocks = [b for st in steps(self.body, "quotes-and-callouts") for b in st["blocks"]]
        quote, plain, note = blocks
        self.assertEqual(quote["papers"], ["katz-and-murphy-1992-changes-in-relative-wages"])
        self.assertEqual(plain, {"t": "quote", "md": "A plain blockquote."})
        self.assertEqual((note["kind"], note["folded"], note["title"]), ("note", True, "A folded note"))
        self.assertIn("[the Solow model](note:solow-growth-model)", note["md"])
        self.assertNotIn("Somewhere", vt._dump(self.body))

    def test_step_ids_are_unique_and_stable(self):
        ids = [st["id"] for st in steps(self.body)]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(ids[:3], ["intro-1", "in-plain-english-1", "definition-1"])


class RealNotes(unittest.TestCase):
    def test_lecture_figures_pair_with_their_text(self):
        """Solow L1 section 8: each shock bullet sits with its own figure."""
        shocks = steps(body_of("Econ 402A L1 Solow Growth Model"), "8-shocks")
        self.assertEqual(len(shocks), 2)
        for st, word, fig in ((shocks[0], "Depreciation rises", "rise in depreciation"),
                              (shocks[1], "Saving rate rises", "rise in saving rate")):
            figure = next(b for b in st["blocks"] if b["t"] == "figure")
            self.assertIn(fig, figure["alt"])
            self.assertTrue(any(word in b.get("md", "") for b in st["blocks"]))

    def test_lecture_borrows_notation_from_the_concepts_it_covers(self):
        body = body_of("Econ 402A L1 Solow Growth Model")
        self.assertTrue(body["notation"])
        self.assertTrue(all(r["from"] in ("solow-growth-model", "solow-diagram") for r in body["notation"]))
        steady = steps(body, "6-the-steady-state")[0]
        self.assertIn("$\\bar{k}$, $\\bar{y}$, $\\bar{c}$", steady["symbols"])

    def test_paper_in_lesson_section(self):
        body = body_of("Katz and Murphy 1992 - Changes in Relative Wages")
        sec = next(s for s in body["sections"] if s["role"] == "paper-in-lesson")
        self.assertEqual(sec["lesson"], "econ-424-l2-between-group-inequality")

    def test_self_check_questions_stay_folded(self):
        body = body_of("Math Prep L1 Matrix Algebra Essentials")
        qs = [b for st in steps(body, "self-check") for b in st["blocks"]]
        self.assertEqual(len(qs), 5)
        self.assertTrue(all(b["t"] == "callout" and b["kind"] == "question" and b["folded"] for b in qs))


if __name__ == "__main__":
    unittest.main()
