"""Reject unresolved or stale photo reviews; this does not perform visual inspection."""

import argparse
import hashlib
import json
from pathlib import Path

from jobdata import list_value, object_value, read_object, resolve_file

CHECKS = ("centerline", "collarClearance", "scale", "occlusion")


def verify(review_path, require_independent=False):
    review = read_object(review_path)
    if review.get("schemaVersion") != 1 or review.get("status") != "approved":
        raise ValueError("Only schemaVersion 1 approved reviews can pass; uncertain is unresolved")
    if not isinstance(review.get("reviewer"), str) or not review["reviewer"].strip():
        raise ValueError("Record the actual reviewer")
    if require_independent and review.get("independent") is not True:
        raise ValueError("This workflow requires an independent reviewer")
    checks = object_value(review.get("checks"), "checks")
    for name in CHECKS:
        check = object_value(checks.get(name), f"checks.{name}")
        if check.get("verdict") != "pass" or not isinstance(check.get("reason"), str) or not check["reason"].strip():
            raise ValueError(f"Unresolved {name}: record a separate pass and evidence-based reason")
    evidence = list_value(review.get("evidence"), "evidence")
    if not evidence:
        raise ValueError("Keep the inspected blank/provider/annotated comparison evidence")
    files = list_value(review.get("finalFiles"), "finalFiles")
    if not files:
        raise ValueError("Record every final file being selected")
    receipt_entry = object_value(review.get("renderReceipt"), "renderReceipt")
    receipt_path = resolve_file(receipt_entry.get("path"), review_path, "renderReceipt")
    if not receipt_path.is_file() or hashlib.sha256(receipt_path.read_bytes()).hexdigest() != receipt_entry.get(
        "sha256"
    ):
        raise ValueError("Missing or changed render receipt")
    receipt = read_object(receipt_path)
    job_path = receipt_path.parent / "job.json"
    if not job_path.is_file() or hashlib.sha256(job_path.read_bytes()).hexdigest() != receipt.get("portableJobSha256"):
        raise ValueError("Missing or changed rendered job")
    job = read_object(job_path)
    inputs = {key: job.get(key) for key in ("artwork", "blank")}
    inputs.update(object_value(job.get("texturePatches"), "texturePatches"))
    if job.get("visibilityMask"):
        inputs["visibilityMask"] = job["visibilityMask"]
    input_hashes = object_value(receipt.get("inputSha256"), "inputSha256")
    if set(inputs) != set(input_hashes):
        raise ValueError("Rendered input manifest differs")
    for key, value in inputs.items():
        path = resolve_file(value, job_path, key)
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != receipt["inputSha256"][key]:
            raise ValueError(f"Rendered input changed: {key}")
    output_hashes = object_value(receipt.get("outputSha256"), "outputSha256")
    if not all(isinstance(value, str) for value in output_hashes.values()):
        raise ValueError("outputSha256 values must be strings")
    rendered_hashes = set(output_hashes.values())
    for item in files + evidence:
        object_value(item, "reviewed file")
    if any(item.get("sha256") not in rendered_hashes for item in files):
        raise ValueError("A selected final was not rendered by the reviewed job")
    seen = set()
    for item in files + evidence:
        path = resolve_file(item.get("path"), review_path, "reviewed file")
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
