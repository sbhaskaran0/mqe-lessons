"""Wave 6.1 data-chart keys in `check` (docs/PLAN.md, "Interface note: data-chart lookups"): filters bound to sliders,
a mark per series (rug included), panels, dragged points and param labels. Typos are rejected as before."""
import copy
import unittest

from helpers import vt

CHART = {
    "type": "data-chart",
    "dataset": "toy-kde-lookup",
    "params": {"h": {"tex": "h", "min": 0.5, "max": 1.5, "step": 0.5, "default": 0.5},
               "kernel": {"tex": "K", "min": 1, "max": 2, "step": 1, "default": 1, "labels": {1: "Gaussian", 2: "Box"}},
               "px": {"tex": "x_0", "min": 0, "max": 4, "step": 0.5, "default": 1},
               "py": {"tex": "y_0", "min": 0, "max": 0.5, "step": 0.05, "default": 0.1}},
    "derived": {"err": 'at("ise", h)'},
    "readouts": [{"id": "ise_now", "expr": 'at("ise", h)'}],
    "panels": [
        {"id": "density", "title": "Density", "x": {"column": "x"}, "y": {"column": "y"},
         "series": [{"id": "hist", "mark": "bar", "where": {"series": "hist"}},
                    {"id": "kde", "where": {"series": "kde", "h": {"param": "h"}, "kernel": {"param": "kernel"}}},
                    {"id": "rug", "mark": "rug", "where": {"series": "data"}},
                    {"id": "probe", "drag": {"x": "px", "y": "py"}}]},
        {"id": "error", "mark": "point", "x": {"column": "x", "kind": "number"}, "y": {"column": "y"},
         "series": [{"id": "ise", "mark": "line", "where": {"series": "ise", "kernel": {"param": "kernel"}}}],
         "annotations": [{"id": "best", "x": 1, "label": "Best"}]},
    ],
    "tests": [{"params": {"h": 1, "kernel": 2}, "expect": {"err": 0.02, "kde@2": 0.2, "ise.min": 0.02}}],
}


def errors(spec):
    return vt.validate_spec(spec, {"h", "K", "x", "y"}, {"toy-kde-lookup": {"file": "exports/none.csv"}}, lambda name: True)


class Lookups(unittest.TestCase):
    def test_a_sound_precomputed_chart_passes(self):
        self.assertEqual(errors(CHART), [])
        params, elements, scalars = vt.widget_parts(CHART)
        self.assertEqual(params, ["h", "kernel", "px", "py"])
        self.assertEqual(elements, ["density", "error", "hist", "kde", "rug", "probe", "ise", "best", "ise_now"])
        self.assertIn("err", scalars)

    def test_the_single_chart_form_is_unchanged(self):
        spec = {"type": "data-chart", "dataset": "toy-kde-lookup", "mark": "line", "x": {"column": "x"}, "y": {"column": "y"},
                "series": [{"id": "a", "where": {"series": "kde"}}], "tests": [{"expect": {"a.n": 5, "a@2": 1}}]}
        self.assertEqual(errors(spec), [])
        del spec["x"]
        self.assertIn("spec: missing 'x' (or give panels)", errors(spec))

    def test_bad_lookup_keys(self):
        spec = copy.deepcopy(CHART)
        spec["x"] = {"column": "x"}
        spec["panels"].append(copy.deepcopy(spec["panels"][1]))
        spec["panels"].append(copy.deepcopy(spec["panels"][1]))
        spec["params"]["kernel"]["labels"] = {1: "Gaussian", 1.5: "Half", "two": "Box", 2: ""}
        del spec["params"]["h"]["step"]
        d, e = spec["panels"][0], spec["panels"][1]
        d["mark"] = "ribbon"
        d["x"]["kind"] = "date"
        d["series"][0].update(mark="dots", colour="red")
        d["series"][1]["where"]["h"] = {"param": "h"}           # no step any more
        d["series"][1]["where"]["kernel"] = {"param": "kernl"}
        d["series"][2]["where"]["series"] = {"col": "data"}
        d["series"][3]["drag"] = {"x": "px", "y": "pz"}
        d["series"][3]["where"] = {"series": "probe"}
        e["series"][0]["drag"] = {"x": "px"}
        e["annotation"] = []
        got = errors(spec)
        for want in [
            "panels replace the chart's x, y, series and annotations - move x into the panels",
            "panels holds 4 chart(s); a data-chart takes 2 or 3 (or none: one chart)",
            "params.kernel.labels: '1.5' is not a slider position (min + k·step)",
            "params.kernel.labels: 'two' must be a number in [1, 2] (a slider position)",
            "params.kernel.labels.2 must be non-empty text",
            "panels[0].mark must be one of: line, bar, area, point, rug",
            "panels[0].x.kind must be one of: number, time, band",
            "panels[0].series[0]: unknown key 'colour' (allowed: id, label, tex, column, where, color, mark, drag)",
            "series 'hist': mark must be one of: line, bar, area, point, rug",
            "series 'kde': where.h is bound to 'h', which needs a step (the table holds rows per slider position)",
            "series 'kde': where.kernel is bound to 'kernl', which is not a parameter",
            "series 'rug': where.series must be a value or {param: <slider>}",
            "series 'probe': drag.y 'pz' is not a parameter",
            "series 'probe': a dragged point is drawn at its params and takes no where or column",
            "series 'ise'.drag: missing 'y'",
            "panels[1]: unknown key 'annotation' (allowed: id, title, mark, x, y, series, annotations)",
            "id 'ise' is defined twice",
        ]:
            self.assertIn(want, got)

    def test_test_keys_read_series_in_any_panel(self):
        spec = copy.deepcopy(CHART)
        spec["tests"] = [{"expect": {"ise@1": 0.03, "kde.max": 1, "nope@1": 0}}]
        got = errors(spec)
        self.assertEqual([e for e in got if "tests[0]" in e], [
            "tests[0].expect: 'nope@1' is not a derived value or readout (series use 'id@x' or 'id.min', .max, .first, .last, .mean, .n)"])

    def test_columns_come_from_every_panel(self):
        cols = vt._spec_columns(CHART, "data-chart")
        self.assertEqual(sorted(set(cols)), ["h", "kernel", "series", "x", "y"])

    def test_labels_on_any_widget_type(self):
        spec = {"type": "custom", "component": "Toy", "params": {"f": {"tex": "f", "min": 1, "max": 3, "step": 1, "default": 1,
                                                                    "labels": {1: "a", 2: "b", 4: "c"}}}}
        self.assertIn("params.f.labels: '4' must be a number in [1, 3] (a slider position)", errors(spec))


if __name__ == "__main__":
    unittest.main()
