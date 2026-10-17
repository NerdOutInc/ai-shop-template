"""Draw a diagnostic grid on a blank; never use this guide as the delivered photo."""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

from imaging import load_image, srgb_profile_bytes
from jobdata import finite_numbers, list_value, read_object, resolve_file


def create(job_path, landmarks_path, output):
    if output.exists():
        raise ValueError("Choose a new output file")
    job = read_object(job_path)
    landmarks = read_object(landmarks_path)
    source = resolve_file(job.get("blank"), job_path, "blank")
    crop = finite_numbers(job.get("sourceCropBox"), 4, "sourceCropBox")
    with load_image(source) as blank:
        if not (0 <= crop[0] < crop[2] <= blank.width and 0 <= crop[1] < crop[3] <= blank.height):
            raise ValueError("Crop must stay inside the blank")
        if abs(((crop[2] - crop[0]) / (crop[3] - crop[1])) / 0.8 - 1) > 0.005:
            raise ValueError("Choose a 4:5 crop to avoid distorting the garment")
        canvas = blank.convert("RGB").crop(crop).resize((1200, 1500), Image.Resampling.LANCZOS)
    quad = job.get("quad")
    if not isinstance(quad, list) or len(quad) != 4:
        raise ValueError("quad requires TL/TR/BR/BL corners in final output coordinates")
    for point in quad:
        finite_numbers(point, 2, "quad corner")
    axis = list_value(landmarks.get("frontCenterline", []), "frontCenterline")
    if len(axis) < 2:
        raise ValueError("Trace at least two frontCenterline points on the blank")
    for point in axis:
        finite_numbers(point, 2, "frontCenterline point")
    collar = finite_numbers(landmarks.get("collarOuterBottom"), 2, "collarOuterBottom")
    draw = ImageDraw.Draw(canvas)
    for x in range(0, 1200, 100):
        draw.line([(x, 0), (x, 1500)], fill="#747474", width=1)
    for y in range(0, 1500, 100):
        draw.line([(0, y), (1200, y)], fill="#747474", width=1)
    draw.line([(600, 0), (600, 1500)], fill="#ffffff", width=2)
    draw.line([tuple(p) for p in axis], fill="#00d6f0", width=5)
    draw.line([tuple(p) for p in quad + [quad[0]]], fill="#ffc247", width=4)
    top_mid = ((quad[0][0] + quad[1][0]) / 2, (quad[0][1] + quad[1][1]) / 2)
    draw.line([tuple(collar), top_mid], fill="#ff69c4", width=4)
    for label, point in zip(("TL", "TR", "BR", "BL"), quad):
        x, y = point
        draw.ellipse((x - 6, y - 6, x + 6, y + 6), fill="#ffc247")
        draw.text((x + 9, y + 9), label, fill="#ffc247", font_size=22)
    annotated = Image.new("RGB", (1200, 1620), "#202b30")
    annotated.paste(canvas, (0, 120))
    draw = ImageDraw.Draw(annotated)
    draw.text((20, 14), "DIAGNOSTIC ONLY | output coordinates 1200 x 1500", fill="white", font_size=25)
    draw.text(
        (20, 53),
        "Cyan: traced garment axis | Gold: full art canvas | Pink: collar-to-canvas",
        fill="white",
        font_size=22,
    )
    draw.text(
        (20, 85), "White: image center (not garment center) | Grid: 100 px (not inches)", fill="white", font_size=22
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    annotated.save(output, icc_profile=srgb_profile_bytes())
    return {"output": str(output), "status": "diagnostic-only", "photoOriginXY": [0, 120]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job", type=Path, required=True)
    parser.add_argument("--landmarks", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(create(args.job.resolve(), args.landmarks.resolve(), args.output.resolve())))
    except (ValueError, KeyError, OSError, TypeError) as error:
        parser.exit(1, f"{error}\n")
