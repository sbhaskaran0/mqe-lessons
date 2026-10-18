"""The generated `_meta/Model Library.md` and `_meta/Backlog.md`, the placeholder-age warning, "used nowhere" counting a
model as used through its views, and the model-drift warnings - on copies of the fixture vault."""
import os
import pathlib
import tempfile
import time
import unittest
from datetime import date

from helpers import TOOL, edit, fixture_vault, load_module, run_tool

LECTURE = "Courses/Toy 101/Lectures/Toy 101 L1 Growth.md"
LIBRARY = "_meta/Model Library.md"
BACKLOG = "_meta/Backlog.md"

MODEL = """type: model
title: Toy base
params:
  s:     {tex: "s",       min: 0.05, max: 0.9, step: 0.01,  default: 0.5}
  delta: {tex: "\\\\delta", min: 0.02, max: 0.2, step: 0.005, default: 0.1}
vars:
  k: {tex: "k"}
equations:
  inv: "s*k^0.5"
derived:
  kbar: "(s/delta)^2"
tests:
  - params: {s: 0.5, delta: 0.1}
    expect: {kbar: 25}
"""
VIEW = """type: view
model: "[[Toy Base Model]]"
title: Toy base view
panels:
  - kind: curve
    id: diagram
    x: {var: k, tex: "k", min: 0, max: 40}
    y: {min: 0, max: 4}
    curves:
      - {id: saving, expr: inv, tex: "sf(k)"}
"""
SAMPLER_VIEW = """type: view
model: "[[Toy Base Model]]"
title: Toy sampler
sliders: [s]
panels:
  - kind: sampler
    id: hist
    seed: 7
    reps: 200
    rows: 20
    columns:
      x: "uniform(0, 1)"
      y: "s + 2*x + normal(0, delta)"
    fit: {y: y, x: x}
    stat: b2
    x: {min: 0, max: 4}
    summaries: {centre: "mean(b2)", spread: "sd(b2)"}
    lines: [{id: truth, x: 2}]
readouts:
  - {id: spread_out, label: "Spread", expr: spread}
"""
PLACEHOLDER = """> [!interactive]- (planned) {purpose}
> widget: Toy Golden Rule
> figure: Toy diagram.png
> objective: 2
> brief:
>   purpose: {purpose}
{added}
"""


def write_widget(vault, name, spec):
    (vault / "Interactives" / f"{name}.md").write_text(
        f"---\ntype: interactive\nsummary: {name}.\ndomain: macroeconomics\nillustrates: [\"[[Toy Growth Model]]\"]\n---\n# {name}\n\n"
        f"## Spec\n\n```yaml\n{spec}```\n", encoding="utf-8", newline="\n")


def add_placeholder(vault, purpose, added=None):
    """A second planned placeholder (objective 2) at the end of section 5 of the lecture."""
    block = PLACEHOLDER.format(purpose=purpose, added=f">   added: {added}" if added else "").replace("\n\n", "\n")
    edit(vault / LECTURE, "## What to be able to do", block + "\n## What to be able to do")


class MetaTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.vault = fixture_vault(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def check(self):
        status, out = run_tool("--vault", self.vault, "check")
        return status, out

    def sync(self):
        status, out = run_tool("--vault", self.vault, "sync")
        self.assertEqual(status, 0, out)

    def tool(self):
        """vault_tool loaded on its own (set_root stays out of other tests), pointed at this vault."""
        vt = load_module(f"vault_tool_meta_{id(self)}", TOOL)
        vt.set_root(self.vault)
        return vt


class ModelLibrary(MetaTest):
    def test_sync_writes_it_and_check_reports_it_stale(self):
        text = (self.vault / LIBRARY).read_text(encoding="utf-8")
        self.assertTrue(text.startswith("---\ntype: meta\n---\n# Model Library\n"))
        self.assertIn("**0 models · 3 views · 2 other widgets.**", text)
        self.assertIn("### [[Toy Golden Rule]] (planned)", text)
        self.assertIn("- **Panel `diagram` (curve):** x = `k`; curves `output` $f(k)$, `saving` $sf(k)$, "
                      "`depreciation` $\\delta k$; regions `consumption`; points `steady` $\\bar{k}$", text)
        self.assertIn("- **Placed in:** [[Toy 101 L1 Growth]] › 2. The steady state; [[Toy 101 L1 Growth]] › "
                      "5. Deriving the steady state", text)
        self.assertIn("### [[Toy Saving Chart]]\n\ndata-chart · ", text)
        status, out = self.check()
        self.assertEqual(status, 0, out)
        self.assertNotIn("Model Library.md: no inbound links", out)        # generated notes need no inbound links

        edit(self.vault / "Interactives/Toy Convergence.md", "periods: 60", "periods: 61")
        status, out = self.check()
        self.assertEqual(status, 1)
        self.assertIn("ERROR _meta/Model Library.md out of date - run sync", out)
        self.sync()
        self.assertIn("`k` over 61 periods", (self.vault / LIBRARY).read_text(encoding="utf-8"))
        self.assertEqual(self.check()[0], 0)

    def test_models_list_params_derived_values_and_views(self):
        write_widget(self.vault, "Toy Base Model", MODEL)
        write_widget(self.vault, "Toy Base View", VIEW)
        self.sync()
        text = (self.vault / LIBRARY).read_text(encoding="utf-8")
        self.assertIn("### [[Toy Base Model]]\n\nToy base · views: [[Toy Base View]]\n\n"
                      "- **Params:** `s` $s$ ∈ [0.05, 0.9] step 0.01, default 0.5; `delta` $\\delta$ ∈ [0.02, 0.2] step 0.005, default 0.1\n"
                      "- **Variables:** `k` $k$\n"
                      "- **Equations (functions of the variables):** `inv = s*k^0.5`\n"
                      "- **Derived values:** `kbar = (s/delta)^2`\n", text)
        # A view lists what a placement may name: sliders with their steps, derived values, readouts and other scalars.
        self.assertIn("### [[Toy Base View]]\n\nToy base view · view of [[Toy Base Model]]\n\n"
                      "- **Sliders:** `s` $s$ ∈ [0.05, 0.9] step 0.01, default 0.5; `delta` $\\delta$ ∈ [0.02, 0.2] step 0.005, default 0.1\n"
                      "- **Derived values:** `kbar`\n"
                      "- **Panel `diagram` (curve):** x = `k`; curves `saving` $sf(k)$\n- **Placed in:** nowhere yet\n", text)

    def test_views_list_readouts_and_sampler_summaries(self):
        write_widget(self.vault, "Toy Base Model", MODEL)
        write_widget(self.vault, "Toy Sampler View", SAMPLER_VIEW)
        self.sync()
        text = (self.vault / LIBRARY).read_text(encoding="utf-8")
        self.assertIn("- **Sliders:** `s` $s$ ∈ [0.05, 0.9] step 0.01, default 0.5\n"
                      "- **Held fixed:** `delta` = 0.1\n"
                      "- **Derived values:** `kbar`\n"
                      "- **Readouts:** `spread_out` (= `spread`)\n"
                      "- **Other scalars:** `centre`, `spread`\n"
                      "- **Panel `hist` (sampler):** histogram of `b2` over `200` samples of `20` rows (columns `x`, `y`), "
                      "seed 7; summaries `centre = mean(b2)`, `spread = sd(b2)`; lines `truth`\n", text)
        status, out = self.check()
        self.assertEqual(status, 0, out)

    def test_other_widgets_list_sliders_elements_and_scalars(self):
        text = (self.vault / LIBRARY).read_text(encoding="utf-8")
        self.assertRegex(text, r"### \[\[Toy Saving Chart\]\]\n\ndata-chart · [^\n]*\n\n- \*\*Shows:\*\*[^\n]*\n")


class Backlog(MetaTest):
    def test_sync_writes_it(self):
        text = (self.vault / BACKLOG).read_text(encoding="utf-8")
        self.assertIn("**1 planned placeholder(s) · 1 planned widget note(s).**", text)
        # The age comes from the fixture file's mtime, so it grows with the calendar: match any number of days.
        self.assertRegex(text, r"\| \[\[Toy 101 L1 Growth\]\] \| 5\. Deriving the steady state \| See that consumption peaks "
                               r"where \$s = \\alpha\$ \| \[\[Toy Golden Rule\]\] \| 3 \| 0 \| \[\[Toy Growth Model\]\] \| \d+ d \(mtime\) \|")
        self.assertIn("| [[Toy Golden Rule]] | view | Planned - drag the saving rate", text)

    def test_sorted_by_coverage_gap_then_age(self):
        # objective 3 loses its only live item, so the original placeholder (objective 3) has a gap of 1
        edit(self.vault / LECTURE, "\nobjective: 3\n", "\n")
        add_placeholder(self.vault, "Old one", added="2026-01-01")
        add_placeholder(self.vault, "New one")
        vt = self.tool()
        db, _ = vt.load()
        items = vt.placeholders(db, today=date(2026, 10, 15))
        purposes = [(x.data.get("brief") or {}).get("purpose") or x.data["prompt"] for x in items]
        self.assertEqual(purposes, ["See that consumption peaks where $s = \\alpha$", "Old one", "New one"])
        self.assertEqual([(x.gap, x.source) for x in items], [(1, "mtime"), (0, "brief"), (0, "mtime")])
        self.assertEqual(items[1].age, 287)
        text = vt.build_backlog(db, today=date(2026, 10, 15))
        rows = [l for l in text.splitlines() if l.startswith("| [[Toy 101 L1 Growth]]")]
        self.assertEqual(len(rows), 3)
        self.assertIn("| 3 | 1 |", rows[0])
        self.assertTrue(rows[1].endswith("| Old one | [[Toy Golden Rule]] | 2 | 0 | — | 287 d (brief) |"), rows[1])

    def test_check_warns_about_old_placeholders(self):
        add_placeholder(self.vault, "Old one", added="2026-01-01")
        status, out = self.check()
        self.assertEqual(status, 0, out)
        self.assertRegex(out, r"warn  Courses/Toy 101/Lectures/Toy 101 L1 Growth\.md: planned: placeholder at line \d+ "
                              r"is \d+ days old \(from its brief's 'added:' date\), over 30 - build it or drop it")
        self.assertEqual(out.count("days old"), 1)                     # the original placeholder is fresh

    def test_age_falls_back_to_the_file_mtime(self):
        old = time.time() - 40 * 86400
        os.utime(self.vault / LECTURE, (old, old))
        status, out = self.check()
        self.assertIn("is 40 days old (from the note file's last change), over 30", out)

    def test_added_must_be_a_date(self):
        add_placeholder(self.vault, "Quoted date", added='"soon"')
        self.assertIn("brief.added must be a date written as YYYY-MM-DD, unquoted", self.check()[1])


class UsedNowhere(MetaTest):
    def test_a_model_is_used_through_its_views(self):
        write_widget(self.vault, "Toy Base Model", MODEL)
        write_widget(self.vault, "Toy Base View", VIEW)
        self.sync()
        status, out = self.check()
        self.assertEqual(status, 0, out)
        self.assertIn("Toy Base View.md: widget is used nowhere", out)     # a view is used by a placement
        self.assertNotIn("Toy Base Model.md: widget is used nowhere", out)
        self.assertNotIn("Toy Base Model.md: model is used nowhere", out)

        (self.vault / "Interactives/Toy Base View.md").unlink()
        self.sync()
        self.assertIn("Toy Base Model.md: model is used nowhere - no view names it in 'model:'", self.check()[1])


class ModelDrift(MetaTest):
    def setUp(self):
        super().setUp()
        write_widget(self.vault, "Toy Base Model", MODEL)

    def drift(self, view):
        write_widget(self.vault, "Toy Base View", view)
        self.sync()
        status, out = self.check()
        self.assertEqual(status, 0, out)                               # drift warns; it never blocks the export
        return [l.split("model drift: ", 1)[1] for l in out.splitlines() if "model drift: " in l]

    def test_a_clean_view_does_not_drift(self):
        self.assertEqual(self.drift(VIEW), [])

    def test_re_deriving_a_model_value(self):
        view = VIEW + "derived:\n  k2: \"(s / delta)^2\"\n  k3: {of: kbar, with: {s: s}}\n" \
                      "readouts:\n  - {id: k_out, expr: \"(s/delta)^2\"}\n"
        self.assertEqual(self.drift(view), [
            "derived.k2 re-derives the model's 'kbar' ((s / delta)^2) - use kbar",
            "derived.k3 rebinds 'kbar' with nothing changed - use kbar",
            "readout k_out re-derives the model's 'kbar' ((s/delta)^2) - write expr: kbar",
        ])

    def test_a_stand_in_outside_the_model_range(self):
        view = VIEW.replace("panels:", "sliders: [s1, s2, tstar]\nparams:\n"
                            "  s1: {tex: \"s\", min: 0.05, max: 0.99, default: 0.5}\n"
                            "  s2: {tex: \"s\", min: 0.1, max: 0.5, default: 0.3}\n"
                            "  tstar: {tex: \"t\", min: 1, max: 60, default: 10}\n"
                            "derived:\n  kbar1: {of: kbar, with: {s: \"t < tstar ? s1 : s2\"}}\npanels:")
        self.assertEqual(self.drift(view), [
            "params.s1 stands in for the model's s (a rebinding passes it in), but its range [0.05, 0.99] leaves "
            "the model's [0.05, 0.9] - keep it inside",
        ])

    def test_a_param_written_with_another_symbol(self):
        view = VIEW.replace("panels:", "params:\n  delta: {tex: \"A\"}\npanels:")
        self.assertIn("params.delta: the view writes $A$ for the model's $\\delta$ - keep the model's symbol", self.drift(view))

    def test_two_models_with_different_ranges_for_one_symbol(self):
        write_widget(self.vault, "Toy Other Model", MODEL.replace("min: 0.05, max: 0.9", "min: 0.1, max: 0.9"))
        write_widget(self.vault, "Toy Other View", VIEW.replace("Toy Base Model", "Toy Other Model"))
        self.assertEqual(self.drift(VIEW), [
            "params.s has range [0.1, 0.9], but [[Toy Base Model]] gives the same symbol $s$ the range [0.05, 0.9] "
            "- keep one range per parameter",
        ])


if __name__ == "__main__":
    unittest.main()
