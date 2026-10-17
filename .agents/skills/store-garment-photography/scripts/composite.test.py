"""Check original/masked pixels and unsafe inputs without any brand photographs."""

import contextlib
import hashlib
import io
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageCms, ImageDraw, ImageOps

import composite
import compositor
from imaging import load_image, srgb_profile_bytes

spec = importlib.util.spec_from_file_location("placement_guide", Path(__file__).with_name("placement-guide.py"))
guide = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guide)


def wide_gamut_profile():
    """Synthetic RGB profile with D50-adapted P3 primaries; no external fixture."""
    profile = bytearray(srgb_profile_bytes())
    primaries = {
        b"rXYZ": (0.5151, 0.2412, -0.00105),
        b"gXYZ": (0.29198, 0.69223, 0.04189),
        b"bXYZ": (0.15710, 0.06657, 0.78407),
    }
    count = struct.unpack_from(">I", profile, 128)[0]
    for i in range(count):
        tag, offset, _ = struct.unpack_from(">4sII", profile, 132 + i * 12)
        if tag in primaries:
            struct.pack_into(">3i", profile, offset + 8, *(round(v * 65536) for v in primaries[tag]))
    return bytes(profile)


class CompositeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        yy, xx = np.mgrid[:1500, :1200]
        cloth = np.uint8(50 + 10 * np.sin(xx / 40) + 5 * np.cos(yy / 12))
        Image.fromarray(np.stack([cloth] * 3, axis=2)).save(self.root / "blank.png")
        art = Image.new("RGBA", (180, 240))
        ImageDraw.Draw(art).rectangle((10, 10, 170, 230), fill=(190, 90, 210, 255))
        art.save(self.root / "art.png")
        rng = np.random.default_rng(12)
        Image.fromarray(rng.integers(80, 150, (60, 60, 3), dtype=np.uint8)).save(self.root / "texture.png")
        mask = Image.new("L", (1200, 1500), 255)
        ImageDraw.Draw(mask).rectangle((0, 700, 1199, 850), fill=0)
        mask.save(self.root / "mask.png")
        self.job = {
            "schemaVersion": 1,
            "artwork": "art.png",
            "blank": "blank.png",
            "texturePatches": {"cream": "texture.png", "red": "texture.png"},
            "visibilityMask": "mask.png",
            "sourceCropBox": [0, 0, 1200, 1500],
            "quad": [[400, 500], [800, 500], [800, 1000], [400, 1000]],
            "targetArtworkInches": [8, 10],
        }
        self.path = self.root / "job.json"

    def prepare(self):
        self.path.write_text(json.dumps(self.job), encoding="utf-8")
        return composite.prepare(self.path)

    def test_preserves_source_and_foreground_and_is_unreviewed(self):
        self.prepare()
        before = composite.digest(self.root / "art.png")
        with contextlib.redirect_stdout(io.StringIO()):
            receipt = composite.run(self.path, self.root / "result")
        self.assertEqual(composite.digest(self.root / "art.png"), before)
        self.assertEqual(composite.digest(self.root / "result/sources/approved-artwork.png"), before)
        self.assertEqual(receipt["status"], "rendered-awaiting-independent-visual-review")
        original = np.asarray(Image.open(self.root / "blank.png"))
        final = np.asarray(Image.open(self.root / "result/full/photo.png"))
        self.assertTrue(np.array_equal(original[700:851], final[700:851]))
        self.assertTrue(np.array_equal(original[:400], final[:400]))
        self.assertFalse(np.array_equal(original, final))
        projected_alpha = np.asarray(Image.open(self.root / "result/sources/photo-projected-art.png"))[:, :, 3]
        visibility = np.asarray(Image.open(self.root / "mask.png"))
        outside = (projected_alpha == 0) | (visibility == 0)
        self.assertEqual(receipt["treatment"]["outsideInkChangedPixelCount"], 0)
        self.assertTrue(np.array_equal(original[outside], final[outside]))
        self.assertEqual(
            set(receipt["rendererFilesSha256"]),
            {"composite.py", "compositor.py", "imaging.py", "jobdata.py", "requirements.txt"},
        )
        with self.assertRaisesRegex(ValueError, "already exists"):
            composite.run(self.path, self.root / "result")

    def test_wrong_artwork_checksum(self):
        self.job["expectedSha256"] = {"artwork": hashlib.sha256(b"different").hexdigest()}
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.prepare()

    def test_crossed_quad(self):
        self.job["quad"][1], self.job["quad"][2] = self.job["quad"][2], self.job["quad"][1]
        with self.assertRaisesRegex(ValueError, "convex"):
            self.prepare()

    def test_cyclic_corner_rotations_fail_but_a_tilted_torso_is_supported(self):
        corners = self.job["quad"]
        for rotation in (1, 2, 3):
            self.job["quad"] = corners[rotation:] + corners[:rotation]
            with self.assertRaisesRegex(ValueError, "start at TL"):
                self.prepare()
        self.job["quad"] = [[500, 400], [850, 600], [600, 1050], [250, 850]]
        self.prepare()

    def test_broad_bends_do_not_clip_at_the_old_fixed_mesh_margin(self):
        art = Image.open(self.root / "art.png")
        for fraction, rows in ((-0.3, slice(0, 450)), (0.3, slice(1050, 1500))):
            self.job["surfaceBend"] = {"verticalFraction": fraction, "centerV": 0.5, "spreadV": 2.0}
            self.prepare()
            projected = compositor.project(art, self.job["quad"], self.job["surfaceBend"])
            alpha = np.asarray(projected)[:, :, 3]
            self.assertGreater(int(alpha[rows, 580:620].max()), 240)
            # The curved outer edge tapers instead of appearing at a mesh boundary.
            nonempty_rows = np.flatnonzero((alpha > 200).any(axis=1))
            edge = nonempty_rows[0] if fraction < 0 else nonempty_rows[-1]
            self.assertLess(int((alpha[edge] > 200).sum()), 100)

    def test_failed_render_can_retry_same_output(self):
        self.job["foldGuides"] = [
            {"points": [[500, 600], [700, 900]], "width": 30, "amplitude": 400, "weight": 1, "kind": "ridge"}
        ]
        self.prepare()
        output = self.root / "retry"
        with self.assertRaisesRegex(ValueError, "Fold deformation"):
            composite.run(self.path, output)
        self.assertFalse(output.exists())
        self.assertEqual(list(self.root.glob(".retry-*")), [])
        self.job["foldGuides"] = []
        self.prepare()
        with contextlib.redirect_stdout(io.StringIO()):
            composite.run(self.path, output)
        self.assertTrue((output / "receipt.json").is_file())

    def test_normalizes_profiles_and_embeds_srgb_in_deliverables(self):
        profile = wide_gamut_profile()
        blank = Image.new("RGB", (1200, 1500), (180, 90, 70))
        blank.save(self.root / "blank.png", icc_profile=profile)
        with Image.open(self.root / "art.png") as art:
            art.save(self.root / "art.png", icc_profile=profile)
        expected = ImageCms.profileToProfile(
            blank,
            ImageCms.ImageCmsProfile(io.BytesIO(profile)),
            ImageCms.ImageCmsProfile(io.BytesIO(srgb_profile_bytes())),
            outputMode="RGB",
        )
        self.assertNotEqual(expected.getpixel((0, 0)), blank.getpixel((0, 0)))
        self.prepare()
        with contextlib.redirect_stdout(io.StringIO()):
            composite.run(self.path, self.root / "color")
        with Image.open(self.root / "color/full/photo.png") as final:
            self.assertEqual(final.getpixel((0, 0)), expected.getpixel((0, 0)))
        for suffix in ("png", "jpg"):
            with Image.open(self.root / f"color/full/photo.{suffix}") as final:
                self.assertEqual(final.info["icc_profile"], srgb_profile_bytes())
        normalized = load_image(self.root / "art.png", "RGBA")
        projected = Image.open(self.root / "color/sources/photo-projected-art.png")
        self.assertEqual(projected.getpixel((600, 600)), normalized.getpixel((90, 120)))

    def test_phone_orientation_matches_viewer_and_guide_keeps_top_landmarks(self):
        image = Image.new("RGB", (1500, 1200), (35, 70, 95))
        ImageDraw.Draw(image).rectangle((0, 0, 749, 1199), fill=(100, 50, 20))
        exif = Image.Exif()
        exif[274] = 6
        image.save(self.root / "phone.jpg", exif=exif)
        self.job["blank"] = "phone.jpg"
        self.prepare()
        with Image.open(self.root / "phone.jpg") as source:
            expected = ImageOps.exif_transpose(source).convert("RGB")
        self.assertEqual(load_image(self.root / "phone.jpg").size, (1200, 1500))
        with contextlib.redirect_stdout(io.StringIO()):
            composite.run(self.path, self.root / "oriented")
        with Image.open(self.root / "oriented/full/photo.png") as final:
            self.assertEqual(final.getpixel((33, 33)), expected.getpixel((33, 33)))
            self.assertEqual(final.getpixel((33, 1400)), expected.getpixel((33, 1400)))
            self.assertNotIn(274, final.getexif())
        landmarks = self.root / "landmarks.json"
        landmarks.write_text(
            json.dumps({"frontCenterline": [[610, 20], [610, 1400]], "collarOuterBottom": [500, 20]}), encoding="utf-8"
        )
        info = guide.create(self.path, landmarks, self.root / "guide.png")
        self.assertEqual(info["photoOriginXY"], [0, 120])
        with Image.open(self.root / "guide.png") as diagnostic:
            self.assertEqual(diagnostic.size, (1200, 1620))
            self.assertEqual(diagnostic.getpixel((610, 150)), (0, 214, 240))
            self.assertEqual(diagnostic.getpixel((33, 153)), expected.getpixel((33, 33)))

    def test_adapter_changes_change_engine_provenance(self):
        before = composite.renderer_hashes()
        copied = self.root / "engine"
        copied.mkdir()
        for name in before:
            (copied / name).write_bytes(Path(composite.__file__).with_name(name).read_bytes())
        (copied / "composite.py").write_text("changed encoder settings", encoding="utf-8")
        with patch.object(composite, "__file__", str(copied / "composite.py")):
            after = composite.renderer_hashes()
        self.assertNotEqual(before["composite.py"], after["composite.py"])
        self.assertNotEqual(
            hashlib.sha256(json.dumps(before, sort_keys=True).encode()).hexdigest(),
            hashlib.sha256(json.dumps(after, sort_keys=True).encode()).hexdigest(),
        )

    def test_malformed_nested_json_reports_clean_cli_errors(self):
        for key, value in (("texturePatches", []), ("expectedSha256", []), ("foldGuides", [None]), ("surfaceBend", [])):
            with self.subTest(key=key):
                original = self.job.copy()
                self.job[key] = value
                self.path.write_text(json.dumps(self.job), encoding="utf-8")
                result = subprocess.run(
                    [
                        sys.executable,
                        str(Path(composite.__file__)),
                        "--job",
                        str(self.path),
                        "--output",
                        str(self.root / "bad"),
                    ],
                    capture_output=True,
                    text=True,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("must be an object", result.stderr)
                self.assertNotIn("Traceback", result.stderr)
                self.assertFalse((self.root / "bad").exists())
                self.job = original

    def test_invalid_crop(self):
        self.job["sourceCropBox"] = [-10, 0, 1200, 1500]
        with self.assertRaisesRegex(ValueError, "inside"):
            self.prepare()

    def test_nonfinite_geometry(self):
        self.job["quad"][0][0] = float("nan")
        with self.assertRaisesRegex(ValueError, "finite"):
            self.prepare()

    def test_distorting_aspect_ratio(self):
        self.job["sourceCropBox"] = [0, 0, 1200, 1200]
        with self.assertRaisesRegex(ValueError, "4:5"):
            self.prepare()

    def test_inverting_broad_bend(self):
        self.job["surfaceBend"] = {"verticalFraction": 0.2, "centerV": 0.5, "spreadV": 0.1}
        with self.assertRaisesRegex(ValueError, "invert"):
            self.prepare()

    def test_opaque_art(self):
        Image.new("RGBA", (30, 30), "white").save(self.root / "art.png")
        with self.assertRaisesRegex(ValueError, "transparency"):
            self.prepare()

    def test_wrong_mask_dimensions(self):
        Image.new("L", (50, 50), 255).save(self.root / "mask.png")
        with self.assertRaisesRegex(ValueError, "1200"):
            self.prepare()


if __name__ == "__main__":
    unittest.main()
