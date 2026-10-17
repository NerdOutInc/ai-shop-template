"""Consequential review-gate checks, using temporary files and no private assets."""

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys

spec = importlib.util.spec_from_file_location("review_gate", Path(__file__).with_name("verify-review.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class ReviewGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / "review.json"
        for name in ("final.png", "comparison.jpg"):
            (self.root / name).write_bytes(name.encode())

        def entry(name):
            return {"path": name, "sha256": hashlib.sha256((self.root / name).read_bytes()).hexdigest()}

        for name in ("art.png", "blank.png", "texture.png"):
            (self.root / name).write_bytes(name.encode())
        job = {
            "artwork": "art.png",
            "blank": "blank.png",
            "texturePatches": {"cream": "texture.png", "red": "texture.png"},
        }
        (self.root / "job.json").write_text(json.dumps(job), encoding="utf-8")
        receipt = {
            "portableJobSha256": entry("job.json")["sha256"],
            "inputSha256": {
                "artwork": entry("art.png")["sha256"],
                "blank": entry("blank.png")["sha256"],
                "cream": entry("texture.png")["sha256"],
                "red": entry("texture.png")["sha256"],
            },
            "outputSha256": {"png": entry("final.png")["sha256"]},
        }
        (self.root / "receipt.json").write_text(json.dumps(receipt), encoding="utf-8")
        self.review = {
            "schemaVersion": 1,
            "status": "approved",
            "reviewer": "Independent human or agent",
            "independent": True,
            "renderReceipt": entry("receipt.json"),
            "checks": {name: {"verdict": "pass", "reason": "Inspected evidence"} for name in gate.CHECKS},
            "finalFiles": [entry("final.png")],
            "evidence": [entry("comparison.jpg")],
        }

    def run_gate(self):
        self.path.write_text(json.dumps(self.review), encoding="utf-8")
        return gate.verify(self.path, True)

    def test_current_record(self):
        self.assertEqual(self.run_gate()["status"], "review-record-current")

    def test_malformed_nested_records_report_errors_without_tracebacks(self):
        for key, value in (
            ("checks", []),
            ("checks", {"centerline": "pass"}),
            ("renderReceipt", []),
            ("finalFiles", "photo.png"),
            ("evidence", [None]),
        ):
            with self.subTest(key=key, value=value):
                original = self.review.copy()
                self.review[key] = value
                self.path.write_text(json.dumps(self.review), encoding="utf-8")
                result = subprocess.run(
                    [sys.executable, str(Path(gate.__file__)), str(self.path)], capture_output=True, text=True
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("Traceback", result.stderr)
                self.review = original

    def test_utf8_review_text(self):
        self.review["reviewer"] = "Zoë — independent reviewer"
        self.path.write_text(json.dumps(self.review, ensure_ascii=False), encoding="utf-8")
        self.assertEqual(gate.verify(self.path)["reviewer"], self.review["reviewer"])

    def test_each_uncertain_check_blocks(self):
        for name in gate.CHECKS:
            with self.subTest(name=name):
                self.review["checks"][name]["verdict"] = "uncertain"
                with self.assertRaises(ValueError):
                    self.run_gate()
                self.review["checks"][name]["verdict"] = "pass"

    def test_null_claims_block(self):
        self.review["reviewer"] = None
        with self.assertRaises(ValueError):
            self.run_gate()
        self.review["reviewer"] = "Actual reviewer"
        self.review["checks"]["scale"]["reason"] = None
        with self.assertRaises(ValueError):
            self.run_gate()

    def test_changed_provenance_blocks(self):
        for name in ("receipt.json", "job.json", "art.png", "blank.png", "texture.png"):
            with self.subTest(name=name):
                original = (self.root / name).read_bytes()
                (self.root / name).write_bytes(b"changed")
                with self.assertRaises(ValueError):
                    self.run_gate()
                (self.root / name).write_bytes(original)

    def test_unrendered_selection_blocks(self):
        (self.root / "unrendered.png").write_bytes(b"another photograph")
        self.review["finalFiles"] = [
            {"path": "unrendered.png", "sha256": hashlib.sha256(b"another photograph").hexdigest()}
        ]
        with self.assertRaises(ValueError):
            self.run_gate()

    def test_modified_final_blocks(self):
        (self.root / "final.png").write_bytes(b"edited")
        with self.assertRaises(ValueError):
            self.run_gate()

    def test_missing_evidence_blocks(self):
        (self.root / "comparison.jpg").unlink()
        with self.assertRaises(ValueError):
            self.run_gate()

    def test_independence_is_required_when_requested(self):
        self.review["independent"] = False
        with self.assertRaises(ValueError):
            self.run_gate()


if __name__ == "__main__":
    unittest.main()
