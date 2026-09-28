#!/usr/bin/env python3
"""Run with Python and Pillow; all assets and reports stay in temporary folders."""

import contextlib
import copy
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, PngImagePlugin


SCRIPT = Path(__file__).with_name("inspect-print-assets.py")
INSPECTOR = runpy.run_path(str(SCRIPT))


class InspectPrintAssetsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="print-assets-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "collection"
        self.root.mkdir()
        for directory in ("originals", "print", "gallery"):
            (self.root / directory).mkdir()
        self.png("originals/01.png")
        self.png("print/01.png")
        Image.new("RGB", (4, 6), "navy").save(self.root / "gallery/01.webp")
        self.manifest_path = self.root / "concepts.json"
        self.output = self.root / "validation.json"
        self.manifest = {
            "storageKey": "fixture-v1",
            "concepts": [
                {
                    "id": "01",
                    "original": "originals/01.png",
                    "image": "gallery/01.webp",
                    "printDownload": "print/01.png",
                    "printDimensions": {"width": 8, "height": 12},
                }
            ],
        }
        self.save_manifest()

    def png(self, relative, size=(8, 12), color=(180, 80, 40, 255), alpha="mixed", metadata=None):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        background = color if alpha == "opaque" else (0, 0, 0, 0)
        image = Image.new("RGBA", size, background)
        if alpha == "mixed":
            image.paste(color, (1, 1, size[0] - 1, size[1] - 1))
        image.save(path, pnginfo=metadata)
        return path

    def save_manifest(self):
        self.manifest_path.write_text(json.dumps(self.manifest), encoding="utf-8")

    def inspect(self, count=1, output=None, save_manifest=True):
        if save_manifest:
            self.save_manifest()
        arguments = ["--manifest", str(self.manifest_path), "--expected-count", str(count)]
        if output is not None:
            arguments.extend(["--output", str(output)])
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = INSPECTOR["main"](arguments)
        self.assertNotIn("Traceback", stderr.getvalue())
        return code, json.loads(stdout.getvalue())

    def assert_error(self, report, field, fragment):
        self.assertTrue(
            any(
                error.get("field") == field and fragment.lower() in error["error"].lower() for error in report["errors"]
            ),
            report["errors"],
        )

    def test_cli_reports_real_alpha_dimensions_and_hashes(self):
        process = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--manifest",
                str(self.manifest_path),
                "--expected-count",
                "1",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(process.returncode, 0, process.stderr)
        report = json.loads(process.stdout)
        self.assertTrue(report["inspectionComplete"])
        self.assertEqual(report["inspected"], 1)
        row = report["concepts"][0]
        self.assertEqual(row["download"]["alphaRange"], [0, 255])
        self.assertEqual(row["download"]["visibleBounds"], [1, 1, 7, 11])
        self.assertEqual((row["download"]["width"], row["download"]["height"]), (8, 12))
        self.assertEqual(len(row["download"]["sha256"]), 64)
        self.assertEqual(row["resolutionStatus"], "not-assessed")
        self.assertTrue(report["warnings"])

    def test_rejects_fully_opaque_and_fully_transparent_downloads(self):
        for alpha in ("opaque", "clear"):
            with self.subTest(alpha=alpha):
                self.png("print/01.png", alpha=alpha)
                code, report = self.inspect()
                self.assertEqual(code, 1)
                self.assertTrue(report["inspectionComplete"])
                self.assert_error(report, "printDownload", "transparent pixels and visible artwork")

    def test_accepts_antialiased_artwork_and_records_partial_alpha(self):
        path = self.root / "print/01.png"
        with Image.open(path) as image:
            image.putpixel((1, 1), (180, 80, 40, 128))
            image.save(path)
        code, report = self.inspect()
        self.assertEqual(code, 0)
        self.assertGreater(report["concepts"][0]["download"]["partialAlphaFraction"], 0)

    def test_opaque_original_is_valid_when_download_is_transparent(self):
        self.png("originals/01.png", alpha="opaque")
        code, report = self.inspect()
        self.assertEqual(code, 0)
        self.assertEqual(report["concepts"][0]["original"]["alphaRange"], [255, 255])

    def test_original_is_required_but_may_equal_download(self):
        concept = self.manifest["concepts"][0]
        del concept["original"]
        code, report = self.inspect()
        self.assertEqual(code, 1)
        self.assert_error(report, "original", "local path")
        concept["original"] = concept["printDownload"]
        self.assertEqual(self.inspect()[0], 0)

    def test_rejects_non_png_and_multiframe_downloads_with_field_diagnostics(self):
        for field in ("original", "printDownload"):
            with self.subTest(field=field):
                path = self.root / self.manifest["concepts"][0][field]
                before = path.read_bytes()
                path.write_bytes(b"not an image")
                code, report = self.inspect()
                self.assertEqual(code, 1)
                self.assert_error(report, field, field)
                path.write_bytes(before)
        frames = [Image.new("RGBA", (8, 12), color) for color in ("red", "blue")]
        frames[0].save(self.root / "print/01.png", save_all=True, append_images=frames[1:], duration=10)
        self.assert_error(self.inspect()[1], "printDownload", "single-frame PNG")

    def test_duplicate_decoded_pixels_are_rejected_despite_different_png_bytes(self):
        metadata = PngImagePlugin.PngInfo()
        metadata.add_text("revision", "same pixels, different bytes")
        duplicate = self.png("print/02.png", metadata=metadata)
        self.assertNotEqual(duplicate.read_bytes(), (self.root / "print/01.png").read_bytes())
        second = copy.deepcopy(self.manifest["concepts"][0])
        second.update(id="02", printDownload="print/02.png")
        self.manifest["concepts"].append(second)
        code, report = self.inspect(count=2)
        self.assertEqual(code, 1)
        self.assertEqual(report["inspected"], 1)
        self.assert_error(report, "printDownload", "pixels duplicate concept 01")

    def test_declared_dimensions_must_match_decoded_integers(self):
        for dimensions in (
            {"width": 3600, "height": 4800},
            {"width": 8.5, "height": 12},
            {"width": True, "height": 12},
            [8, 12],
            "8x12",
        ):
            with self.subTest(dimensions=dimensions):
                self.manifest["concepts"][0]["printDimensions"] = dimensions
                code, report = self.inspect()
                self.assertEqual(code, 1)
                self.assert_error(report, "printDimensions", "decoded PNG")

    def test_enlargement_needs_real_visible_notes_and_keeps_source_ppi(self):
        self.png("print/01.png", size=(16, 24))
        concept = self.manifest["concepts"][0]
        concept.update(
            printDimensions={"width": 16, "height": 24}, printSizeInches={"width": 2, "height": 3}, targetPpi=8
        )
        for notes in (None, "", "  ", 123, True):
            with self.subTest(notes=notes):
                concept["printNotes"] = notes
                code, report = self.inspect()
                self.assertEqual(code, 1)
                self.assert_error(report, "printNotes", "visible printNotes")
        concept["printNotes"] = "Enlarged 2x; native source detail remains limited."
        code, report = self.inspect()
        self.assertEqual(code, 0)
        row = report["concepts"][0]
        self.assertTrue(row["enlarged"])
        self.assertEqual((row["sourcePpi"], row["downloadPpi"]), (4, 8))
        self.assertEqual(row["resolutionStatus"], "enlarged-source-below-target")
        self.assertTrue(report["warnings"])

    def test_native_and_below_target_resolution_status(self):
        concept = self.manifest["concepts"][0]
        concept["printSizeInches"] = {"width": 2, "height": 3}
        for target, status in ((4, "native-meets-target"), (5, "download-below-target")):
            with self.subTest(target=target):
                concept["targetPpi"] = target
                code, report = self.inspect()
                self.assertEqual(code, 0)
                self.assertEqual(report["concepts"][0]["resolutionStatus"], status)
                self.assertEqual(bool(report["warnings"]), target == 5)

    def test_invalid_print_targets_are_diagnostics_not_crashes(self):
        concept = self.manifest["concepts"][0]
        concept["printSizeInches"] = {"width": 2, "height": 3}
        for target in (0, -1, True, "300", float("inf"), float("nan"), 10**400):
            with self.subTest(target=target):
                concept["targetPpi"] = target
                code, report = self.inspect()
                self.assertEqual(code, 1)
                self.assert_error(report, "printSizeInches/targetPpi", "positive")

    def test_ids_require_untrimmed_nonempty_strings_without_coercion(self):
        for value in (None, 1, True, [], {}, "", " ", " 01", "01\n"):
            with self.subTest(value=value):
                self.manifest["concepts"][0]["id"] = value
                code, report = self.inspect()
                self.assertEqual(code, 1)
                self.assertTrue(report["inspectionComplete"])
                self.assert_error(report, "id", "nonempty string without surrounding whitespace")

    def test_tiny_print_dimensions_do_not_emit_infinite_ppi(self):
        concept = self.manifest["concepts"][0]
        concept.update(printSizeInches={"width": 1e-320, "height": 1e-320}, targetPpi=300)
        code, report = self.inspect()
        self.assertEqual(code, 1)
        self.assert_error(report, "printSizeInches/targetPpi", "finite PPI")
        json.dumps(report, allow_nan=False)

    def test_duplicate_ids_and_nonobject_concepts_are_useful_errors(self):
        self.manifest["concepts"].append(copy.deepcopy(self.manifest["concepts"][0]))
        code, report = self.inspect(count=2)
        self.assertEqual(code, 1)
        self.assert_error(report, "id", "duplicates 01")
        self.manifest["concepts"] = [None]
        self.assert_error(self.inspect()[1], "concept", "must be an object")

    def test_all_asset_fields_reject_missing_remote_absolute_and_escaping_paths(self):
        outside = Path(self.temporary.name) / "outside.png"
        outside.write_bytes((self.root / "print/01.png").read_bytes())
        values = [
            None,
            "missing.png",
            "https://example.com/image.png",
            "file:print/01.png",
            "data:image/png;base64,AAAA",
            "C:\\print\\01.png",
            "\\\\server\\share\\01.png",
            "\\print\\01.png",
            "print/01.png\0",
            str(outside),
            "../outside.png",
        ]
        for field in ("original", "image", "printDownload"):
            for value in values:
                with self.subTest(field=field, value=value):
                    old = self.manifest["concepts"][0][field]
                    self.manifest["concepts"][0][field] = value
                    code, report = self.inspect()
                    self.assertEqual(code, 1)
                    self.assertTrue(any(error.get("field") == field for error in report["errors"]))
                    self.manifest["concepts"][0][field] = old

    def test_internal_normalized_paths_and_contained_symlinks_are_allowed(self):
        concept = self.manifest["concepts"][0]
        concept["original"] = "originals/../originals/01.png"
        (self.root / "contained.png").symlink_to(self.root / "print/01.png")
        concept["printDownload"] = "contained.png"
        self.assertEqual(self.inspect()[0], 0)

    def test_symlinked_collection_directory_is_a_valid_manifest_base(self):
        alias = Path(self.temporary.name) / "collection-alias"
        alias.symlink_to(self.root, target_is_directory=True)
        self.manifest_path = alias / "concepts.json"
        code, report = self.inspect(output=alias / "validation.json")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(self.output.read_text()), report)

    def test_lexical_escape_is_rejected_even_when_symlink_returns_inside(self):
        alias = Path(self.temporary.name) / "outside-alias"
        alias.symlink_to(self.root, target_is_directory=True)
        self.manifest["concepts"][0]["original"] = "../outside-alias/originals/01.png"
        self.assert_error(self.inspect()[1], "original", "path must stay within")

    def test_asset_path_whitespace_is_literal_not_trimmed(self):
        path = self.root / " original.png "
        path.write_bytes((self.root / "originals/01.png").read_bytes())
        self.manifest["concepts"][0]["original"] = " original.png "
        self.assertEqual(self.inspect()[0], 0)

    def test_external_file_and_directory_symlinks_fail_for_every_asset_field(self):
        outside = Path(self.temporary.name) / "outside"
        outside.mkdir()
        (outside / "asset.png").write_bytes((self.root / "print/01.png").read_bytes())
        (self.root / "escape.png").symlink_to(outside / "asset.png")
        (self.root / "escape-dir").symlink_to(outside, target_is_directory=True)
        for field in ("original", "image", "printDownload"):
            for value in ("escape.png", "escape-dir/asset.png"):
                with self.subTest(field=field, value=value):
                    old = self.manifest["concepts"][0][field]
                    self.manifest["concepts"][0][field] = value
                    self.assert_error(self.inspect()[1], field, "symlink must stay within")
                    self.manifest["concepts"][0][field] = old

    def test_download_file_aliases_are_rejected(self):
        alias = self.root / "gallery/alias.png"
        os.link(self.root / "print/01.png", alias)
        self.manifest["concepts"][0]["image"] = "gallery/alias.png"
        self.assert_error(self.inspect()[1], "printDownload", "distinct")
        self.manifest["concepts"][0]["image"] = "gallery/01.webp"
        second = copy.deepcopy(self.manifest["concepts"][0])
        second.update(id="02", printDownload="gallery/alias.png")
        self.manifest["concepts"].append(second)
        self.assert_error(self.inspect(count=2)[1], "printDownload", "distinct")

    def test_fatal_root_list_count_and_key_errors_preserve_existing_report(self):
        valid = copy.deepcopy(self.manifest)
        cases = [(root, 1, "manifest") for root in (None, [], "wrong", 42)]
        cases.extend((dict(valid, concepts=value), 1, "concepts") for value in (None, {}, "wrong"))
        cases.extend(
            (dict(valid, storageKey=value), 1, "storageKey")
            for value in (None, 1, True, {}, "", " ", " fixture", "fixture\n")
        )
        cases.extend((valid, count, "expectedCount") for count in (0, -1, "nope", "1.5"))
        cases.append((valid, 2, "concepts"))
        for manifest, count, field in cases:
            with self.subTest(manifest=manifest, count=count):
                self.manifest = manifest
                self.output.write_text("previous verified report", encoding="utf-8")
                code, report = self.inspect(count=count, output=self.output)
                self.assertEqual(code, 1)
                self.assertFalse(report["inspectionComplete"])
                self.assertEqual(report["inspected"], 0)
                self.assertEqual(report["errors"][0]["field"], field)
                self.assertEqual(self.output.read_text(), "previous verified report")

    def test_bad_json_and_read_failures_preserve_existing_report(self):
        for contents in (b"{broken json", b"\xff\xfe"):
            with self.subTest(contents=contents):
                self.manifest_path.write_bytes(contents)
                self.output.write_text("previous", encoding="utf-8")
                code, report = self.inspect(output=self.output, save_manifest=False)
                self.assertEqual(code, 1)
                self.assertFalse(report["inspectionComplete"])
                self.assertEqual(report["errors"][0]["field"], "manifest")
                self.assertEqual(self.output.read_text(), "previous")
        self.manifest_path.unlink()
        code, report = self.inspect(output=self.output, save_manifest=False)
        self.assertEqual(code, 1)
        self.assertFalse(report["inspectionComplete"])
        self.assertEqual(self.output.read_text(), "previous")

    def test_completed_reports_write_even_with_per_concept_errors(self):
        self.manifest["concepts"][0]["original"] = "missing.png"
        self.output.write_text("old", encoding="utf-8")
        code, report = self.inspect(output=self.output)
        self.assertEqual(code, 1)
        self.assertTrue(report["inspectionComplete"])
        self.assertEqual(json.loads(self.output.read_text()), report)
        self.assert_error(report, "original", "missing")

    def test_atomic_write_replaces_successfully_and_preserves_old_report_on_failure(self):
        self.output.write_text("old", encoding="utf-8")
        code, report = self.inspect(output=self.output)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(self.output.read_text()), report)
        previous = self.output.read_bytes()
        with patch.object(os, "replace", side_effect=OSError("replacement failed")):
            code, report = self.inspect(output=self.output)
        self.assertEqual(code, 1)
        self.assertTrue(report["inspectionComplete"])
        self.assert_error(report, "output", "replacement failed")
        self.assertEqual(self.output.read_bytes(), previous)
        self.assertEqual(list(self.root.glob(".validation.json.*.tmp")), [])

    def test_output_manifest_and_asset_collisions_include_symlinks_and_hardlinks(self):
        for source in (
            self.manifest_path,
            self.root / "originals/01.png",
            self.root / "gallery/01.webp",
            self.root / "print/01.png",
        ):
            for alias_kind in ("direct", "symlink", "hardlink"):
                with self.subTest(source=source, alias_kind=alias_kind):
                    self.save_manifest()
                    before = source.read_bytes()
                    output = source
                    if alias_kind != "direct":
                        output = self.root / f"output-{alias_kind}.json"
                        if alias_kind == "symlink":
                            output.symlink_to(source)
                        else:
                            os.link(source, output)
                    try:
                        code, report = self.inspect(output=output, save_manifest=False)
                        self.assertEqual(code, 1)
                        self.assertFalse(report["inspectionComplete"])
                        self.assert_error(report, "output", "must not overwrite")
                        self.assertEqual(source.read_bytes(), before)
                    finally:
                        if output != source:
                            output.unlink()

    def test_collision_is_protected_even_for_an_invalid_asset_path(self):
        outside = Path(self.temporary.name) / "outside.png"
        outside.write_bytes((self.root / "print/01.png").read_bytes())
        self.manifest["concepts"][0]["original"] = "../outside.png"
        before = outside.read_bytes()
        code, report = self.inspect(output=outside)
        self.assertEqual(code, 1)
        self.assertFalse(report["inspectionComplete"])
        self.assert_error(report, "output", "original")
        self.assertEqual(outside.read_bytes(), before)

    def test_missing_output_directory_fails_before_inspection(self):
        code, report = self.inspect(output=self.root / "missing" / "report.json")
        self.assertEqual(code, 1)
        self.assertFalse(report["inspectionComplete"])
        self.assert_error(report, "output", "directory does not exist")


if __name__ == "__main__":
    unittest.main()
