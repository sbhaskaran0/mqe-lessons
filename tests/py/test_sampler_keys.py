"""Wave 3.1 widget keys in `check`: the sampler panel, a scatter-fit's contour panels, labelled readouts, and brief
numbers that span several tests (Monte Carlo numbers need a tolerance each)."""
import copy
import unittest

from helpers import vt

SAMPLER = {
    "type": "panels",
    "params": {"N": {"tex": "N", "min": 10, "max": 200, "step": 10, "default": 40},
               "R": {"tex": "R", "min": 100, "max": 2000, "step": 100, "default": 2000}},
    "fixed": {"beta2": 10},
    "panels": [{
        "kind": "sampler", "id": "hist", "seed": 430001, "reps": "R", "rows": "N",
        "columns": {"x": "uniform(4, 34)", "y": "80 + beta2*x + normal(0, 89.5)"},
        "fit": {"y": "y", "x": "x"}, "stat": "b2", "bins": 80, "x": {"min": 2, "max": 22},
        "summaries": {"b2_mean": "mean(b2)", "b2_sd": "sd(b2)"},
        "lines": [{"id": "truth", "x": "beta2"}],
        "densities": [{"id": "normal", "mean": "beta2", "sd": "b2_sd", "style": "dashed"}],
    }],
    "readouts": [{"id": "sd_out", "expr": "b2_sd"}],
    "tests": [{"params": {"N": 40}, "expect": {"b2_mean": 10}, "tol": 0.15},
              {"params": {"N": 40}, "expect": {"b2_sd": 1.68}, "tol": 0.11}],
}

FIT = {
    "type": "scatter-fit",
    "generate": {"n": 40, "seed": 1, "x": "uniform(4, 34)", "y": "80 + 10*x + normal(0, 89.5)"},
    "x": {}, "y": {},
    "params": {"b1": {"tex": "b_1", "min": -200, "max": 400, "default": 250},
               "b2": {"tex": "b_2", "min": -5, "max": 25, "default": 2}},
    "line": {"intercept": "b1", "slope": "b2"},
    "panels": [{"kind": "contour", "id": "bowl", "x": {"sweep": "b1", "min": -100, "max": 300},
                "y": {"sweep": "b2", "min": 0, "max": 20}, "f": "sum_yy - 2*b1*sum_y", "levels": ["2*ssr_min"],
                "points": [{"id": "here", "x": "b1", "y": "b2", "drag": {"x": "b1", "y": "b2"}}]}],
    "readouts": [{"id": "resid_sum", "expr": "sum_y - n*b1 - b2*sum_x"}],
    "tests": [{"params": {"b1": 250, "b2": 2}, "expect": {"sum_x": 1, "resid_sum": 0}}],
}


def errors(spec):
    return vt.validate_spec(spec, {"N", "R", "b"}, {}, lambda name: True)


class Sampler(unittest.TestCase):
    def test_a_sound_sampler_passes_and_its_summaries_are_scalars(self):
        self.assertEqual(errors(SAMPLER), [])
        params, elements, scalars = vt.widget_parts(SAMPLER)
        self.assertEqual(params, ["N", "R"])
        self.assertEqual(elements, ["hist", "truth", "normal", "sd_out"])
        self.assertIn("b2_sd", scalars)

    def test_bad_sampler_keys(self):
        spec = copy.deepcopy(SAMPLER)
        p = spec["panels"][0]
        p.update(stat="b3", bins=500, fit={"y": "y", "x": "w"}, summaries={"2bad": "mean(b2)"})
        p["columns"]["se_b2"] = "x"
        p["densities"][0]["style"] = "wavy"
        p["x"] = {"min": 5, "max": 1}
        del p["seed"]
        self.assertEqual(sorted(errors(spec)), sorted([
            "panels[0]: missing 'seed'",
            "panels[0].stat must be one of: b1, b2, se_b2, se_b2_hc1, t_b2, r2",
            "panels[0].bins must be between 5 and 120",
            "panels[0].fit.x 'w' is not one of the columns (x, y, se_b2)",
            "panels[0].summaries: '2bad' must be a plain identifier",
            "panels[0].columns: 'se_b2' is the name of a statistic (b1, b2, se_b2, se_b2_hc1, t_b2, r2)",
            "panels[0].x: min must be below max",
            "panels[0].densities[0].style must be one of: solid, dashed, dotted",
            "tests[0].expect: 'b2_mean' is not a derived value or readout (series use 'id@t', curves 'id@x'; an equation needs 'at:' binding its variables)",
            "tests[1].expect: 'b2_sd' is not a derived value or readout (series use 'id@t', curves 'id@x'; an equation needs 'at:' binding its variables)",
        ]))


class FitPanels(unittest.TestCase):
    def test_contour_panels_on_a_scatter_fit(self):
        self.assertEqual(errors(FIT), [])
        _, elements, scalars = vt.widget_parts(FIT)
        self.assertEqual(elements[:2], ["bowl", "here"])
        self.assertTrue({"sum_x", "sum_y", "sum_xx", "sum_xy", "sum_yy"} <= set(scalars))

    def test_only_contours_over_swept_parameters(self):
        spec = copy.deepcopy(FIT)
        spec["panels"].append({"kind": "curve", "id": "c", "x": {"var": "k", "min": 0, "max": 1}, "y": {}, "curves": []})
        spec["panels"][0]["x"] = {"var": "k", "min": 0, "max": 1}
        errs = errors(spec)
        self.assertIn("panels[1].kind must be contour (a scatter-fit takes contour panels over its parameters)", errs)
        self.assertIn("panels[0].x: a scatter-fit has no model variables - sweep a parameter (x: {sweep: <param>})", errs)
        spec = copy.deepcopy(FIT)
        spec["panels"][0]["x"]["sweep"] = "q"
        self.assertIn("panels[0].x.sweep 'q' is not a slider of the view", errors(spec))


class Aspect(unittest.TestCase):
    def test_aspect_equal_only(self):
        spec = copy.deepcopy(FIT)
        spec["panels"][0]["aspect"] = "equal"
        self.assertEqual(errors(spec), [])
        spec["panels"][0]["aspect"] = "wide"
        self.assertIn("panels[0].aspect must be: equal", errors(spec))


class ReadoutLabels(unittest.TestCase):
    def test_labels_map_numbers_to_text(self):
        spec = copy.deepcopy(SAMPLER)
        spec["readouts"][0]["labels"] = {2: "positive definite", -1: "negative semidefinite"}
        self.assertEqual(errors(spec), [])
        spec["readouts"][0]["labels"] = {"two": "positive definite", 1: ""}
        self.assertEqual([e for e in errors(spec) if "labels" in e], [
            "readouts[0].labels: 'two: positive definite' must map a number to its text (2: positive definite)",
            "readouts[0].labels: '1: ' must map a number to its text (2: positive definite)",
        ])


class BriefNumbers(unittest.TestCase):
    def test_a_number_may_span_tests_with_their_own_tolerances(self):
        number = {"params": {"N": 40}, "expect": {"b2_mean": 10, "b2_sd": 1.68}}
        self.assertTrue(vt._in_tests(number, SAMPLER))
        self.assertFalse(vt._in_tests({**number, "expect": {"b2_mean": 10, "b2_sd": 1.9}}, SAMPLER))
        self.assertFalse(vt._in_tests({**number, "params": {"N": 160}}, SAMPLER))


if __name__ == "__main__":
    unittest.main()
