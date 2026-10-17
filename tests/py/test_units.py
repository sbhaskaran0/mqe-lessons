"""Small pieces of vault_tool: the TeX symbol tokenizer, notation row keys, slugs, checkpoint parsing, fences."""
import unittest

from helpers import vt


class TexSymbols(unittest.TestCase):
    def test_letters_greek_and_subscripts(self):
        self.assertEqual(vt.tex_symbols(r"k_{t+1} = sAk_t^{\alpha} + (1-\delta)k_t"),
                         ("k", "s", "A", "k", "alpha", "delta", "k"))

    def test_decorations_styles_and_stars(self):
        self.assertEqual(vt.tex_symbols(r"\bar{k}"), ("bar(k)",))
        self.assertEqual(vt.tex_symbols(r"\overline{k}"), ("bar(k)",))
        self.assertEqual(vt.tex_symbols(r"\tilde{\gamma}"), ("tilde(gamma)",))
        self.assertEqual(vt.tex_symbols(r"\hat\beta_2"), ("hat(beta)",))
        self.assertEqual(vt.tex_symbols(r"\mathbf{X}'\mathbf{X}"), ("bold(X)", "bold(X)"))
        self.assertEqual(vt.tex_symbols(r"\boldsymbol{\varepsilon}"), ("bold(varepsilon)",))
        self.assertEqual(vt.tex_symbols("k^*"), ("k*",))
        self.assertEqual(vt.tex_symbols("k^{*}"), ("k*",))
        self.assertEqual(vt.tex_symbols("k_t^*"), ("k*",))
        self.assertEqual(vt.tex_symbols(r"\bar{k}^{*}"), ("bar(k)*",))

    def test_unicode_is_the_same_symbol(self):
        self.assertEqual(vt.tex_symbols("α + \\alpha"), ("alpha", "alpha"))
        self.assertEqual(vt.tex_symbols("k̄"), ("bar(k)",))   # k̄ with a combining macron
        self.assertEqual(vt.tex_symbols("σ̂"), ("hat(sigma)",))  # σ̂

    def test_text_operators_and_environments_are_not_symbols(self):
        self.assertEqual(vt.tex_symbols(r"\text{Golden rule: } f'(\bar{k}) = \delta"), ("f", "bar(k)", "delta"))
        self.assertEqual(vt.tex_symbols(r"\mathrm{Var}(\mathbf{b}) = \sigma^2"), ("bold(b)", "sigma"))
        self.assertEqual(vt.tex_symbols(r"\begin{pmatrix}1&2\\3&4\end{pmatrix}"), ())
        self.assertEqual(vt.tex_symbols(r"\ln\tilde{k} + \frac{sA}{\delta}"), ("tilde(k)", "s", "A", "delta"))
        self.assertEqual(vt.tex_symbols(r"\sum_{i=1}^{N} x_i"), ("N", "x"))

    def test_row_keys(self):
        self.assertEqual(vt.row_keys("$f(k) = Ak^{\\alpha}$"), ("f",))
        self.assertEqual(vt.row_keys("$y = Y/L$, $k = K/L$, $c = C/L$"), ("y", "k", "c"))
        self.assertEqual(vt.row_keys("$\\bar{k}$, $\\bar{y}$"), ("bar(k)", "bar(y)"))
        self.assertEqual(vt.row_keys("$sf(k)$"), ("~sf(k)",))
        self.assertEqual(vt.row_keys("$\\delta k$"), ("~\\deltak",))
        # one $…$ group naming several symbols answers to each of them
        self.assertEqual(vt.row_keys("$k^*, y^*, c^*$"), ("k*", "y*", "c*"))
        self.assertEqual(vt.row_keys("$\\tilde{k}, \\tilde{y}$"), ("tilde(k)", "tilde(y)"))
        self.assertEqual(vt.row_keys("$f(x, y)$"), ("f",))

    def test_row_matching(self):
        math = r"\Delta k = sf(k) - \delta k"
        syms, norm = set(vt.tex_symbols(math)), vt.tex_norm(math)
        self.assertTrue(vt.row_matches(vt.row_keys("$\\delta k$"), syms, norm))
        self.assertTrue(vt.row_matches(vt.row_keys("$sf(k)$"), syms, norm))
        self.assertFalse(vt.row_matches(vt.row_keys("$\\bar{k}$"), syms, norm))


class Slugs(unittest.TestCase):
    def test_slugify(self):
        self.assertEqual(vt.slugify("Econ 402A L1 Solow Growth Model"), "econ-402a-l1-solow-growth-model")
        self.assertEqual(vt.slugify("L'Hôpital's Rule"), "lhopitals-rule")
        self.assertEqual(vt.slugify("Hummels, Jørgensen, Munch and Xiang 2014 - The Wage Effects of Offshoring"),
                         "hummels-jorgensen-munch-and-xiang-2014-the-wage-effects-of-offshoring")
        self.assertEqual(vt.slugify("Current Population Survey (CPS)"), "current-population-survey-cps")
        self.assertEqual(vt.slugify("Within- and Between-Group Inequality"), "within-and-between-group-inequality")


class Checkpoints(unittest.TestCase):
    def parse(self, text):
        (line, kind, fold, title, lines), = vt.callouts(text)
        self.assertEqual(kind, "check")
        return vt.parse_check(fold, title, lines)

    def test_multiple_choice(self):
        chk, errs = self.parse("> [!check]- Q?\n> - [ ] a\n> - [x] b\n> - [X] c\n>\n> **Why:** because")
        self.assertEqual(errs, [])
        self.assertEqual(chk["kind"], "mcq")
        self.assertEqual([c for _, c in chk["options"]], [False, True, True])

    def test_numeric_forms(self):
        for answer, value, tol in (("8 ± 0.05", 8, 0.05), ("8 +/- 0.05", 8, 0.05), ("1/3 ± 0.01", 1 / 3, 0.01),
                                   ("200 ± 1%", 200, 2), ("-0.5", -0.5, 0)):
            with self.subTest(answer=answer):
                chk, errs = self.parse(f"> [!check]- Q?\n> answer: {answer}\n>\n> **Why:** w")
                self.assertEqual(errs, [])
                self.assertAlmostEqual(chk["answer"], value)
                self.assertAlmostEqual(chk["tol"], tol)

    def test_malformed(self):
        cases = {
            "> [!check]- Q?\n> - [ ] a\n> - [ ] b\n> **Why:** w": "no correct option",
            "> [!check]- Q?\n> - [x] a\n> - [ ] b": "**Why:**",
            "> [!check] Q?\n> - [x] a\n> - [ ] b\n> **Why:** w": "fold it with '-'",
            "> [!check]- Q?\n> **Why:** w": "options or an 'answer:",
            "> [!check]- Q?\n> answer: about eight\n> **Why:** w": "must look like",
            "> [!check]- Q?\n> - [x] only one\n> **Why:** w": "at least two",
        }
        for text, expected in cases.items():
            with self.subTest(expected=expected):
                _, errs = self.parse(text)
                self.assertTrue(any(expected in e for e in errs), errs)

    def test_callouts_inside_code_are_ignored(self):
        self.assertEqual(vt.callouts("```markdown\n> [!check]- Q?\n```\n"), [])


class SeriesTestKeys(unittest.TestCase):
    """`tests.expect` may name series values: panels 'id@t' (time series) and 'id@x' (curves), data-chart 'id@x' and
    'id.<stat>'."""

    def errors(self, spec):
        return [e for e in vt.validate_spec(spec, set(), {}, lambda name: True) if e.startswith("tests[")]

    def test_data_chart_keys(self):
        spec = {"type": "data-chart", "dataset": "d", "x": {"column": "year"}, "y": {"column": "v"},
                "series": [{"id": "premium"}], "tests": [{"expect": {"premium@1980": 1, "premium@1980.5": 1, "premium.min": 1, "premium.n": 3}}]}
        self.assertEqual(self.errors(spec), [])
        spec["tests"] = [{"expect": {"premiums@1980": 1, "premium.median": 1}}]
        self.assertEqual(len(self.errors(spec)), 2)

    def test_time_series_keys_are_whole_periods_and_curve_keys_any_x(self):
        spec = {"type": "panels", "recurrence": {"var": "k", "init": 1, "periods": 5, "next": "k"},
                "panels": [{"kind": "path", "id": "levels", "series": [{"id": "k"}]},
                           {"kind": "curve", "id": "diagram", "x": {"sweep": "s"}, "y": {}, "curves": [{"id": "c", "expr": "s"}]}],
                "params": {"s": {"tex": "s", "min": 0, "max": 1, "default": 0.5}},
                "tests": [{"expect": {"k@3": 1, "k@2.5": 1, "levels@1": 1, "k.min": 1, "c@0.25": 1}}]}
        self.assertEqual(len(self.errors(spec)), 3)


class Fences(unittest.TestCase):
    def test_nested_fences_hide_their_content(self):
        text = "````markdown\n```interactive\nwidget: X\n```\n[[Not A Link]]\n````\n[[Real]]"
        self.assertEqual([f[2] for f in vt.fences(text)], ["markdown"])
        self.assertEqual(vt.links(text), ["Real"])
        self.assertEqual(vt.placements_in(text), ())

    def test_interactive_block_parse_errors(self):
        (p,) = vt.placements_in("text\n```interactive\nwidget: X\nprompt: a: b\n```")
        self.assertEqual((p.line, p.end, p.form), (1, 4, "fence"))
        self.assertIn("invalid YAML", p.error)


if __name__ == "__main__":
    unittest.main()
