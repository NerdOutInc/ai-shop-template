"""Meaningful geometry failures for the portable helper; no image approval claims."""

import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
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
        self.assertAlmostEqual(result["percentages"]["desktop"]["product-a"]["left"], 27.5)
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
            lambda p: p.__setitem__("desktop", []),
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

    def run_cli(self, raw):
        with tempfile.TemporaryDirectory() as directory:
            layout = Path(directory) / "layout.json"
            layout.write_text(raw, encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(Path(__file__).with_name("measure-click-areas.py")), str(layout)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
            )

    def assert_rejected(self, raw, message):
        result = self.run_cli(raw)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertTrue(result.stderr.startswith("Layout rejected: "))
        self.assertIn(message, result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_misspelled_safe_area_cannot_disable_crop_guard(self):
        plan = fixture()
        plan["desktop"]["safearea"] = plan["desktop"].pop("safeArea")
        plan["desktop"]["regions"]["product-a"][0] = 0
        self.assert_rejected(json.dumps(plan), "desktop only accepts canvas, safeArea and regions")

    def test_duplicate_json_keys_are_rejected_before_geometry(self):
        raw = json.dumps(fixture())
        for key in ("desktop", "canvas", "safeArea", "regions", "product-a"):
            with self.subTest(key=key):
                duplicated = raw.replace(f'"{key}":', f'"{key}": null, "{key}":')
                self.assert_rejected(duplicated, f"Duplicate JSON key: {key!r}")

    def test_huge_numbers_fail_cleanly_in_every_coordinate_kind(self):
        for target in ("canvas", "safeArea", "regions"):
            for index in range(2 if target == "canvas" else 4):
                with self.subTest(target=target, index=index):
                    plan = fixture()
                    coordinates = plan["desktop"][target]
                    if target == "regions":
                        coordinates = coordinates["product-a"]
                    coordinates[index] = 10**400
                    self.assert_rejected(json.dumps(plan), "finite")

    def test_large_finite_coordinates_do_not_overflow_percentages(self):
        layout = {"canvas": [1e308, 1e308], "regions": {"product-a": [0, 0, 5e307, 5e307]}}
        result = self.run_cli(json.dumps({"desktop": layout, "mobile": layout}))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["percentages"]["desktop"]["product-a"]["width"], 50)

    def test_utf8_layout_round_trip(self):
        raw = json.dumps(fixture()).replace("product-a", "café")
        result = self.run_cli(raw)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), helper.measure(json.loads(raw)))

    def test_invalid_json_fails_cleanly(self):
        self.assert_rejected('{"desktop":', "Expecting value")


if __name__ == "__main__":
    unittest.main()
