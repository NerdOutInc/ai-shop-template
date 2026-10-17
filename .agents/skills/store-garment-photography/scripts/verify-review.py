"""Reject unresolved or stale photo reviews; this does not perform visual inspection."""

import argparse
import hashlib
import json
from pathlib import Path


CHECKS = ("centerline", "collarClearance", "scale", "occlusion")


def verify(review_path, require_independent=False):
    review = json.loads(review_path.read_text())
    if review.get("schemaVersion") != 1 or review.get("status") != "approved":
        raise ValueError("Only schemaVersion 1 approved reviews can pass; uncertain is unresolved")
    if not isinstance(review.get("reviewer"), str) or not review["reviewer"].strip():
        raise ValueError("Record the actual reviewer")
    if require_independent and review.get("independent") is not True:
        raise ValueError("This workflow requires an independent reviewer")
    for name in CHECKS:
        check = review.get("checks", {}).get(name, {})
        if check.get("verdict") != "pass" or not isinstance(check.get("reason"), str) or not check["reason"].strip():
            raise ValueError(f"Unresolved {name}: record a separate pass and evidence-based reason")
    if not review.get("evidence"):
        raise ValueError("Keep the inspected blank/provider/annotated comparison evidence")
    files = review.get("finalFiles", [])
    if not files:
        raise ValueError("Record every final file being selected")
    receipt_entry = review.get("renderReceipt", {})
    receipt_path = (review_path.parent / receipt_entry.get("path", "")).resolve()
    if not receipt_path.is_file() or hashlib.sha256(receipt_path.read_bytes()).hexdigest() != receipt_entry.get(
        "sha256"
    ):
        raise ValueError("Missing or changed render receipt")
    receipt = json.loads(receipt_path.read_text())
    job_path = receipt_path.parent / "job.json"
    if not job_path.is_file() or hashlib.sha256(job_path.read_bytes()).hexdigest() != receipt.get("portableJobSha256"):
        raise ValueError("Missing or changed rendered job")
    job = json.loads(job_path.read_text())
    inputs = {key: job.get(key) for key in ("artwork", "blank")}
    inputs.update(job.get("texturePatches", {}))
    if job.get("visibilityMask"):
        inputs["visibilityMask"] = job["visibilityMask"]
    if set(inputs) != set(receipt.get("inputSha256", {})):
        raise ValueError("Rendered input manifest differs")
    for key, value in inputs.items():
        path = (job_path.parent / value).resolve()
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != receipt["inputSha256"][key]:
            raise ValueError(f"Rendered input changed: {key}")
    rendered_hashes = set(receipt.get("outputSha256", {}).values())
    if any(item.get("sha256") not in rendered_hashes for item in files):
        raise ValueError("A selected final was not rendered by the reviewed job")
    seen = set()
    for item in files + review["evidence"]:
        path = (review_path.parent / item["path"]).resolve()
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != item.get("sha256"):
            raise ValueError(f"Missing or changed reviewed file: {item['path']}")
        if path in seen:
            raise ValueError(f"Duplicate review evidence or final: {item['path']}")
        seen.add(path)
    return {"status": "review-record-current", "finalFiles": len(files), "reviewer": review["reviewer"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("review", type=Path)
    parser.add_argument("--require-independent", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.review.resolve(), args.require_independent)))
    except (ValueError, KeyError, OSError, TypeError) as error:
        parser.exit(1, f"{error}\n")
