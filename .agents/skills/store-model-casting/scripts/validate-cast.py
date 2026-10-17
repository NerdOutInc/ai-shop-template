"""Check a portable cast manifest and its original anchors without image libraries."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import struct

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def required_text(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be nonempty text")
    return value


def validate(manifest_path, asset_root=None):
    manifest_path = Path(manifest_path).resolve()
    root = Path(asset_root).resolve() if asset_root is not None else manifest_path.parent
    if not root.is_dir():
        raise ValueError("Asset root must be an existing directory")
    manifest = json.loads(manifest_path.read_text())
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != 1:
        raise ValueError("Expected cast manifest schemaVersion 1")
    models = manifest.get("models")
    if not isinstance(models, list) or not models:
        raise ValueError("models must be a nonempty list")
    seen = set()
    results = []
    for model in models:
        if not isinstance(model, dict):
            raise ValueError("Each model must be an object")
        identity = required_text(model.get("id"), "id")
        if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", identity) is None:
            raise ValueError(
                "IDs must be 1-64 letters, digits, hyphens or underscores, starting with a letter or digit"
            )
        if identity in seen:
            raise ValueError(f"Duplicate model ID: {identity}")
        seen.add(identity)
        relative = Path(required_text(model.get("referenceImage"), f"{identity}.referenceImage"))
        if relative.is_absolute():
            raise ValueError(f"{identity}: referenceImage must be relative to the asset root")
        anchor = (root / relative).resolve()
        try:
            anchor.relative_to(root)
        except ValueError as error:
            raise ValueError(f"{identity}: referenceImage escapes the asset root") from error
        if not anchor.is_file():
            raise ValueError(f"{identity}: missing original anchor")
        expected_hash = model.get("sha256")
        if not isinstance(expected_hash, str) or re.fullmatch(r"[0-9a-f]{64}", expected_hash) is None:
            raise ValueError(f"{identity}: sha256 must be the original file's lowercase SHA-256")
        content = anchor.read_bytes()
        if not content:
            raise ValueError(f"{identity}: original anchor is empty")
        if hashlib.sha256(content).hexdigest() != expected_hash:
            raise ValueError(f"{identity}: original anchor checksum mismatch")
        dimensions = model.get("dimensions")
        if (
            not isinstance(dimensions, list)
            or len(dimensions) != 2
            or not all(isinstance(n, int) and not isinstance(n, bool) and n > 0 for n in dimensions)
        ):
            raise ValueError(f"{identity}: dimensions must be positive integer width and height")
        dimension_check = "not-checked-non-png"
        if content.startswith(PNG_SIGNATURE):
            if len(content) < 33 or content[8:16] != b"\x00\x00\x00\rIHDR":
                raise ValueError(f"{identity}: invalid PNG header")
            if list(struct.unpack(">II", content[16:24])) != dimensions:
                raise ValueError(f"{identity}: PNG dimensions differ from the recorded original")
            dimension_check = "png-header-matches"
        elif anchor.suffix.lower() == ".png":
            raise ValueError(f"{identity}: .png anchor has no PNG signature")
        required_text(model.get("originalPrompt"), f"{identity}.originalPrompt")
        metadata = model.get("toolMetadata")
        if not isinstance(metadata, dict):
            raise ValueError(f"{identity}: toolMetadata must record the tool or explicitly say unknown")
        required_text(metadata.get("tool"), f"{identity}.toolMetadata.tool")
        if "seed" not in metadata:
            raise ValueError(f"{identity}: toolMetadata.seed must be recorded or null when unknown")
        if metadata["seed"] is not None and (
            isinstance(metadata["seed"], bool) or not isinstance(metadata["seed"], (str, int))
        ):
            raise ValueError(f"{identity}: toolMetadata.seed must be a string, integer or null")
        required_text(model.get("observedTraits"), f"{identity}.observedTraits")
        unknowns = model.get("unknowns")
        if not isinstance(unknowns, list) or not all(isinstance(item, str) and item.strip() for item in unknowns):
            raise ValueError(f"{identity}: unknowns must be a list of nonempty descriptions (empty is allowed)")
        review = model.get("review")
        if not isinstance(review, dict):
            raise ValueError(f"{identity}: review must record the actual state")
        required_text(review.get("status"), f"{identity}.review.status")
        required_text(review.get("note"), f"{identity}.review.note")
        results.append({"id": identity, "sha256": expected_hash, "dimensionCheck": dimension_check})
    return {
        "schemaVersion": 1,
        "status": "manifest-and-anchor-bytes-verified",
        "models": results,
        "limitations": [
            "PNG dimensions are checked from headers; this is not a complete image decode.",
            "Other image formats require visual inspection and a separate decoded-dimension check.",
            "Traits, distinctness, likeness and approval claims require actual visual/user review.",
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--asset-root", type=Path, help="Explicit asset root; defaults to the manifest's directory")
    args = parser.parse_args()
    try:
        print(json.dumps(validate(args.manifest, args.asset_root), indent=2))
    except (ValueError, OSError) as error:
        parser.exit(1, f"{error}\n")
