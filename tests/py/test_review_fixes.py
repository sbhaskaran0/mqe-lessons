"""Findings of the whole-repo review, each reproduced on a tiny input: Obsidian %% comments, escaped table pipes,
one-line display math, checkpoint parsing, note encodings, line numbers in messages, the sync race, export details,
the registry merge in mqe_export and the data-chart test keys the TypeScript side accepts."""
import contextlib
import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

from helpers import EXPORT_HELPER, FIXTURE_VAULT, TOOL, edit, fixture_vault, load_module, run_tool, vt

LECTURE = "Courses/Toy 101/Lectures/Toy 101 L1 Growth.md"
EXPLORER = "Interactives/Toy Steady State Explorer.md"
CONCEPT = "Concepts/Toy Growth Model.md"


def line_of(path, text):
    """1-based line of the first line of `path` that contains `text`."""
    lines = pathlib.Path(path).read_text(encoding="utf-8").split("\n")
    return next(i + 1 for i, l in enumerate(lines) if text in l)


class VaultCopy(unittest.TestCase):
    """A synced copy of the fixture vault per test."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.vault = fixture_vault(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def check(self):
        return run_tool("--vault", self.vault, "check")

    def append(self, path, text):
        with open(self.vault / path, "a", encoding="utf-8", newline="\n") as fh:
            fh.write(text)

    def export(self):
        out = pathlib.Path(self._tmp.name) / "content"
        status, log = run_tool("--vault", self.vault, "export", "--out", out)
        self.assertEqual(status, 0, log)
        return out


class Comments(unittest.TestCase):
    def test_comments_never_reach_the_blocks(self):
        body = ("Para %%secret%% text\n\n- item %%hid%%\n- two\n\n| a | b %%cell%% |\n| - | - |\n\n"
                "> [!note] Title %%ttl%%\n> body %%inq%%\n> %% multi\n> line draft %%\n> tail\n\n%%\nwhole\nregion\n%%\nafter")
        out = vt.md_blocks(body)
        text = json.dumps([list(b.values()) for b in out])
        for hidden in ("%%", "secret", "hid", "cell", "ttl", "inq", "multi", "draft", "whole", "region"):
            self.assertNotIn(hidden, text, hidden)
        self.assertEqual([b["k"] for b in out], ["para", "list", "table", "callout", "para"])
        self.assertEqual(out[3]["title"], "Title")
        self.assertEqual([l.strip() for l in out[3]["lines"]], ["body", "tail"])     # comment-only lines go too
        self.assertEqual(out[4]["text"], "after")

    def test_a_comment_only_line_does_not_split_a_paragraph_but_a_step_break_stays(self):
        self.assertEqual(vt.md_blocks("one\n%% note to self %%\ntwo"), [{"k": "para", "text": "one\ntwo"}])
        self.assertEqual([b["k"] for b in vt.md_blocks("a\n\n%% step %%\n\nb")], ["para", "break", "para"])

    def test_code_keeps_its_percent_signs(self):
        (fence,) = vt.md_blocks("```text\n%% kept %%\n```")
        self.assertEqual(fence["text"], "%% kept %%")
        self.assertIn("`%%x%%`", vt.md_blocks("say `%%x%%` here")[0]["text"])

    def test_comments_inside_a_check_are_dropped(self):
        (b,) = vt.md_blocks("> [!check]- Why? %%draft%%\n> - [x] Because %%x%%\n> - [ ] No\n>\n> **Why:** It is. %%y%%")
        (chk,) = vt.Exporter({}, {}, {}).block(b)
        self.assertEqual((chk["prompt"], [o["md"] for o in chk["options"]], chk["why"]), ("Why?", ["Because", "No"], "It is."))

    def test_check_and_export_read_a_check_with_a_comment_line_alike(self):
        text = "> [!check]- Q\n> - [x] a\n> %% to do %%\n>   continued\n> - [ ] b\n> **Why:** w"
        ((line, _, fold, title, lines, rows),) = vt.callouts(text, with_rows=True)
        self.assertEqual(rows, [1, 3, 4, 5])
        (b,) = vt.md_blocks(text)
        self.assertEqual(vt.parse_check(fold, title, lines), vt.parse_check(b["fold"], b["title"], b["lines"]))
        self.assertEqual(vt.parse_check(fold, title, lines)[0]["options"], [["a continued", True], ["b", False]])

    def test_commented_out_blocks_do_not_count(self):
        self.assertEqual(vt.placements_in("%%\n```interactive\nwidget: Nope\n```\n%%\n"), ())
        self.assertEqual(vt.placements_in("%%\n> [!interactive]- Q\n> widget: Nope\n%%\n"), ())
        self.assertEqual(vt.callouts("%%\n> [!check]- Q\n> - [x] a\n%%"), [])
        self.assertEqual(vt.links("%% [[Nope]] %% [[Yes]]"), ["Yes"])


class CommentedDrafts(VaultCopy):
    def test_check_sync_and_export_ignore_commented_out_drafts(self):
        self.append(LECTURE, "\n%%\n```interactive\nwidget: Toy Nope\n```\n\n> [!check] unfinished draft\n"
                             "> - [ ] only one option\n\n[[Nowhere]]\n%%\n")
        self.assertEqual(run_tool("--vault", self.vault, "sync")[0], 0)
        status, out = self.check()
        self.assertEqual(status, 0, out)
        graph = (self.vault / "_meta/graph.json").read_text(encoding="utf-8")
        self.assertNotIn("Toy Nope", graph)
        index = json.loads((self.export() / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(index["notes"]["toy-101-l1-growth"]["checks"], 3)


class DisplayMath(unittest.TestCase):
    def test_text_after_a_closing_dollar_pair_is_a_paragraph(self):
        self.assertEqual(vt.md_blocks("$$y = Ak$$ where $A$ is technology.\nmore\n\nnext"), [
            {"k": "math", "tex": "y = Ak"}, {"k": "para", "text": "where $A$ is technology.\nmore"}, {"k": "para", "text": "next"}])
        self.assertEqual(vt.md_blocks("$$\ny = Ak\n$$ where $A$ is technology.\n\nnext"), [
            {"k": "math", "tex": "y = Ak"}, {"k": "para", "text": "where $A$ is technology."}, {"k": "para", "text": "next"}])

    def test_practice_items_after_one_line_math_are_still_read(self):
        self.assertEqual(vt._structural(["$$x$$ where x is capital.", "1. What is x?"]), [True, True])
        self.assertEqual([n for n, _, _ in vt.practice_questions("## Questions\n\n$$x$$ where\n\n1. One?\n2. Two?")], ["1", "2"])


class OutputEncoding(unittest.TestCase):
    def test_find_prints_non_ascii_into_a_pipe(self):
        env = {k: v for k, v in os.environ.items() if k not in ("PYTHONIOENCODING", "PYTHONUTF8")}
        r = subprocess.run([sys.executable, str(TOOL), "--vault", str(FIXTURE_VAULT), "find", "α-convergence ≈"],
                           capture_output=True, env={**env, "PYTHONDONTWRITEBYTECODE": "1"})
        self.assertEqual(r.returncode, 0, r.stderr.decode("utf-8", "replace"))
        self.assertIn("α-convergence ≈", r.stdout.decode("utf-8"))


class TablePipes(unittest.TestCase):
    def test_an_escaped_pipe_in_a_link_is_not_part_of_the_target(self):
        self.assertEqual(vt.links("| [[Toy Growth Model\\|the model]] | [[A#B\\|c]] |"), ["Toy Growth Model", "A"])

    def test_cells_split_only_on_unescaped_pipes_outside_math(self):
        self.assertEqual(vt.table_cells("| $\\|x\\|$ | norm of $|x|$ | [[N\\|n]] | v |"),
                         ["$\\|x\\|$", "norm of $|x|$", "[[N\\|n]]", "v"])
        self.assertEqual(vt.table_cells("| $Y$ | costs $5 | x |"), ["$Y$", "costs $5", "x"])   # a lone '$' is a price


class TablePipesInVault(VaultCopy):
    def test_check_and_rename_read_escaped_links(self):
        self.append(LECTURE, "\n| Model | Note |\n| --- | --- |\n| toy | [[Toy Growth Model\\|the model]] |\n")
        status, out = self.check()
        self.assertEqual(status, 0, out)
        status, out = run_tool("--vault", self.vault, "rename", "Toy Growth Model", "Toy Growth Engine")
        self.assertEqual(status, 0, out)
        self.assertIn("[[Toy Growth Engine\\|the model]]", (self.vault / LECTURE).read_text(encoding="utf-8"))


class Checks(unittest.TestCase):
    def test_text_after_the_options_is_an_error_not_part_of_the_last_option(self):
        chk, errs = vt.parse_check("-", "Q", ["- [x] a", "  wrapped", "- [ ] b", "", "stray note", "**Why:** w"],
                                   at=lambda i: f"line {i + 10}")
        self.assertEqual(chk["options"], [["a wrapped", True], ["b", False]])
        self.assertEqual(errs, ["text between the options and '**Why:**' at line 14 - put it in the question or the explanation"])

    def test_answer_after_the_options_is_has_both(self):
        _, errs = vt.parse_check("-", "Q", ["- [x] a", "- [ ] b", "answer: 3", "**Why:** w"])
        self.assertIn("has both '- [ ]' options and 'answer:' - use one", errs)

    def test_numeric_answer_edge_cases(self):
        chk, errs = vt.parse_check("-", "Q", ["answer: −3 ± 0.1", "**Why:** w"])
        self.assertEqual((chk["answer"], chk["tol"], errs), (-3.0, 0.1, []))
        self.assertEqual(vt.parse_check("-", "Q", ["answer: 1/0", "**Why:** w"]), (None, ["answer '1/0' divides by zero"]))
        chk, errs = vt.parse_check("-", "Q", ["answer: 1 ± -0.5", "**Why:** w"])
        self.assertIsNone(chk)
        self.assertIn("negative tolerance", errs[0])


class ChecksInVault(VaultCopy):
    def test_nested_check_is_rejected_at_its_line(self):
        self.append(LECTURE, "\n> [!note] Outer\n> > [!check]- Inner?\n> > - [x] a\n> > - [ ] b\n> > **Why:** w\n")
        status, out = self.check()
        self.assertEqual(status, 1)
        line = line_of(self.vault / LECTURE, "> > [!check]- Inner?")
        self.assertIn(f"{LECTURE}: check at line {line} sits inside another callout or quote", out)

    def test_bad_answer_reports_file_and_line(self):
        edit(self.vault / LECTURE, "> answer: 25 ± 0.05", "> answer: 25/0")
        status, out = self.check()
        line = line_of(self.vault / LECTURE, "what is $\\bar{k}$?")
        self.assertIn(f"{LECTURE}: check at line {line}: answer '25/0' divides by zero", out)


class NoteEncoding(VaultCopy):
    def test_a_bom_from_powershell_is_read(self):
        p = self.vault / LECTURE
        p.write_bytes(b"\xef\xbb\xbf" + p.read_bytes())
        status, out = self.check()
        self.assertEqual(status, 0, out)

    def test_a_note_that_is_not_utf8_is_named(self):
        (self.vault / "Concepts/Latin1.md").write_bytes(b"---\ntype: concept\n---\ncaf\xe9\n")
        status, out = self.check()
        self.assertEqual(status, 1)
        self.assertIn("ERROR Concepts/Latin1.md: not UTF-8 text", out)


class LinesInMessages(VaultCopy):
    def test_broken_links_missing_figures_and_spec_keys_have_lines_and_posix_paths(self):
        edit(self.vault / LECTURE, "([[Toy Production Function]])", "([[Toy Nope]])")
        edit(self.vault / LECTURE, "![[Toy diagram.png]]", "![[Nope.png]]")
        edit(self.vault / EXPLORER, "default: 0.5}\n  A:", "default: 1.5}\n  A:")
        status, out = self.check()
        self.assertEqual(status, 1)
        lec = self.vault / LECTURE
        self.assertIn(f"{LECTURE}: broken link [[Toy Nope]] at line {line_of(lec, '[[Toy Nope]]')}", out)
        self.assertIn(f"{LECTURE}: missing figure ![[Nope.png]] at line {line_of(lec, '![[Nope.png]]')}", out)
        s_line = line_of(self.vault / EXPLORER, "default: 1.5}")
        self.assertIn(f"{EXPLORER}: spec: params.s: default 1.5 is outside [0.05, 0.9] (line {s_line})", out)
        self.assertNotIn("\\", "\n".join(l for l in out.splitlines() if l.startswith(("ERROR", "warn"))))

    def test_greek_notation_errors_point_at_first_use(self):
        body = "## In plain English\n\nx\n\n## Definition\n\n$$\\sigma = 1$$\n\n## Notation\n\n| Symbol | Meaning |\n| - | - |\n| $k$ | capital |\n"
        issues = vt.context_issues({"body": body, "offset": 3})
        self.assertIn("Greek symbols used but not in Notation: sigma (line 10)", issues)


class SyncRace(VaultCopy):
    def test_sync_skips_a_note_saved_while_it_ran(self):
        concept = self.vault / CONCEPT
        edit(concept, "lessons:\n- '[[Toy 101 L1 Growth]]'\n", "lessons: []\n")
        tool = load_module("vault_tool_race", TOOL)          # its own copy, so set_root stays out of other tests
        tool.set_root(self.vault)
        load = tool.load

        def load_then_save():
            db = load()
            self.append(CONCEPT, "\nTyped in Obsidian while sync ran.\n")
            return db

        tool.load = load_then_save
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            tool.cmd_sync()
        self.assertIn(f"skipped {CONCEPT} - it changed on disk while sync ran", out.getvalue())
        text = concept.read_text(encoding="utf-8")
        self.assertIn("Typed in Obsidian while sync ran.", text)
        self.assertIn("lessons: []", text)
        tool.load = load
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            tool.cmd_sync()
        self.assertIn(f"sync: wrote {CONCEPT}", out.getvalue())
        self.assertIn("Typed in Obsidian while sync ran.", concept.read_text(encoding="utf-8"))


class ExportDetails(unittest.TestCase):
    def test_a_display_size_is_not_alt_text(self):
        ex = vt.Exporter({}, {}, {})
        self.assertEqual(ex.md("![[fig.png|300]]"), "![fig](<assets/Attachments/fig.png>)")
        self.assertEqual(ex.md("![[fig.png|Solow diagram|640x480]]"), "![Solow diagram](<assets/Attachments/fig.png>)")
        (fig,) = ex.block(vt.md_blocks("![[fig.png|300]]")[0])
        self.assertEqual(fig["alt"], "fig")

    def test_a_same_note_heading_link_is_an_anchor(self):
        ex = vt.Exporter({}, {}, {})
        ex.current = "toy"
        self.assertEqual(ex.md("see [[#The Steady State]]"), "see [The Steady State](note:toy#the-steady-state)")
        self.assertEqual(ex.md("[[#The Steady State|above]]"), "[above](note:toy#the-steady-state)")
        ex.current = None
        self.assertEqual(ex.md("[[#The Steady State]]"), "The Steady State")

    def test_consecutive_headings_share_the_step(self):
        (step,) = vt._chunk([{"t": "_h", "text": "Part A"}, {"t": "_h", "text": "Setup"}, {"t": "prose", "md": "x"}])
        self.assertEqual(step["heading"], "Part A · Setup")

    def test_fractional_lecture_numbers_sort_between(self):
        nos = [vt.lecture_no({"fm": {"lecture": x}}) for x in ("L2", 1.5, "L1", 10)]
        self.assertEqual(nos, [2, 1.5, 1, 10])
        self.assertEqual(sorted(nos), [1, 1.5, 2, 10])


class HeadingLinksInVault(VaultCopy):
    def test_heading_links_are_checked_and_exported(self):
        edit(self.vault / LECTURE, "countries ([[Toy Saving Rates]]).",
             "countries ([[Toy Saving Rates]]). Back to [[#2. The steady state]] and [[Toy Growth Model#Definition]].")
        status, out = self.check()
        self.assertEqual(status, 0, out)
        body = (self.export() / "notes/toy-101-l1-growth.json").read_text(encoding="utf-8")
        self.assertIn("[2. The steady state](note:toy-101-l1-growth#2-the-steady-state)", body)
        edit(self.vault / LECTURE, "Back to", "See [[#Nowhere]]. Back to")
        status, out = self.check()
        line = line_of(self.vault / LECTURE, "[[#Nowhere]]")
        self.assertIn(f"link [[#Nowhere]] at line {line}: [[Toy 101 L1 Growth]] has no heading 'Nowhere'", out)


class DataChartKeys(unittest.TestCase):
    def errors(self, spec, expect):
        spec = {"type": "data-chart", "x": {"column": "year"}, "y": {"column": "rate"}, **spec, "tests": [{"expect": expect}]}
        return [e for e in vt.validate_spec(spec, set(), {}, lambda f: True) if e.startswith("tests")]

    def test_keys_the_typescript_side_accepts(self):
        series = {"series": [{"id": "skill-premium", "where": {"group": "a"}}]}
        ok = {"skill-premium@1980": 0.1, "skill-premium@Low skill": 1, "skill-premium@2008-07-01": 1, "skill-premium.max": 1}
        self.assertEqual(self.errors(series, ok), [])
        self.assertEqual(self.errors({}, {"rate@2008": 1, "rate.mean": 1}), [])           # no series: one, named y.column
        bad = self.errors(series, {"nope@1980": 1, "skill-premium.median": 1, "skill-premium@": 1})
        self.assertEqual(len(bad), 3, bad)


class RegistryMerge(unittest.TestCase):
    """mqe_export.export() keeps hand edits in registry.yaml."""

    def setUp(self):
        try:
            import pandas  # noqa: F401
        except ImportError:
            self.skipTest("pandas not installed")
        self._tmp = tempfile.TemporaryDirectory()
        data = pathlib.Path(self._tmp.name) / "_data"
        self.mod = load_module("mqe_export_merge", EXPORT_HELPER)
        self.mod.DATA, self.mod.EXPORTS, self.mod.REGISTRY = data, data / "exports", data / "registry.yaml"

    def tearDown(self):
        self._tmp.cleanup()

    def test_hand_edits_and_unpassed_keys_survive_a_re_export(self):
        import pandas as pd
        import yaml
        df = pd.DataFrame({"year": [2000, 2001], "rate": [0.1, 0.2], "old": [1, 2]})
        with contextlib.redirect_stdout(io.StringIO()):
            self.mod.export(df, "toy", title="Generated title", units={"year": "year", "rate": "share", "old": "x"},
                            data_source="[[Toy Survey]]", description="First run.")
        reg = yaml.safe_load(self.mod.REGISTRY.read_text(encoding="utf-8"))
        reg["toy"]["title"] = "Hand-edited title"
        reg["toy"]["columns"]["rate"] = {"unit": "share of income", "label": "Saving rate"}
        self.mod.REGISTRY.write_text(yaml.safe_dump(reg, sort_keys=False, allow_unicode=True), encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            self.mod.export(df.drop(columns="old").assign(rate=[0.3, 0.4]), "toy", title="New generated title",
                            units={"year": "year", "rate": "percent"})
        entry = yaml.safe_load(self.mod.REGISTRY.read_text(encoding="utf-8"))["toy"]
        self.assertEqual(entry["title"], "Hand-edited title")
        self.assertEqual(entry["columns"], {"year": {"unit": "year"}, "rate": {"unit": "share of income", "label": "Saving rate"}})
        self.assertEqual((entry["data_source"], entry["description"]), ("[[Toy Survey]]", "First run."))
        self.assertEqual(entry["sha256"], self.mod.hashlib.sha256((self.mod.EXPORTS / "toy.csv").read_bytes()).hexdigest())


if __name__ == "__main__":
    unittest.main()
