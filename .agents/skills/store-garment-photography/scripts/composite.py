"""Composite approved original artwork onto a reviewed blank, without regenerating it."""

import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import sys

import numpy as np
from PIL import Image, __version__ as pillow_version

import compositor


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def finite_numbers(values, length, name):
    if not isinstance(values, list) or len(values) != length:
        raise ValueError(f"{name} must contain {length} numbers")
    if not all(isinstance(x, (float, int)) and not isinstance(x, bool) and math.isfinite(x) for x in values):
        raise ValueError(f"{name} must contain finite numbers")
    return values


def resolve_file(value, job_path, name):
    if not isinstance(value, str) or not value:
        raise ValueError(f"Missing input path: {name}")
    path = (job_path.parent / value).resolve()
    if not path.is_file():
        raise ValueError(f"Missing input file: {name}")
    return path


def prepare(job_path):
    job = json.loads(job_path.read_text())
    if not isinstance(job, dict) or job.get("schemaVersion") != 1:
        raise ValueError("Expected job schemaVersion 1")
    files = {k: resolve_file(job.get(k), job_path, k) for k in ("artwork", "blank")}
    for k in ("cream", "red"):
        files[k] = resolve_file(job.get("texturePatches", {}).get(k), job_path, f"texturePatches.{k}")
    if job.get("visibilityMask"):
        files["visibilityMask"] = resolve_file(job["visibilityMask"], job_path, "visibilityMask")
    hashes = {k: digest(p) for k, p in files.items()}
    for k, expected in job.get("expectedSha256", {}).items():
        if hashes.get(k) != expected:
            raise ValueError(f"Input checksum mismatch: {k}")
    with Image.open(files["artwork"]) as art:
        if art.mode != "RGBA" or art.getchannel("A").getextrema()[0] == 255:
            raise ValueError("Artwork must be the original RGBA PNG with genuine transparency")
        if art.format != "PNG" or art.getchannel("A").getbbox() is None:
            raise ValueError("Artwork must be a nonempty transparent PNG")
    for k in ("blank", "cream", "red"):
        with Image.open(files[k]) as image:
            image.verify()
    if "visibilityMask" in files:
        with Image.open(files["visibilityMask"]) as mask:
            if mask.mode != "L" or mask.size != (1200, 1500):
                raise ValueError("Visibility mask must be grayscale L, 1200 by 1500 output pixels")
    crop = finite_numbers(job.get("sourceCropBox"), 4, "sourceCropBox")
    with Image.open(files["blank"]) as blank:
        if not (0 <= crop[0] < crop[2] <= blank.width and 0 <= crop[1] < crop[3] <= blank.height):
            raise ValueError("Crop must have positive extent and stay inside the original blank")
    if abs(((crop[2] - crop[0]) / (crop[3] - crop[1])) / 0.8 - 1) > 0.005:
        raise ValueError("Choose a 4:5 crop; stretching a different aspect distorts the person and garment")
    quad = job.get("quad")
    if not isinstance(quad, list) or len(quad) != 4:
        raise ValueError("quad must have four TL, TR, BR, BL corners in output pixels")
    for p in quad:
        finite_numbers(p, 2, "quad corner")
    crosses = []
    for i in range(4):
        a, b, c = quad[i], quad[(i + 1) % 4], quad[(i + 2) % 4]
        crosses.append((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]))
    if not all(c > 1 for c in crosses):
        raise ValueError("quad must be convex, ordered TL/TR/BR/BL, and nondegenerate")
    inches = finite_numbers(job.get("targetArtworkInches"), 2, "targetArtworkInches")
    if not all(x > 0 for x in inches):
        raise ValueError("Target inch estimates must be positive")
    view = job.get("view", "lifestyle")
    if view not in ("studio", "lifestyle", "clean"):
        raise ValueError("view must be studio, lifestyle or clean")
    for guide in job.get("foldGuides", []):
        points = guide.get("points", [])
        if len(points) < 2:
            raise ValueError("Each fold guide needs at least two output-space points")
        for point in points:
            finite_numbers(point, 2, "fold point")
        if any(a == b for a, b in zip(points, points[1:])):
            raise ValueError("Fold guide segments must have nonzero length")
        finite_numbers([guide.get(k) for k in ("width", "amplitude", "weight")], 3, "fold guide values")
        if guide["width"] <= 0 or guide.get("kind") not in ("compress", "hinge", "ridge"):
            raise ValueError("Fold guide needs positive width and kind compress, hinge or ridge")
    if job.get("surfaceBend"):
        surface = job["surfaceBend"]
        finite_numbers([surface.get(k) for k in ("verticalFraction", "centerV", "spreadV")], 3, "surface bend")
        if surface["spreadV"] <= 0:
            raise ValueError("surfaceBend.spreadV must be positive")
        if 1 - abs(surface["verticalFraction"] / surface["spreadV"]) * math.sqrt(2 / math.e) <= 0.2:
            raise ValueError("surfaceBend can invert or excessively compress the projection")
    return job, files, hashes


def run(job_path, output):
    job_path = job_path.resolve()
    job, files, hashes = prepare(job_path)
    if output.exists():
        raise ValueError("Output directory already exists; choose a new directory to preserve prior work")
    output.mkdir(parents=True)
    for folder in ("full", "sources/real-samples", "inputs"):
        (output / folder).mkdir(parents=True, exist_ok=True)
    destinations = {
        "artwork": "sources/approved-artwork.png",
        "blank": "inputs/blank" + files["blank"].suffix,
        "cream": "sources/real-samples/cream-ink-b-patch.png",
        "red": "sources/real-samples/red-ink-patch.png",
        "visibilityMask": "inputs/visibility.png",
    }
    for k, source in files.items():
        shutil.copy2(source, output / destinations[k])
    local_job = dict(job)
    local_job.update(
        artwork=destinations["artwork"],
        blank=destinations["blank"],
        texturePatches={k: destinations[k] for k in ("cream", "red")},
    )
    if "visibilityMask" in files:
        local_job["visibilityMask"] = destinations["visibilityMask"]
    (output / "job.json").write_text(json.dumps(local_job, indent=2) + "\n")
    record = {
        "id": "photo",
        "design": "artwork",
        "view": job.get("view", "lifestyle"),
        "source": destinations["blank"],
        "sourceCropBox": job["sourceCropBox"],
        "outputQuadTL_TR_BR_BL": job["quad"],
        "targetArtworkInches": job["targetArtworkInches"],
        "foldGuides": job.get("foldGuides", []),
        "surfaceBend": job.get("surfaceBend"),
    }
    if "visibilityMask" in files:
        record["visibilityMask"] = destinations["visibilityMask"]
    compositor.ROOT = output
    compositor.PARENT = output
    compositor.STUDY = output / "sources"
    result, treatment = compositor.render(record)
    result.save(output / "full/photo.jpg", quality=95, subsampling=0)
    receipt = {
        "schemaVersion": 1,
        "status": "rendered-awaiting-independent-visual-review",
        "jobSha256": digest(job_path),
        "portableJobSha256": digest(output / "job.json"),
        "inputSha256": hashes,
        "outputSha256": {k: digest(output / f"full/photo.{k}") for k in ("png", "jpg")},
        "engineSha256": digest(Path(compositor.__file__)),
        "pythonVersion": sys.version.split()[0],
        "pillowVersion": pillow_version,
        "numpyVersion": np.__version__,
        "outputDimensions": [1200, 1500],
        "record": record,
        "treatment": treatment,
        "limitations": "2D projection and sample-calibrated ink texture; not physical fit certification. Rendering does not approve publication.",
    }
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({"output": str(output), "status": receipt["status"], "outputSha256": receipt["outputSha256"]}))
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        run(args.job, args.output.resolve())
    except (ValueError, KeyError, OSError, json.JSONDecodeError) as error:
        parser.exit(1, f"{error}\n")
