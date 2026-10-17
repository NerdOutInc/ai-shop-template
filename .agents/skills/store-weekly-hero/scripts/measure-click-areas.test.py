"""Meaningful geometry failures for the portable helper; no image approval claims."""

import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("measure_click_areas", Path(__file__).with_name("measure-click-areas.py"))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def fixture():
    return {
        "desktop": {
            "canvas": [2400, 800],
            "safeArea": [600, 0, 1200, 800],
            "regions": {"product-a": [660, 120, 480, 600], "product-b": [1260, 120, 480, 600]},
        },
        "mobile": {
            "canvas": [800, 1400],
            "regions": {"product-a": [40, 280, 340, 900], "product-b": [420, 280, 340, 900]},
        },
    }


class LayoutTests(unittest.TestCase):
    def test_full_source_width_not_safe_area_width(self):
        plan = fixture()
        before = copy.deepcopy(plan)
        result = helper.measure(plan)
        self.assertEqual(result["percentages"]["desktop"]["product-a"]["left"], 27.5)
        self.assertEqual(result["percentages"]["desktop"]["product-a"]["width"], 20)
        self.assertEqual(plan, before)
        self.assertEqual(result["status"], "arithmetic-only-not-visual-approval")

    def test_bad_layouts_are_rejected(self):
        mutations = [
            lambda p: p["desktop"]["regions"]["product-a"].__setitem__(0, 599),
            lambda p: p["desktop"]["regions"]["product-b"].__setitem__(0, 1000),
            lambda p: p["mobile"]["regions"]["product-b"].__setitem__(0, 790),
            lambda p: p["mobile"]["regions"]["product-b"].__setitem__(2, 0),
            lambda p: p["desktop"]["canvas"].__setitem__(0, float("nan")),
            lambda p: p["desktop"]["canvas"].__setitem__(0, True),
            lambda p: p["mobile"]["regions"].pop("product-b"),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                plan = fixture()
                mutate(plan)
                with self.assertRaises(ValueError):
                    helper.measure(plan)

    def test_touching_edges_are_not_overlaps(self):
        plan = fixture()
        plan["mobile"]["regions"]["product-b"][0] = 380
        helper.measure(plan)


if __name__ == "__main__":
    unittest.main()
