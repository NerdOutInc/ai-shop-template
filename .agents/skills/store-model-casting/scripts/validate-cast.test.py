"""Meaningful failure cases for portable identity-anchor validation."""

import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zlib

SPEC = importlib.util.spec_from_file_location("validate_cast", Path(__file__).with_name("validate-cast.py"))
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def png():
    header = struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(b"\x00\x20\x30\x40\x20\x30\x40" * 2))
        + chunk(b"IEND", b"")
    )


class CastValidation(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.anchor = self.root / "anchor.png"
        self.anchor.write_bytes(png())
        self.manifest = self.root / "cast.json"
        self.model = {
            "id": "person-7",
            "referenceImage": "anchor.png",
            "sha256": hashlib.sha256(self.anchor.read_bytes()).hexdigest(),
            "dimensions": [2, 2],
            "originalPrompt": "Synthetic validation fixture; not a generated model.",
            "toolMetadata": {"tool": "unknown", "seed": None},
            "observedTraits": "Synthetic fixture; no traits claimed.",
            "unknowns": ["All human traits are outside this fixture."],
            "review": {"status": "fixture", "note": "Not a casting selection."},
        }

    def write_manifest(self, models=None):
        self.manifest.write_text(json.dumps({"schemaVersion": 1, "models": models or [self.model]}), encoding="utf-8")

    def test_arbitrary_roster_and_explicit_unknown_metadata(self):
        self.write_manifest()
        result = VALIDATOR.validate(self.manifest)
        self.assertEqual(len(result["models"]), 1)
        self.assertEqual(result["models"][0]["dimensionCheck"], "png-header-matches")

    def test_utf8_prompt(self):
        self.model["originalPrompt"] = "An ordinary afternoon — ‘énergie’ on a sign."
        self.manifest.write_text(
            json.dumps({"schemaVersion": 1, "models": [self.model]}, ensure_ascii=False), encoding="utf-8"
        )
        self.assertEqual(len(VALIDATOR.validate(self.manifest)["models"]), 1)

    def test_missing_anchor(self):
        self.write_manifest()
        self.anchor.unlink()
        with self.assertRaisesRegex(ValueError, "missing original anchor"):
            VALIDATOR.validate(self.manifest)

    def test_altered_anchor(self):
        self.write_manifest()
        self.anchor.write_bytes(self.anchor.read_bytes() + b"changed")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            VALIDATOR.validate(self.manifest)

    def test_duplicate_ids(self):
        self.write_manifest([self.model, dict(self.model)])
        with self.assertRaisesRegex(ValueError, "Duplicate model ID"):
            VALIDATOR.validate(self.manifest)

    def test_dimension_mismatch(self):
        self.model["dimensions"] = [3, 2]
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "PNG dimensions differ"):
            VALIDATOR.validate(self.manifest)

    def test_path_escape(self):
        self.model["referenceImage"] = "../outside.png"
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "escapes the asset root"):
            VALIDATOR.validate(self.manifest)

    def test_explicit_asset_root(self):
        metadata = self.root / "metadata"
        metadata.mkdir()
        self.manifest = metadata / "cast.json"
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "missing original anchor"):
            VALIDATOR.validate(self.manifest)
        self.assertEqual(len(VALIDATOR.validate(self.manifest, self.root)["models"]), 1)

    def test_missing_metadata_does_not_become_invented_provenance(self):
        del self.model["toolMetadata"]
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "toolMetadata"):
            VALIDATOR.validate(self.manifest)


if __name__ == "__main__":
    unittest.main()
