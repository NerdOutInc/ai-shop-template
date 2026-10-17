"""Check original/masked pixels and unsafe inputs without any brand photographs."""

import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageDraw

import composite


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
        self.path.write_text(json.dumps(self.job))
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
        self.assertEqual(receipt["treatment"]["addedArtworkBlurPixels"], 0)
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
