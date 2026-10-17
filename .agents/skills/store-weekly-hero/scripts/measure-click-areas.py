#!/usr/bin/env python3
"""Convert measured source-pixel rectangles to percentages; never approves an image."""

import argparse
import json
import math
from pathlib import Path


def finite_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def positive(value, name):
    if not finite_number(value) or value <= 0:
        raise ValueError(f"{name} must be a finite positive number")
    return value


def rectangle(value, name, canvas):
    if not isinstance(value, list) or len(value) != 4:
        raise ValueError(f"{name} must be [left, top, width, height] in source pixels")
    x, y, width, height = value
    for offset in (x, y):
        if not finite_number(offset) or offset < 0:
            raise ValueError(f"{name} offsets must be finite nonnegative numbers")
    positive(width, f"{name}.width")
    positive(height, f"{name}.height")
    if x + width > canvas[0] or y + height > canvas[1]:
        raise ValueError(f"{name} extends outside its source canvas")
    return value


def contains(outer, inner):
    return (
        inner[0] >= outer[0]
        and inner[1] >= outer[1]
        and inner[0] + inner[2] <= outer[0] + outer[2]
        and inner[1] + inner[3] <= outer[1] + outer[3]
    )


def overlaps(first, second):
    return (
        first[0] < second[0] + second[2]
        and second[0] < first[0] + first[2]
        and first[1] < second[1] + second[3]
        and second[1] < first[1] + first[3]
    )


def measure(plan):
    if not isinstance(plan, dict) or set(plan) != {"desktop", "mobile"}:
        raise ValueError("Supply exactly desktop and mobile layout objects")
    output = {}
    identities = None
    for view, layout in plan.items():
        if not isinstance(layout, dict):
            raise ValueError(f"{view} must be a layout object")
        if set(layout) - {"canvas", "safeArea", "regions"}:
            raise ValueError(f"{view} only accepts canvas, safeArea and regions")
        canvas = layout.get("canvas")
        if not isinstance(canvas, list) or len(canvas) != 2:
            raise ValueError(f"{view}.canvas must be [width, height]")
        width, height = (positive(value, f"{view}.canvas") for value in canvas)
        safe = rectangle(layout.get("safeArea", [0, 0, width, height]), f"{view}.safeArea", canvas)
        regions = layout.get("regions")
        if not isinstance(regions, dict) or not regions:
            raise ValueError(f"{view}.regions must contain labeled pixel rectangles")
        if not all(isinstance(key, str) and key.strip() for key in regions):
            raise ValueError("Region labels must be nonempty strings")
        if identities is not None and set(regions) != identities:
            raise ValueError("Desktop and mobile must have the same destination labels")
        identities = set(regions)
        measured = {}
        accepted = []
        for label, value in regions.items():
            rect = rectangle(value, f"{view}.{label}", canvas)
            if not contains(safe, rect):
                raise ValueError(f"{view}.{label} extends outside the configured safe area")
            if any(overlaps(rect, previous) for previous in accepted):
                raise ValueError(f"{view}.{label} overlaps another link region")
            accepted.append(rect)
            measured[label] = {
                "left": rect[0] / width * 100,
                "top": rect[1] / height * 100,
                "width": rect[2] / width * 100,
                "height": rect[3] / height * 100,
            }
        output[view] = measured
    return {"status": "arithmetic-only-not-visual-approval", "percentages": output}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key!r}")
        result[key] = value
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("layout", type=Path, help="JSON with desktop/mobile source pixel geometry")
    args = parser.parse_args()
    try:
        result = measure(json.loads(args.layout.read_text(encoding="utf-8"), object_pairs_hook=unique_object))
    except (ValueError, TypeError, AttributeError, OSError) as error:
        parser.exit(1, f"Layout rejected: {error}\n")
    print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
