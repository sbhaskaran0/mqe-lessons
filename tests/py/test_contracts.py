"""The Phase 2 authoring contract (docs/proposals/phase2-contracts.md): '> [!derive]-' derivations, interactive
callouts and planned placeholders, objective tags and `coverage`, check and predict feedback, rubrics. Parsers are
tested directly; every `check` message on a minimal edit of the fixture vault, which uses each construct once."""
import json
import pathlib
import shutil
import tempfile
import unittest

from helpers import edit, fixture_vault, run_tool, vt

LECTURE = "Courses/Toy 101/Lectures/Toy 101 L1 Growth.md"
ANSWERS = "Courses/Toy 101/Practice/Toy 101 L1 Answers.md"
QUESTIONS = "Courses/Toy 101/Practice/Toy 101 L1 Questions.md"
GOLDEN_RULE = "Interactives/Toy Golden Rule.md"
CONVERGENCE = "Interactives/Toy Convergence.md"

DERIVE = """\
objective: 4, 6
notation: [[Solow Growth Model]]
symbols: $s \\in (0.05, 0.95)$, $A$
unknowns: $b_1$ real, $\\mathbf{X}$ is $n \\times K$
given: $sA\\bar{k}^{\\alpha} = \\delta\\bar{k}$

1. Divide by $\\delta\\bar{k}^{\\alpha}$: $\\bar{k}^{1-\\alpha} = \\frac{sA}{\\delta}$
   justify: Why may we divide?
   - [ ] Because $\\alpha < 1$
   - [x] Because $\\bar{k} > 0$
2. $\\bar{k} = (sA/\\delta)^{1/(1-\\alpha)}$
   hint: Raise both sides to $1/(1-\\alpha)$.

accept: $\\bar{k}^{1-\\alpha} = sA/\\delta$
reject: $\\bar{k} = (sA/\\delta)^{1/\\alpha}$ — the power is $1/(1-\\alpha)$""".split("\n")


class Derive(unittest.TestCase):
    def errors(self, lines, fold="-", title="Solve for $\\bar{k}$"):
        return [(s, m) for s, m in vt.parse_derive(fold, title, lines)[1]]

    def test_structure(self):
        d, errs = vt.parse_derive("-", "Solve", DERIVE)
        self.assertEqual(errs, [])
        self.assertEqual((d["objectives"], d["notation"]), ([4, 6], "Solow Growth Model"))
        self.assertEqual(d["symbols"], ["s \\in (0.05, 0.95)", "A"])
        self.assertEqual(d["unknowns"], ["$b_1$ real", "$\\mathbf{X}$ is $n \\times K$"])
        self.assertEqual(d["given"], ["sA\\bar{k}^{\\alpha} = \\delta\\bar{k}"])
        one, two = d["steps"]
        self.assertEqual(one["tex"], "\\bar{k}^{1-\\alpha} = \\frac{sA}{\\delta}")
        self.assertEqual(one["justify"], {"prompt": "Why may we divide?", "options": [("Because $\\alpha < 1$", False), ("Because $\\bar{k} > 0$", True)]})
        self.assertEqual((two["hint"], one["hint"], two["justify"]), ("Raise both sides to $1/(1-\\alpha)$.", None, None))
        self.assertEqual(d["reject"], [("\\bar{k} = (sA/\\delta)^{1/\\alpha}", "the power is $1/(1-\\alpha)$")])

    def test_each_structural_error(self):
        cases = [
            (dict(fold=""), (None, "fold it with '-' ('> [!derive]-') so the worked steps stay hidden in Obsidian")),
            (dict(title=""), (None, "put what it shows on the callout line: '> [!derive]- Show that …'")),
            (dict(lines=["given: $x = 1$"]), (None, "needs numbered steps '1. … $maths$'; the last step is the target")),
            (dict(lines=["1. Divide through"]), ("1", "the step's maths must be the last $…$ on its line")),
            (dict(lines=["1. $x = 1$", "reject: x = 2 - no"]), (None, "reject line needs '$maths$ — message' (an em dash, then why it is wrong)")),
            (dict(lines=["symbol: $s$", "1. $x = 1$"]), (None, "unknown key 'symbol:' - use one of " + ", ".join(vt.DERIVE_KEYS))),
            (dict(lines=["1. $x = 1$", "   justify: Why?", "   - [ ] a", "   - [ ] b"]), ("1", "justify needs '- [x]' on the right option")),
            (dict(lines=["1. $x = 1$", "   justify: Why?", "   - [x] a"]), ("1", "justify needs at least two '- [ ]' options")),
            (dict(lines=["1. $x = 1$", "   hint: a", "   hint: b"]), ("1", "has two 'hint:' lines - keep one")),
            (dict(lines=["1. $x = 1$", "   - [x] a"]), ("1", "option needs a 'justify:' question above it")),
            (dict(lines=["1. $x = 1$", "   and so on"]), ("1", "line under the step is not 'hint:', 'justify:' or a '- [ ]' option")),
            (dict(lines=["Then we solve.", "1. $x = 1$"]), (None, "line is neither 'key: value' nor a numbered step '1. … $maths$'")),
            (dict(lines=["given: x = 1", "1. $x = 1$"]), (None, "given needs its maths in $…$")),
            (dict(lines=["objective: four", "1. $x = 1$"]), (None, "objective 'four' must be a number, or numbers like 'objective: 4, 6'")),
        ]
        for kw, expected in cases:
            with self.subTest(expected=expected[1]):
                args = {"fold": "-", "title": "T", "lines": ["1. $x = 1$"], **kw}
                self.assertIn(expected, self.errors(args["lines"], args["fold"], args["title"]))


class CheckFeedback(unittest.TestCase):
    def test_option_feedback_sits_under_its_option(self):
        chk, errs = vt.parse_check("-", "Q", ["- [ ] a", "  - not a: see b", "    wrapped", "- [x] b", "objective: 2", "**Why:** w"])
        self.assertEqual(errs, [])
        self.assertEqual((chk["options"], chk["feedback"], chk["objectives"]), ([["a", False], ["b", True]], ["not a: see b wrapped", None], [2]))
        (b,) = vt.Exporter({}, {}, {}).block({"k": "callout", "kind": "check", "fold": "-", "title": "Q",
                                              "lines": ["- [ ] a", "  - not a", "- [x] b", "**Why:** w"]})
        self.assertEqual(b["options"], [{"md": "a", "correct": False, "feedback": "not a"}, {"md": "b", "correct": True}])

    def test_misplaced_feedback(self):
        for lines in (["- [ ] a", "- not indented", "- [x] b"], ["- [ ] a", "  - one", "  - two", "- [x] b"]):
            _, errs = vt.parse_check("-", "Q", lines + ["**Why:** w"])
            self.assertIn("option feedback must sit directly under its option, indented - one bullet per option", errs)

    def test_wrong_answers(self):
        chk, errs = vt.parse_check("-", "Q", ["answer: 34.66 ± 0.05", "wrong: 35 ± 0.2 — the rule of 70", "wrong: 50 -- no compounding", "**Why:** w"])
        self.assertEqual(errs, [])
        self.assertEqual(chk["wrong"], [{"answer": 35.0, "tol": 0.2, "md": "the rule of 70"}, {"answer": 50.0, "tol": 0.0, "md": "no compounding"}])
        cases = [("wrong: 34.7 — close", "wrong: 34.7 lies within the right answer 34.66 ± 0.05 - a wrong answer must fall outside it"),
                 ("wrong: 35", "wrong: line needs '<value> [± tol] — message'"),
                 ("wrong: about 35 — x", "wrong: line needs '<value> [± tol] — message'")]
        for line, expected in cases:
            self.assertIn(expected, vt.parse_check("-", "Q", ["answer: 34.66 ± 0.05", line, "**Why:** w"])[1])
        _, errs = vt.parse_check("-", "Q", ["- [x] a", "- [ ] b", "wrong: 3 — x", "**Why:** w"])
        self.assertIn("'wrong:' lines go with 'answer:'; give an option's feedback as a bullet under it", errs)

    def test_objective_tags(self):
        self.assertEqual(vt.objective_tags(4), ([4], None))
        self.assertEqual(vt.objective_tags("4, 6, 4"), ([4, 6], None))
        self.assertEqual(vt.objective_tags("0")[1], "objectives are numbered from 1")
        self.assertEqual(vt.objective_tags(True)[1], "objective 'True' must be a number, or numbers like 'objective: 4, 6'")


SPEC = {"type": "panels", "params": {"s": {"default": 0.5, "min": 0, "max": 1}}, "readouts": [{"id": "kbar_out", "expr": "s"}],
        "panels": [{"kind": "curve", "id": "diagram", "curves": [{"id": "saving"}]}]}


class Placements(unittest.TestCase):
    def test_callout_is_the_mapping_a_fence_holds(self):
        self.assertEqual(vt.callout_placement("Raise $s$", ["widget: W", "state: {s: 0.4}"]),
                         ({"widget": "W", "state": {"s": 0.4}, "prompt": "Raise $s$"}, None))
        self.assertEqual(vt.callout_placement("(planned) See the peak", ["widget: W"]),
                         ({"widget": "W", "status": "planned", "prompt": "See the peak"}, None))
        self.assertEqual(vt.callout_placement("Q", ["widget: W", "prompt: P"])[1], "has both a title and 'prompt:' - the title is the prompt, so drop 'prompt:'")
        self.assertEqual(vt.callout_placement("(planned) Q", ["widget: W", "status: live"])[1], "the title says (planned) but status is 'live' - keep one")

    def test_both_forms_in_line_order(self):
        body = "> [!interactive] A\n> widget: W\n\n```interactive\nwidget: V\n```\n"
        (a, b) = vt.placements_in(body)
        self.assertEqual((a.form, a.fold, a.line, a.end, a.data["widget"]), ("callout", "", 0, 1, "W"))
        self.assertEqual((b.form, b.line, b.end), ("fence", 3, 5))

    def test_predict_rules(self):
        cases = [
            ({"options": ["a", {"text": "b", "why": "x"}]}, "predict option 2: use a string or {text, feedback}"),
            ({"feedback": ["x"]}, "predict.feedback needs options"),
            ({"options": ["a", "b"], "feedback": ["x"]}, "predict.feedback must list one text (or null) per option, in order"),
            ({"options": ["a", {"text": "b", "feedback": "y"}], "feedback": [None, "z"]}, "predict.feedback repeats feedback an option already gives in {text, feedback}"),
            ({"readout": "nope", "tol": 1}, "predict.readout 'nope' is not a readout of the widget"),
            ({"options": ["a", "b"], "readout": "kbar_out", "tol": 1}, "predict has both options and readout - use one"),
            ({"readout": "kbar_out"}, "predict.readout needs tol"),
            ({"tol": 1}, "predict.tol goes with predict.readout"),
        ]
        for extra, expected in cases:
            with self.subTest(expected=expected):
                self.assertIn(expected, vt.validate_block({"widget": "W", "predict": {"hide": [], "ask": "?", **extra}}, SPEC))
        ok = {"widget": "W", "predict": {"hide": ["saving"], "ask": "?", "options": ["a", {"text": "b", "feedback": "y"}], "answer": 1, "why": "w", "reflect": True}}
        self.assertEqual(vt.validate_block(ok, SPEC), [])
        self.assertEqual(vt.predict_options(ok["predict"]), (["a", "b"], [None, "y"]))

    def test_a_planned_block_with_no_widget_checks_only_its_shape(self):
        self.assertEqual(vt.validate_block({"widget": "W", "status": "planned", "lock": ["anything"]}, None), [])
        self.assertIn("brief: unknown key 'colour' (allowed: purpose, model, panels, learner, goal, predict, numbers, added, route, source, grid, table)",
                      vt.validate_block({"widget": "W", "brief": {"colour": 1}}, None))
        self.assertIn("brief.numbers[0]: missing 'expect'", vt.validate_block({"widget": "W", "brief": {"numbers": [{"params": {}}]}}, None))

    def test_a_brief_declares_its_route(self):
        from datetime import date
        issues = lambda **b: vt._brief_issues({"brief": b}, None, None, "W")
        new, old = date(2026, 10, 18), date(2026, 10, 16)
        self.assertEqual(issues(route="expression", added=new), [])
        self.assertEqual(issues(route="precomputed", source="nb cells 1-2", grid={"h": "0.5..1.5 step 0.5"}, table=["kde: h"]), [])
        self.assertEqual(issues(added=new), [(True, "W: brief needs 'route: expression | precomputed'")])
        self.assertEqual(issues(added=old), [(False, "W: brief needs 'route: expression | precomputed' (older brief: add it before building)")])
        self.assertEqual(issues(route="live"), [(True, "W: brief.route 'live' must be 'expression' or 'precomputed'")])
        self.assertEqual(issues(route="precomputed", grid={"h": "x"}),
                         [(True, "W: 'route: precomputed' brief needs 'source:'"), (True, "W: 'route: precomputed' brief needs 'table:'")])
        self.assertEqual(issues(route="expression", source="nb"), [(True, "W: brief.source belongs to 'route: precomputed'")])
        self.assertEqual(vt._brief_issues({"brief": {"added": old}}, None, None, "W", planned=False), [])   # live widget: history
        self.assertIn("brief.grid must be a mapping", vt.validate_block({"widget": "W", "brief": {"grid": "h"}}, None))


class Rubric(unittest.TestCase):
    ANSWERS = "## A\n\n> [!rubric]- Early\n> - a\n> - b\n\n**1.** Nine.\n\n> [!rubric]- Key steps\n> - Set $I = D$\n>   then solve\n> - Substitute\n\n**2.** No.\n"

    def test_sites_belong_to_the_answer_above(self):
        self.assertEqual([(line, n) for line, n, _ in vt.rubric_sites(self.ANSWERS)], [(2, None), (8, "1")])
        self.assertEqual(vt.rubric_items(["- Set $I = D$", "  then solve", "- Substitute"]), (["Set $I = D$ then solve", "Substitute"], True))
        self.assertFalse(vt.rubric_items(["- only one"])[1])
        self.assertFalse(vt.rubric_items(["- a", "prose", "- b"])[1])

    def test_export_moves_the_rubric_out_of_the_answer(self):
        (_, _, text), = [a for a in vt.practice_answers(self.ANSWERS) if a[0] == "1"]
        self.assertEqual(vt.split_rubric(text), ("Nine.", ["Set $I = D$ then solve", "Substitute"]))


class FixtureTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.vault = fixture_vault(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def mutate(self, path, old, new, count=1):
        edit(self.vault / path, old, new, count)

    def check(self):
        return run_tool("--vault", self.vault, "check")

    def export(self, name="content"):
        out = pathlib.Path(self._tmp.name) / name
        status, log = run_tool("--vault", self.vault, "export", "--out", out)
        self.assertEqual(status, 0, log)
        return out


class CheckMessages(FixtureTest):
    """One edit each; the message `check` gives. Errors fail check, warnings do not."""

    ERRORS = [
        (LECTURE, "> [!derive]- Solve", "> [!derive] Solve", "derive at line 105: fold it with '-' ('> [!derive]-')"),
        (LECTURE, "> 2. Take the", "> 2. Take the power: no maths here\n> 3. Take the", "derive at line 105, step 2: the step's maths must be the last $…$ on its line"),
        (LECTURE, "> notation: [[Toy Growth Model]]", "> notation: [[Toy 101]]", "derive at line 105: notation [[Toy 101]] has no '## Notation' table"),
        (LECTURE, "> unknowns:", "> unknown:", "derive at line 105: unknown key 'unknown:'"),
        (LECTURE, "> objective: 2\n> notation", "> objective: 7\n> notation", "derive at line 105: objective 7 is out of range - this lecture lists objectives 1–3 under '## What to be able to do'"),
        (LECTURE, "Setting investment equal to depreciation pins down $\\bar{k}$ in two steps.\n\n> [!derive]-",
         "Setting investment equal to depreciation pins down $\\bar{k}$ in two steps.\n\n> [!note] Box\n> > [!derive]-", "derive at line 106 sits inside another callout or quote"),
        (LECTURE, "> - [x] It is unchanged", ">   - feedback twice\n> - [x] It is unchanged", "option feedback must sit directly under its option, indented"),
        (LECTURE, "> wrong: 5 —", "> wrong: 25.01 —", "wrong: 25.01 lies within the right answer 25 ± 0.05"),
        (LECTURE, "readout: kbar_out, tol: 0.05", "readout: kbar_outt, tol: 0.05", "predict.readout 'kbar_outt' is not a readout of the widget"),
        (LECTURE, "readout: kbar_out, tol: 0.05", "readout: kbar_out", "predict.readout needs tol"),
        (LECTURE, "    - Rises gradually\n", "    - {text: Rises gradually, colour: red}\n", "predict option 2: use a string or {text, feedback}"),
        (LECTURE, "Work out $\\bar{k}$ for $s = 0.4$, then reveal it\n", "Work out $\\bar{k}$ for $s = 0.4$, then reveal it\n> prompt: twice\n",
         "interactive callout at line 123: has both a title and 'prompt:'"),
        (LECTURE, "> widget: Toy Golden Rule\n", "> widget: Toy Golden Rule\n> status: live\n", "the title says (planned) but status is 'live' - keep one"),
        (LECTURE, "widget: Toy Saving Chart\n", "widget: Toy Saving Chart\nstatus: soon\n", "status must be 'planned' - drop it once the widget is live"),
        (LECTURE, "> figure: Toy diagram.png", "> figure: Nope.png", "interactive callout at line 130: figure 'Nope.png' is not in Attachments/"),
        (LECTURE, "  hint: \"Watch the consumption readout.\"\nobjective: 3", "  hint: \"Watch the consumption readout.\"\nobjective: 3, 9",
         "placement at line 43: objective 9 is out of range"),
        (QUESTIONS, "> answer: 9 ± 1%", "> answer: 9 ± 1%\n> objective: 1", "check at line 14: objective tags only work in lecture notes with a '## What to be able to do' list"),
        (ANSWERS, "Questions: [[Toy 101 L1 Questions]].", "Questions: [[Toy 101 L1 Questions]].\n\n> [!rubric]- Stray\n> - a\n> - b",
         "rubric at line 11 is not under an answer - put it after '**N.**' in the answer it grades"),
        (ANSWERS, "> - Solve for", "> Solve for", "rubric at line 13: list each key step as '- …' (at least two)"),
    ]
    WARNINGS = [
        (LECTURE, "> [!interactive]- Work out", "> [!interactive] Work out",
         "interactive callout at line 123: fold it with '-' ('> [!interactive]-') so it stays one line in Obsidian"),
        (LECTURE, "> figure: Toy diagram.png\n", "", "interactive callout at line 130: planned placement has no 'figure:' - the step's text must carry it alone"),
        (LECTURE, "> widget: Toy Golden Rule", "> widget: Toy Someday",
         "interactive callout at line 130: planned widget 'Toy Someday' has no note in Interactives/ yet (fine until it is built)"),
        (LECTURE, "> brief:\n", "> brief:\n>   colour: red\n", "planned: interactive callout at line 130: brief: unknown key 'colour'"),
        (LECTURE, "show: [rich, poor, crisis]", "show: [rich, poor, crisis]\nobjective: 1",
         "placement at line 96: objective 1 on a watch-only placement tests nothing - add a goal or predict"),
        (LECTURE, "  hint: \"Watch the consumption readout.\"\nobjective: 3", "  hint: \"Watch the consumption readout.\"",
         "objective 3 (\"Find the golden-rule saving rate.\") has no check, derivation, goal or prediction tagged 'objective: 3'"),
        (LECTURE, "> notation: [[Toy Growth Model]]\n> symbols: $s \\in (0.05, 0.95)$, $\\alpha \\in (0.2, 0.8)$, $\\delta \\in (0.02, 0.2)$\n", "",
         "derive at line 105: symbol 'A' is defined by [[Toy Growth Model]] and [[Toy Production Function]]; add 'notation: [[Toy Growth Model]]' to pick one"),
    ]

    def run_cases(self, cases, status_expected):
        pristine = pathlib.Path(self._tmp.name) / "pristine"
        shutil.copytree(self.vault, pristine)
        for path, old, new, expected in cases:
            with self.subTest(expected=expected):
                shutil.rmtree(self.vault)
                shutil.copytree(pristine, self.vault)
                self.mutate(path, old, new)
                run_tool("--vault", self.vault, "sync")       # a renamed widget changes derived lessons
                status, out = self.check()
                self.assertEqual(status, status_expected, out)
                self.assertIn(expected, out)

    def test_errors(self):
        self.run_cases(self.ERRORS, 1)

    def test_warnings(self):
        self.run_cases(self.WARNINGS, 0)

    def test_rubric_on_an_answer_with_no_question(self):
        self.mutate(ANSWERS, "**1.** $\\bar{k}", "**5.** $\\bar{k}")
        status, out = self.check()
        self.assertEqual(status, 0, out)
        self.assertIn("answer 5 has a rubric but question 5 has no match in [[Toy 101 L1 Questions]]", out)

    def test_planned_widget_ready_to_activate_and_live_placements_of_it(self):
        self.mutate(CONVERGENCE, "type: interactive\n", "type: interactive\nstatus: planned\n")
        run_tool("--vault", self.vault, "sync")                      # the Model Library marks it (planned)
        status, out = self.check()
        self.assertEqual(status, 0, out)
        self.assertIn(f"{CONVERGENCE}: planned widget 'Toy Convergence' validates - ready to activate", out)
        self.assertIn("```interactive block at line 78: widget 'Toy Convergence' is planned, so this placement shows its figure", out)
        index = json.loads((self.export() / "index.json").read_text(encoding="utf-8"))
        self.assertNotIn("toy-convergence", index["widgets"])
        self.assertNotIn("toy-convergence", index["notes"]["toy-101-l1-growth"]["interactives"])

    def test_a_planned_placement_repeating_its_embed(self):
        self.mutate(LECTURE, "> [!interactive]- (planned)", "![[Toy diagram.png]]\n\n> [!interactive]- (planned)")
        status, out = self.check()
        self.assertEqual(status, 0, out)
        self.assertIn("the figure is already in the text; drop 'figure:' or the embed", out)

    def test_a_placeholder_never_blocks_the_export(self):
        self.mutate(LECTURE, "> widget: Toy Golden Rule\n", "> widget: Toy Golden Rule\n> lock: [nothing]\n")
        status, out = self.check()
        self.assertEqual(status, 0, out)
        self.assertIn("planned: interactive callout at line 130: lock: 'nothing' is not a parameter of the widget", out)


class Export(FixtureTest):
    def body(self, out, slug="toy-101-l1-growth"):
        return json.loads((out / "notes" / f"{slug}.json").read_text(encoding="utf-8"))

    def test_fence_and_callout_export_the_same_block(self):
        a = self.export("fence")
        self.mutate(LECTURE, "```interactive\nwidget: Toy Steady State Explorer\nstate: {s: 0.4}\nlock: [A, alpha]\n"
                             "show: [saving, depreciation, steady, kbar_out]\nhighlight: steady\n"
                             "prompt: Only $s$ and $\\delta$ move. Raise $s$ and watch where the curve meets the line.\n```",
                    "> [!interactive]- Only $s$ and $\\delta$ move. Raise $s$ and watch where the curve meets the line.\n"
                    "> widget: Toy Steady State Explorer\n> state: {s: 0.4}\n> lock: [A, alpha]\n"
                    "> show: [saving, depreciation, steady, kbar_out]\n> highlight: steady")
        b = self.export("callout")
        self.assertEqual((a / "notes/toy-101-l1-growth.json").read_bytes(), (b / "notes/toy-101-l1-growth.json").read_bytes())

    def test_a_planned_placement_is_the_block_it_will_become(self):
        steps = {st["id"]: st for s in self.body(self.export())["sections"] for st in s["steps"]}
        (planned,) = steps["5-deriving-the-steady-state-4"]["blocks"]
        self.assertEqual(planned, {"t": "interactive", "widget": "toy-golden-rule", "prompt": "See that consumption peaks where $s = \\alpha$",
                                   "status": "planned", "figure": "assets/Attachments/Toy diagram.png",
                                   "purpose": "See that consumption peaks where $s = \\alpha$", "objectives": [3]})
        (derive,) = steps["5-deriving-the-steady-state-2"]["blocks"]
        self.assertEqual((derive["t"], len(derive["steps"]), [r["from"] for r in derive["inherited"]]),
                         ("derive", 2, ["toy-growth-model"] * 5))

    def test_rubric_feedback_and_objectives_never_move_a_step(self):
        before = [st["id"] for s in self.body(self.export("a"))["sections"] for st in s["steps"]]
        self.mutate(LECTURE, ">   - Doubling saving", ">   - Much longer feedback that would push a step over its word cap if it counted. " * 3 + "Doubling saving")
        self.mutate(LECTURE, "objective: 1\n```", "```")
        after = [st["id"] for s in self.body(self.export("b"))["sections"] for st in s["steps"]]
        self.assertEqual(before, after)

    def test_rubric_leaves_the_answer(self):
        q = self.body(self.export(), "toy-101-l1-questions")["practice"]["items"][0]
        self.assertEqual(q["answer"], "$\\bar{k} = (0.3/0.1)^{2} = 9$.")
        self.assertEqual(len(q["rubric"]), 3)


class Coverage(FixtureTest):
    def test_text_and_json(self):
        status, out = run_tool("--vault", self.vault, "coverage")
        self.assertEqual(status, 0, out)
        self.assertEqual(out.splitlines(), [
            "Toy 101 L1 Growth — 3 objectives, 3 tested, 1 derivations",
            "   1  ✓  check, predict",
            "   2  ✓  check, derive, predict",
            "   3  ✓  goal",
            "Toy 101 — 3 objectives, 3 tested (100%); items: 3 checks, 1 derives, 3 goals/predicts (derivations 14%)",
        ])
        status, out = run_tool("--vault", self.vault, "coverage", "--course", "Toy 101", "--json")
        data = json.loads(out)
        self.assertEqual([i["kind"] for i in data["Toy 101 L1 Growth"]["objectives"][1]["items"]], ["check", "derive", "predict"])
        self.assertEqual(data["Toy 101 L1 Growth"]["objectives"][2]["items"], [{"kind": "goal", "line": 43}])
        status, out = run_tool("--vault", self.vault, "coverage", "--course", "Nope 1")
        self.assertIn("coverage: no lecture with a '## What to be able to do' list in Nope 1", out)


if __name__ == "__main__":
    unittest.main()
