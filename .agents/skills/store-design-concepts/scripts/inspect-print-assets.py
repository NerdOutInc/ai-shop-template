#!/usr/bin/env python3
"""Read-only inspection of a concept gallery's original and PNG download files.

Requires Pillow. Does not generate, resize, clean, or otherwise edit images.
"""

import argparse
import hashlib
import io
import json
import math
import os
from pathlib import Path, PureWindowsPath
import re
import tempfile

from PIL import Image


def inspect_image(path, require_alpha=False):
    data = path.read_bytes()
    with Image.open(io.BytesIO(data)) as image:
        if image.format != "PNG" or getattr(image, "n_frames", 1) != 1:
            raise ValueError("Expected a single-frame PNG")
        image.load()
        rgba = image.convert("RGBA")
        alpha = rgba.getchannel("A")
        minimum, maximum = alpha.getextrema()
        if require_alpha and (minimum != 0 or maximum == 0):
            raise ValueError("Download needs transparent pixels and visible artwork")
        histogram = alpha.histogram()
        return {
            "width": image.width,
            "height": image.height,
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "rgbaSha256": hashlib.sha256(rgba.tobytes()).hexdigest(),
            "alphaRange": [minimum, maximum],
            "visibleBounds": alpha.getbbox(),
            "partialAlphaFraction": round(sum(histogram[1:255]) / (image.width * image.height), 6),
        }


def positive(value):
    try:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0
    except OverflowError:
        return False


def identity_string(value):
    return isinstance(value, str) and bool(value) and value == value.strip()


def absolute_path(path):
    return Path(os.path.abspath(path))


def contained(path, base):
    try:
        path.relative_to(base)
        return True
    except ValueError:
        return False


def asset_path(base, value):
    if (
        not isinstance(value, str)
        or not value
        or "\0" in value
        or re.match(r"^[a-z][a-z0-9+.-]*:", value, re.IGNORECASE)
        or Path(value).is_absolute()
        or PureWindowsPath(value).root
    ):
        raise ValueError("Expected a local path relative to the manifest")
    lexical = absolute_path(base / value)
    if not contained(lexical, base):
        raise ValueError("Asset path must stay within the manifest directory")
    path = lexical.resolve()
    if not contained(path, base):
        raise ValueError("Asset symlink must stay within the manifest directory")
    if not path.is_file():
        raise ValueError("Asset file is missing")
    return path


def input_paths(manifest_path, concepts):
    yield "manifest", manifest_path
    for index, concept in enumerate(concepts):
        if not isinstance(concept, dict):
            continue
        for field in ("original", "image", "printDownload"):
            value = concept.get(field)
            if isinstance(value, str) and value and "://" not in value and "\0" not in value:
                # Protect named inputs even if their paths will fail asset validation.
                yield f"concepts[{index}].{field}", absolute_path(manifest_path.parent / value)


def protect_output(output, manifest_path, concepts):
    resolved_output = output.resolve()
    for label, source in input_paths(manifest_path, concepts):
        if output == source or resolved_output == source.resolve():
            raise ValueError(f"Output must not overwrite {label}")
        try:
            if output.samefile(source):
                raise ValueError(f"Output must not overwrite {label} through a file alias")
        except FileNotFoundError:
            pass
    if not output.parent.is_dir():
        raise ValueError("Output directory does not exist")
    if output.exists() and not output.is_file():
        raise ValueError("Output must be a file")


def write_report(output, text):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=output.parent,
            prefix=f".{output.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            handle.write(text + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def inspect_concepts(concepts, base, report):
    errors, warnings, results = report["errors"], report["warnings"], report["concepts"]
    ids, prepared, gallery_files = set(), [], set()
    for index, concept in enumerate(concepts):
        concept_id = concept.get("id") if isinstance(concept, dict) else None
        context = {"index": index, "id": concept_id if isinstance(concept_id, str) else None}
        if not isinstance(concept, dict):
            errors.append({**context, "field": "concept", "error": "Concept must be an object"})
            continue
        start_errors = len(errors)
        if not identity_string(concept_id):
            errors.append(
                {**context, "field": "id", "error": "id must be a nonempty string without surrounding whitespace"}
            )
        elif concept_id in ids:
            errors.append({**context, "field": "id", "error": f"id duplicates {concept_id}"})
        else:
            ids.add(concept_id)
        assets = {}
        for field in ("original", "image", "printDownload"):
            try:
                path = asset_path(base, concept.get(field))
                stat = path.stat()
                assets[field] = (path, (stat.st_dev, stat.st_ino))
                if field == "image":
                    gallery_files.add(assets[field][1])
            except (ValueError, OSError, RuntimeError) as error:
                errors.append({**context, "field": field, "error": f"{field}: {error}"})
        if len(errors) == start_errors:
            prepared.append((concept, context, assets))

    paths, hashes = set(), {}
    for concept, context, assets in prepared:
        concept_id = concept["id"]
        _, print_identity = assets["printDownload"]
        if print_identity in gallery_files or print_identity in paths:
            errors.append(
                {
                    **context,
                    "field": "printDownload",
                    "error": "printDownload must be distinct from gallery images and other downloads",
                }
            )
            continue
        paths.add(print_identity)
        inspected = {}
        for field in ("original", "printDownload"):
            try:
                inspected[field] = inspect_image(assets[field][0], require_alpha=field == "printDownload")
            except (ValueError, OSError, TypeError, Image.DecompressionBombError) as error:
                errors.append({**context, "field": field, "error": f"{field}: {error}"})
        if len(inspected) != 2:
            continue
        original, download = inspected["original"], inspected["printDownload"]
        field = "printDimensions"
        try:
            dimensions = concept.get("printDimensions")
            if dimensions is not None and (
                not isinstance(dimensions, dict)
                or any(not positive(dimensions.get(key)) for key in ("width", "height"))
                or dimensions != {"width": download["width"], "height": download["height"]}
            ):
                raise ValueError("printDimensions must match the decoded PNG width and height")
            field = "printDownload"
            pixel_key = (download["width"], download["height"], download["rgbaSha256"])
            if pixel_key in hashes:
                raise ValueError(f"Download pixels duplicate concept {hashes[pixel_key]}")
            hashes[pixel_key] = concept_id
            row = {"id": concept_id, "original": original, "download": download, "resolutionStatus": "not-assessed"}
            enlarged = download["width"] > original["width"] or download["height"] > original["height"]
            row["enlarged"] = enlarged
            if enlarged and (not isinstance(concept.get("printNotes"), str) or not concept["printNotes"].strip()):
                errors.append({**context, "field": "printNotes", "error": "Enlarged downloads need visible printNotes"})
            size, target = concept.get("printSizeInches"), concept.get("targetPpi")
            if size is not None or target is not None:
                field = "printSizeInches/targetPpi"
                if (
                    not isinstance(size, dict)
                    or not all(positive(size.get(k)) for k in ("width", "height"))
                    or not positive(target)
                ):
                    raise ValueError("Print target needs positive canvas width/height in inches and targetPpi")
                source_ppi = min(original["width"] / size["width"], original["height"] / size["height"])
                final_ppi = min(download["width"] / size["width"], download["height"] / size["height"])
                if not math.isfinite(source_ppi) or not math.isfinite(final_ppi):
                    raise ValueError("Print canvas dimensions must yield finite PPI")
                row.update({"sourcePpi": round(source_ppi, 2), "downloadPpi": round(final_ppi, 2), "targetPpi": target})
                row["resolutionStatus"] = (
                    "download-below-target"
                    if final_ppi < target
                    else "enlarged-source-below-target"
                    if source_ppi < target
                    else "native-meets-target"
                )
                if row["resolutionStatus"] != "native-meets-target":
                    warnings.append({"id": concept_id, "warning": row["resolutionStatus"]})
            else:
                warnings.append({"id": concept_id, "warning": "Print size and resolution target not assessed"})
            results.append(row)
        except (ValueError, OSError, TypeError) as error:
            errors.append({**context, "field": field, "error": str(error)})


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--expected-count", required=True)
    parser.add_argument("--output", type=Path, help="Atomically save a completed inspection report")
    args = parser.parse_args(argv)
    report = {
        "collectionId": None,
        "expectedCount": None,
        "inspectionComplete": False,
        "inspected": 0,
        "errors": [],
        "warnings": [],
        "concepts": [],
        "scope": "File checks only; visual quality, exterior transparency, print suitability and approval require review.",
    }
    field = "expectedCount"
    try:
        try:
            expected_count = int(args.expected_count)
        except ValueError:
            raise ValueError("expected-count must be a positive integer") from None
        if expected_count < 1:
            raise ValueError("expected-count must be a positive integer")
        report["expectedCount"] = expected_count
        field = "manifest"
        manifest_path = absolute_path(args.manifest)
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            raise ValueError("Manifest root must be an object")
        field = "concepts"
        concepts = manifest.get("concepts")
        if not isinstance(concepts, list):
            raise ValueError("Manifest concepts must be a list")
        if len(concepts) != expected_count:
            raise ValueError(f"Requested count {expected_count} does not match manifest count {len(concepts)}")
        field = "storageKey"
        if not identity_string(manifest.get("storageKey")):
            raise ValueError("storageKey must be a nonempty string without surrounding whitespace")
        report["collectionId"] = manifest["storageKey"]
        field = "output"
        output = absolute_path(args.output) if args.output is not None else None
        if output is not None:
            protect_output(output, manifest_path, concepts)
    except (ValueError, OSError, UnicodeError, RuntimeError) as error:
        report["errors"].append({"field": field, "error": str(error)})
        print(json.dumps(report, indent=2))
        return 1

    inspect_concepts(concepts, manifest_path.parent.resolve(), report)
    report.update({"inspectionComplete": True, "inspected": len(report["concepts"])})
    if output is not None:
        try:
            protect_output(output, manifest_path, concepts)
            write_report(output, json.dumps(report, indent=2))
        except (ValueError, OSError, RuntimeError) as error:
            report["errors"].append({"field": "output", "error": str(error)})
    print(json.dumps(report, indent=2))
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
