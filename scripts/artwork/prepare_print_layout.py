"""Crop transparent margins and calculate a repeatable full-front print layout."""

import argparse
import json
from pathlib import Path

from PIL import Image


def prepare(source: Path, output: Path, target_width: float, max_height: float):
    image = Image.open(source).convert('RGBA')
    alpha = image.getchannel('A')
    if alpha.getextrema()[0] == 255:
        raise ValueError('The input is opaque. Remove its background before placement.')
    bounds = alpha.getbbox()
    if bounds is None:
        raise ValueError('The input has no visible artwork.')
    cropped = image.crop(bounds)
    aspect = cropped.height / cropped.width
    width = min(target_width, max_height / aspect)
    height = width * aspect
    output.parent.mkdir(parents=True, exist_ok=True)
    cropped.save(output, dpi=(300, 300), optimize=True)
    layout = {
        'source': str(source),
        'print_file': str(output),
        'source_pixels': list(image.size),
        'ink_bounds_pixels': list(bounds),
        'print_file_pixels': list(cropped.size),
        'visible_width_inches': round(width, 2),
        'visible_height_inches': round(height, 2),
        'file_pixels_per_inch': round(cropped.width / width, 1),
        'horizontal_alignment': 'center',
        'vertical_alignment_start': 'top of provider print area',
        'collar_check': 'Aim for topmost ink approximately 3–4 inches below the front collar seam; verify mockups.',
        'quality_note': 'File pixel density does not prove source detail; inspect any upscaled original.',
    }
    output.with_suffix('.layout.json').write_text(json.dumps(layout, indent=2) + '\n')
    return layout


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--width', type=float, default=7.59,
                        help='Target visible width in inches (default: 7.59 for dense, near-square graphics).')
    parser.add_argument('--max-height', type=float, default=12.0)
    args = parser.parse_args()
    if args.width <= 0 or args.max_height <= 0:
        parser.error('Width and maximum height must be positive.')
    print(json.dumps(prepare(args.source, args.output, args.width, args.max_height), indent=2))
