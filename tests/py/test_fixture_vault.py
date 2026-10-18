"""`check`, `sync`, `export` and `rename` on the fixture vault (tests/fixtures/vault): the clean vault passes, and
every rule the handoff adds in section 4.4 fires on a minimal edit that breaks it."""
import json
import pathlib
import shutil
import tempfile
import unittest

from helpers import EXPORT_HELPER, FIXTURE_VAULT, edit, fixture_vault, load_module, run_tool, strip_items

LECTURE = "Courses/Toy 101/Lectures/Toy 101 L1 Growth.md"
EXPLORER = "Interactives/Toy Steady State Explorer.md"
CONVERGENCE = "Interactives/Toy Convergence.md"
CHART = "Interactives/Toy Saving Chart.md"
GOLDEN_RULE = "Interactives/Toy Golden Rule.md"
REGISTRY = "_data/registry.yaml"
QUESTIONS = "Courses/Toy 101/Practice/Toy 101 L1 Questions.md"


class FixtureTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.vault = fixture_vault(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def check(self):
        return run_tool("--vault", self.vault, "check")

    def mutate(self, path, old, new, count=1):
        edit(self.vault / path, old, new, count)


class CleanVault(FixtureTest):
    def test_check_passes(self):
        status, out = self.check()
        self.assertEqual(status, 0, out)
        self.assertIn("0 error(s)", out)
        warnings = [l for l in out.splitlines() if l.startswith("warn")]
        # the planned placeholder (Toy Golden Rule) warns by design and blocks nothing
        self.assertEqual(warnings, [
            f"warn  {GOLDEN_RULE}: planned: spec: panels[0]: missing 'y' (line 29)",
            f"warn  {GOLDEN_RULE}: planned: spec: panels[0]: missing 'curves' (line 29)",
            f"warn  {LECTURE}: interactive callout at line 130: brief needs 'route: expression | precomputed' (older brief: add it before building)",
            f"warn  {LECTURE}: interactive callout at line 130: brief number {{cbar: 2.5}} is not in Toy Golden Rule's tests",
        ], out)                                    # generated notes (Concept Index, Model Library, Backlog) need no inbound links

    def test_sync_derives_widget_lessons_and_is_idempotent(self):
        text = (self.vault / EXPLORER).read_text(encoding="utf-8")
        self.assertIn("lessons:\n- '[[Toy 101 L1 Growth]]'\ncourses:\n- Toy 101", text)
        self.assertEqual(run_tool("--vault", self.vault, "sync"), (0, "sync: 0 file(s) updated\n"))

    def test_graph_v3_and_index(self):
        graph = json.loads((self.vault / "_meta/graph.json").read_text(encoding="utf-8"))
        self.assertEqual(graph["schema"], "mqe-vault-graph/3")
        edges = {(e["source"], e["target"], e["kind"]) for e in graph["edges"]}
        self.assertIn(("Toy 101 L1 Growth", "Toy Steady State Explorer", "shows"), edges)
        self.assertIn(("Toy Steady State Explorer", "Toy Growth Model", "illustrates"), edges)
        self.assertIn(("Toy Saving Chart", "Toy Saving Rates", "illustrates"), edges)
        lecture = next(n for n in graph["nodes"] if n["id"] == "Toy 101 L1 Growth")
        self.assertEqual(lecture["interactives"], ["Toy Steady State Explorer", "Toy Convergence", "Toy Saving Chart", "Toy Golden Rule"])
        widget = next(n for n in graph["nodes"] if n["id"] == "Toy Convergence")
        self.assertEqual((widget["type"], widget["widget"], widget["lessons"]), ("interactive", "view", ["Toy 101 L1 Growth"]))
        index = (self.vault / "_meta/Concept Index.md").read_text(encoding="utf-8")
        self.assertIn("· 5 interactives ·", index)
        self.assertIn("| [[Toy Convergence]] |", index)

    def test_export(self):
        out = pathlib.Path(self._tmp.name) / "content"
        status, log = run_tool("--vault", self.vault, "export", "--out", out)
        self.assertEqual(status, 0, log)
        index = json.loads((out / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(index["schema"], "mqe-lessons/1")
        self.assertEqual(len(index["notes"]), 15)                      # every typed note but the meta index
        # the planned Toy Golden Rule is a note, but not a widget, until it is built
        self.assertEqual(sorted(index["widgets"]), ["toy-bandwidth-lookup", "toy-convergence", "toy-saving-chart", "toy-steady-state-explorer"])
        explorer = index["widgets"]["toy-steady-state-explorer"]
        self.assertEqual(explorer["spec"]["compare_figure"], "assets/Attachments/Toy diagram.png")
        self.assertEqual({r["tex"] for r in explorer["notation"]} >= {"$s$", "$\\delta$", "$\\bar{k}$, $\\bar{c}$"}, True)
        self.assertEqual(index["datasets"]["toy-saving-rates"]["src"], "assets/data/exports/toy-saving-rates.csv")
        self.assertEqual(index["datasets"]["toy-saving-rates"]["dataSource"], "toy-survey")
        self.assertTrue((out / "assets/data/exports/toy-saving-rates.csv").is_file())
        lecture = index["notes"]["toy-101-l1-growth"]
        self.assertEqual((lecture["checks"], lecture["lecture"], lecture["title"]), (3, 1, "Growth in a Toy Economy"))
        self.assertEqual((lecture["derives"], [o["tested"] for o in lecture["objectives"]]), (1, [2, 3, 1]))
        self.assertNotIn("toy-golden-rule", lecture["interactives"])
        self.assertEqual(index["notes"]["toy-101-l1-questions"]["pairedAnswers"], "toy-101-l1-answers")
        (course,) = index["courses"]
        self.assertEqual((course["title"], course["practice"]), ("Toy Macroeconomics", ["toy-101-l1-questions"]))

    def test_export_refuses_while_check_fails(self):
        self.mutate(LECTURE, "widget: Toy Saving Chart", "widget: Toy Nope")
        out = pathlib.Path(self._tmp.name) / "content"
        status, log = run_tool("--vault", self.vault, "export", "--out", out)
        self.assertEqual(status, 1)
        self.assertFalse(out.exists())
        self.assertIn("fix what `check` reports", log)

    def test_export_refuses_unsafe_targets(self):
        status, log = run_tool("--vault", self.vault, "export", "--out", self.vault / "content")
        self.assertIn("outside the vault", log)
        other = pathlib.Path(self._tmp.name) / "unrelated"
        other.mkdir()
        (other / "keep.txt").write_text("mine", encoding="utf-8")
        status, log = run_tool("--vault", self.vault, "export", "--out", other)
        self.assertIn("refusing to write into it", log)
        self.assertTrue((other / "keep.txt").exists())

    def test_rename_a_widget_rewrites_its_blocks(self):
        status, out = run_tool("--vault", self.vault, "rename", "Toy Convergence", "Toy Transition")
        self.assertEqual(status, 0, out)
        self.assertIn("widget: Toy Transition", (self.vault / LECTURE).read_text(encoding="utf-8"))
        run_tool("--vault", self.vault, "sync")
        self.assertEqual(self.check()[0], 0)


class BrokenVault(FixtureTest):
    """One edit, one expected error."""

    CASES = [
        # (file, old text, new text, expected error)
        (LECTURE, "widget: Toy Saving Chart", "widget: Toy Nope", "names widget 'Toy Nope', which has no note in Interactives/"),
        (LECTURE, "show: [saving, depreciation, steady, kbar_out]", "show: [saving, ghost]", "show: 'ghost' is not an element"),
        (LECTURE, "lock: [A, alpha]\n", "lock: [A, beta]\n", "lock: 'beta' is not a parameter"),
        (LECTURE, "highlight: steady", "highlight: nowhere", "highlight: 'nowhere' is not an element"),
        (LECTURE, "hide: [capital]", "hide: [capitol]", "predict.hide: 'capitol' is not an element"),
        (LECTURE, "state: {s: 0.4}", "state: {s: 4}", "state.s = 4 is outside the slider range"),
        (LECTURE, "state: {s: 0.4}", "state: {sigma: 0.4}", "state: 'sigma' is not a parameter"),
        (LECTURE, "prompt: Only $s$ and $\\delta$ move.", "prompt: Only: s and delta move.", "invalid YAML"),
        (LECTURE, "  when: \"abs(s - alpha) < 0.01\"\n", "", "goal: missing 'when'"),
        (LECTURE, "> - [x] It is unchanged", "> - [ ] It is unchanged", "no correct option"),
        (LECTURE, "> answer: 25 ± 0.05\n", "", "options or an 'answer:"),
        (LECTURE, "> [!check]- If the saving", "> [!check] If the saving", "fold it with '-'"),
        (LECTURE, "interactive: true", "interactive: yes please", "interactive must be true or false"),
        (QUESTIONS, "> **Why:** $(0.3/0.1)^2 = 9$.", "", "needs a '**Why:**' explanation"),
        (EXPLORER, "type: view", "type: vieww", "type 'vieww' is unknown"),
        (EXPLORER, "curves:\n", "curvez:\n", "spec: panels[0]: missing 'curves'"),
        (EXPLORER, "x: {var: k,", "x: {var: q,", "panels[0].x.var 'q' is not a variable of the model"),
        (EXPLORER, "  f: \"A*k^alpha\"", "  kbar: \"A*k^alpha\"", "'kbar' is an equation and also a parameter or derived value"),
        (EXPLORER, "derived:\n", "derived: [\n", "spec is not valid YAML"),
        (EXPLORER, 'A:     {tex: "A",', 'A:     {tex: "n",', "tex 'n' uses n - not in the Notation table"),
        (EXPLORER, 'tex: "f(k)"', 'tex: "\\\\hat{f}(k)"', "uses hat(f) - not in the Notation table"),
        (EXPLORER, "expect: {kbar: 25,", "expect: {kbarr: 25,", "'kbarr' is not a derived value or readout"),
        (EXPLORER, "between: [output, saving]", "between: [output, savings]", "regions[0].between must name two curves"),
        (EXPLORER, "compare_figure: Toy diagram.png", "compare_figure: Nope.png", "compare_figure 'Nope.png' is not in Attachments/"),
        (EXPLORER, '  kbar: "(s*A', '  s: "0.5"\n  kbar: "(s*A', "derived 's' has the same name as a parameter"),
        (EXPLORER, "  - {id: cbar_out,", "  - {id: kbar_out,", "id 'kbar_out' is defined twice"),
        (EXPLORER, "default: 0.5}\n  A:", "default: 1.5}\n  A:", "params.s: default 1.5 is outside"),
        # sync has re-rendered the frontmatter in block style by the time these edits run
        (EXPLORER, "- '[[Toy Growth Model]]'\n- '[[Toy Production Function]]'", "- '[[Toy 101 L1 Growth]]'",
         "illustrates [[Toy 101 L1 Growth]], which is a lecture"),
        (EXPLORER, "illustrates:\n- '[[Toy Growth Model]]'\n- '[[Toy Production Function]]'\n", "", "missing 'illustrates'"),
        (EXPLORER, "Reproduces the toy diagram", "Reproduces the Toy 101 diagram", "mentions a course code"),
        (EXPLORER, "## Spec", "## Specification", "needs a '## Spec' section"),
        (CONVERGENCE, "set: {s: 0.6}", "set: {sigma: 0.6}", "shocks[0].set: 'sigma' is not a parameter"),
        (CONVERGENCE, "kind: path\n    id: growth", "kind: paths\n    id: growth", "panels[1].kind must be one of: curve, path, contour, vector"),
        (CONVERGENCE, "{of: kbar, with: {s: 0.6}}", "{of: kbar, with: {sigma: 0.6}}", "derived.kbar_hi.with: 'sigma' is not a parameter of the model"),
        (CHART, "dataset: toy-saving-rates", "dataset: toy-nope", "dataset 'toy-nope' is not in _data/registry.yaml"),
        (CHART, "{column: rate,", "{column: ratez,", "column 'ratez' is not in dataset 'toy-saving-rates'"),
        (CHART, "mark: line", "mark: pie", "mark must be one of"),
        (REGISTRY, "file: exports/toy-saving-rates.csv", "file: exports/nope.csv", "_data/exports/nope.csv is missing"),
        (REGISTRY, "    rate:\n", "    rates:\n", "column 'rates' is not in the CSV header"),
        (REGISTRY, "data_source: '[[Toy Survey]]'", "data_source: '[[Toy Growth Model]]'", "is not a data source note"),
        (REGISTRY, "toy-saving-rates:\n  title", "Toy_Saving:\n  title", "dataset ids are lowercase"),
    ]

    def test_each_rule_fires(self):
        pristine = pathlib.Path(self._tmp.name) / "pristine"
        shutil.copytree(self.vault, pristine)
        for path, old, new, expected in self.CASES:
            with self.subTest(expected=expected):
                shutil.rmtree(self.vault)
                shutil.copytree(pristine, self.vault)
                self.mutate(path, old, new)
                status, out = self.check()
                self.assertEqual(status, 1, f"expected an error for: {expected}\n{out}")
                self.assertIn(expected, out)

    def test_duplicate_slugs(self):
        shutil.copy(self.vault / "Concepts/Toy Growth Model.md", self.vault / "Facts/Toy Growth-Model.md")
        status, out = self.check()
        self.assertIn("share the lesson-player slug 'toy-growth-model'", out)


class Warnings(FixtureTest):
    def warns(self, expected):
        status, out = self.check()
        self.assertEqual(status, 0, out)
        self.assertIn(expected, out)

    def test_unused_widget(self):
        self.mutate(LECTURE, "```interactive\nwidget: Toy Saving Chart\nshow: [rich, poor, crisis]\n```\n", "")
        run_tool("--vault", self.vault, "sync")
        self.warns("Toy Saving Chart.md: widget is used nowhere")

    def test_interactive_lecture_without_checkpoints(self):
        # goals, predictions and derivations are checkpoints too, so it takes removing every one of them
        self.mutate(LECTURE, "[!check]-", "[!note]-", count=2)
        self.assertNotIn("no checkpoints", self.check()[1])
        strip_items(self.vault / LECTURE)
        run_tool("--vault", self.vault, "sync")
        self.warns("interactive lecture has no checkpoints")

    def test_stale_export_hash(self):
        with open(self.vault / "_data/exports/toy-saving-rates.csv", "a", encoding="utf-8", newline="\n") as fh:
            fh.write("2021,rich,0.25\n")
        self.warns("sha256 does not match _data/exports/toy-saving-rates.csv")

    def test_custom_widget_is_counted(self):
        (self.vault / "Interactives/Toy Custom.md").write_text(
            '---\ntype: interactive\nsummary: A custom widget.\ndomain: macroeconomics\nillustrates: ["[[Toy Growth Model]]"]\n---\n'
            "# Toy Custom\n\n## Spec\n\n```yaml\ntype: custom\ncomponent: ToyCustom\n"
            'params:\n  s: {tex: "s", min: 0, max: 1, default: 0.5}\n```\n', encoding="utf-8")
        with open(self.vault / LECTURE, "a", encoding="utf-8", newline="\n") as fh:
            fh.write("\n```interactive\nwidget: Toy Custom\n```\n")
        run_tool("--vault", self.vault, "sync")
        self.warns("Toy Custom.md: custom widget, placed 1 time(s)")


class ExportHelper(unittest.TestCase):
    """_data/mqe_export.py, pointed at a temporary _data folder."""

    def setUp(self):
        try:
            import pandas  # noqa: F401
        except ImportError:
            self.skipTest("pandas not installed")
        self._tmp = tempfile.TemporaryDirectory()
        data = pathlib.Path(self._tmp.name) / "_data"
        self.mod = load_module("mqe_export_under_test", EXPORT_HELPER)
        self.mod.DATA, self.mod.EXPORTS, self.mod.REGISTRY = data, data / "exports", data / "registry.yaml"

    def tearDown(self):
        self._tmp.cleanup()

    def frame(self):
        import pandas as pd
        return pd.DataFrame([{"year": y, "group": g, "rate": round(r - (0.03 if y == 2008 else 0), 3)}
                             for y in range(2000, 2021) for g, r in (("rich", 0.25), ("poor", 0.10))])

    def test_reproduces_the_fixture_dataset(self):
        path = self.mod.export(self.frame(), "toy-saving-rates", title="Toy saving rates by country group, 2000–2020",
                               units={"year": "year", "group": "group", "rate": "share of income"},
                               data_source="[[Toy Survey]]", notebook="notebooks/toy-saving.ipynb", period="2000–2020",
                               raw_inputs=[r"C:\toy\survey.csv"])
        self.assertEqual(path.read_bytes(), (FIXTURE_VAULT / "_data/exports/toy-saving-rates.csv").read_bytes())
        import yaml
        mine = yaml.safe_load(self.mod.REGISTRY.read_text(encoding="utf-8"))["toy-saving-rates"]
        fixture = yaml.safe_load((FIXTURE_VAULT / "_data/registry.yaml").read_text(encoding="utf-8"))["toy-saving-rates"]
        mine.pop("generated"), fixture.pop("generated")
        self.assertEqual(mine, fixture)

    def test_rejects_untidy_or_oversized_exports(self):
        df = self.frame()
        with self.assertRaisesRegex(ValueError, "reset_index"):
            self.mod.export(df.set_index("year"), "x", title="t", units={})
        with self.assertRaisesRegex(ValueError, "lowercase"):
            self.mod.export(df, "Bad_Id", title="t", units={})
        with self.assertRaisesRegex(ValueError, "not in the frame"):
            self.mod.export(df, "x", title="t", units={"nope": "u"})
        import pandas as pd
        big = pd.DataFrame({"v": range(200_000)})
        with self.assertRaisesRegex(ValueError, "under 1 MB"):
            self.mod.export(big, "big", title="t", units={})


if __name__ == "__main__":
    unittest.main()
