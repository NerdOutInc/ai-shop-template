"""Reference DTG compositor arithmetic.

Called by composite.py with explicit isolated project inputs. The reference tuning
was selected from one physical-sample experiment; it is not a universal textile model.
"""

from pathlib import Path
import json
import hashlib
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path.cwd()
PARENT = ROOT
STUDY = ROOT / "sources"
ART = None
OUT = (1200, 1500)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def inverse_perspective(quad):
    rows, targets = [], []
    for (x, y), (u, v) in zip(quad, [(0, 0), (ART.width, 0), (ART.width, ART.height), (0, ART.height)]):
        rows.extend([[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]])
        targets.extend([u, v])
    return np.linalg.solve(np.asarray(rows), np.asarray(targets)).tolist()


def smooth(field, radius):
    if float(field.max() - field.min()) < 1e-6:
        return field.copy()
    pad = max(4, int(radius * 4))
    padded = np.pad(field, pad, mode="reflect")
    fy = np.fft.fftfreq(padded.shape[0])[:, None]
    fx = np.fft.rfftfreq(padded.shape[1])[None, :]
    kernel = np.exp(-2 * np.pi * np.pi * radius * radius * (fx * fx + fy * fy))
    filtered = np.fft.irfft2(np.fft.rfft2(padded) * kernel, s=padded.shape)
    return filtered[pad:-pad, pad:-pad].astype(np.float32)


def blur(field, radius):
    # Preserve the selected #10 texture calculation; filtering touches cloth
    # analysis fields only. Original artwork colors/alpha are never blurred.
    return np.asarray(
        Image.fromarray(np.uint8(np.clip(field, 0, 255))).filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32
    )


def curve_field(points, width, amplitude, kind, xx, yy, envelope):
    distance = np.full(xx.shape, 1e12, dtype=np.float32)
    nx, ny, along, signed = [np.zeros_like(xx) for _ in range(4)]
    total = sum(np.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(points, points[1:]))
    done = 0
    for p, q in zip(points, points[1:]):
        vx, vy = q[0] - p[0], q[1] - p[1]
        length = np.hypot(vx, vy)
        t = np.clip(((xx - p[0]) * vx + (yy - p[1]) * vy) / (length * length), 0, 1)
        dx = xx - (p[0] + vx * t)
        dy = yy - (p[1] + vy * t)
        d2 = dx * dx + dy * dy
        use = d2 < distance
        distance[use] = d2[use]
        nx[use] = -vy / length
        ny[use] = vx / length
        along[use] = (done + t[use] * length) / total
        signed[use] = (dx * (-vy / length) + dy * (vx / length))[use]
        done += length
    d = np.sqrt(distance)
    fade = np.maximum(np.sin(np.pi * np.clip(along, 0, 1)), 0) ** 0.45
    if kind == "compress":
        amount = amplitude * (signed / width) * np.exp(-0.5 * (d / width) ** 2)
    elif kind == "hinge":
        amount = amplitude * np.tanh(signed / (width * 0.5)) * np.exp(-0.5 * (d / (width * 1.8)) ** 2)
    else:
        amount = amplitude * np.exp(-0.5 * (d / width) ** 2)
    amount *= fade * envelope
    return nx * amount, ny * amount


def guide(points, width, amplitude, weight, kind="compress"):
    return dict(points=points, width=width, amplitude=amplitude, weight=weight, kind=kind)


# Centerlines traced separately from each contrast-enhanced blank photograph.
# These are 2D visual estimates, not measured 3D cloth geometry or strain.
GUIDES = {}


def sample(field, x, y):
    x = np.clip(x, 0, 1199)
    y = np.clip(y, 0, 1499)
    x0 = int(x)
    y0 = int(y)
    x1 = min(x0 + 1, 1199)
    y1 = min(y0 + 1, 1499)
    fx = x - x0
    fy = y - y0
    return (field[y0, x0] * (1 - fx) + field[y0, x1] * fx) * (1 - fy) + (
        field[y1, x0] * (1 - fx) + field[y1, x1] * fx
    ) * fy


def project(quad, surface=None, dx=None, dy=None):
    inv = inverse_perspective(quad)
    a, b, c, d, e, f, g, h = inv

    def uv(x, y):
        x /= 2
        y /= 2
        if dx is not None:
            x0 = x + sample(dx, x, y)
            y0 = y + sample(dy, x, y)
        else:
            x0, y0 = x, y
        den = g * x0 + h * y0 + 1
        u = (a * x0 + b * y0 + c) / den
        v = (d * x0 + e * y0 + f) / den
        if surface:
            v -= (
                surface["verticalFraction"]
                * ART.height
                * np.sin(np.pi * np.clip(u / ART.width, 0, 1))
                * np.exp(-(((v / ART.height - surface["centerV"]) / surface["spreadV"]) ** 2))
            )
        return u, v

    q = np.array(quad)
    lo = np.floor((q.min(axis=0) - 40) * 2 / 12).astype(int) * 12
    hi = np.ceil((q.max(axis=0) + 40) * 2 / 12).astype(int) * 12
    lo = np.maximum(lo, [0, 0])
    hi = np.minimum(hi, [2400, 3000])
    mesh = []
    for y in range(lo[1], hi[1], 12):
        for x in range(lo[0], hi[0], 12):
            x1 = min(x + 12, hi[0])
            y1 = min(y + 12, hi[1])
            mesh.append(
                (
                    (int(x), int(y), int(x1), int(y1)),
                    sum((uv(px, py) for px, py in ((x, y), (x, y1), (x1, y1), (x1, y))), ()),
                )
            )
    return ART.transform((2400, 3000), Image.Transform.MESH, mesh, Image.Resampling.BICUBIC).resize(
        OUT, Image.Resampling.LANCZOS
    )


def sampled_texture(filename, u, v, slow_noise):
    patch = np.asarray(Image.open(STUDY / "real-samples" / filename).convert("RGB"), dtype=np.float32).mean(2)
    residual = patch - blur(patch, 5)
    residual = np.clip(residual / max(float(residual.std()), 1), -3, 3)
    small = Image.fromarray(np.uint8(np.clip(128 + residual * 35, 0, 255)))
    small = small.resize(
        (max(4, round(small.width * 0.12)), max(4, round(small.height * 0.12))), Image.Resampling.LANCZOS
    )
    tile = np.asarray(small, dtype=np.float32)
    tile = np.concatenate([tile, np.fliplr(tile)], axis=1)
    tile = np.concatenate([tile, np.flipud(tile)], axis=0)
    xi = np.floor(u + slow_noise * 1.8).astype(int) % tile.shape[1]
    yi = np.floor(v + slow_noise * 0.7).astype(int) % tile.shape[0]
    return (tile[yi, xi] - 128) / 35


def render(record):
    global ART
    ART = Image.open(ROOT / "sources" / ("approved-" + record["design"] + ".png")).convert("RGBA")
    name = record["id"]
    GUIDES[name] = record.get("foldGuides", [])
    base = (
        Image.open(PARENT / record["source"])
        .convert("RGB")
        .crop(record["sourceCropBox"])
        .resize(OUT, Image.Resampling.LANCZOS)
    )
    base_array = np.asarray(base)
    cloth = base_array.astype(np.float32)
    lum = cloth.mean(2)
    quad = record["outputQuadTL_TR_BR_BL"]
    surface = record.get("surfaceBend")
    path = ROOT / "full" / f"{name}.png"
    initial = project(quad, surface)
    visibility = np.ones((OUT[1], OUT[0]), dtype=np.float32)
    if record.get("visibilityMask"):
        visibility = np.asarray(Image.open(ROOT / record["visibilityMask"]).convert("L"), dtype=np.float32) / 255
    mask = (np.asarray(initial)[:, :, 3] > 0.8 * 255) & (visibility > 0.99)
    if not np.any(mask):
        raise ValueError("No opaque artwork is visible on the garment after masking.")
    yy, xx = np.indices(lum.shape, dtype=np.float32)
    a, b, c, d, e, f, g, h = inverse_perspective(quad)
    den = g * xx + h * yy + 1
    un = (a * xx + b * yy + c) / den / ART.width
    vn = (d * xx + e * yy + f) / den / ART.height
    # Match texture density in estimated garment inches across differently framed
    # photos. This inherits #20's visual estimate, not a measured textile gauge.
    inches = record["targetArtworkInches"]
    units = (311 * inches[0] / 8.92, 323 * inches[1] / 9.29)
    u = un * units[0]
    v = vn * units[1]
    q = np.array(quad)
    width = (np.linalg.norm(q[1] - q[0]) + np.linalg.norm(q[2] - q[3])) / 2
    tex_scale = width / units[0]
    clean_view = record["view"] == "clean"
    fine = lum - blur(lum, 1.05 * tex_scale)
    fine_scale = max(float(np.std(fine[mask])), 0.5)
    dark = np.clip(-np.clip(fine / fine_scale, -3, 3) / 2.2, 0, 1)
    fold = blur(lum, 6 * tex_scale)
    shade = np.clip(
        (0.96 if clean_view else 0.94) + (fold - float(np.median(fold[mask]))) * (0.003 if clean_view else 0.0075),
        0.86 if clean_view else 0.60,
        1.04,
    )
    gy, gx = np.gradient(blur(lum, 2 * tex_scale))
    tension = np.clip(np.hypot(gx, gy) / 3, 0, 1)
    noise = np.random.default_rng(158020261015).random(lum.shape, dtype=np.float32)
    slow_noise = (blur(noise * 255, 3 * tex_scale) - 127.5) / 90
    channels = np.zeros_like(lum)
    for du, dv in ((-0.25, -0.25), (0.25, -0.25), (-0.25, 0.25), (0.25, 0.25)):
        uu = u + du + slow_noise * 0.35
        vv = v + dv
        phase = (uu / 2.1 + 0.11 * np.sin(vv / 6.3)) % 1
        channels += np.exp(-(((phase - 0.5) / 0.095) ** 2)) / 4
    cream = sampled_texture("cream-ink-b-patch.png", u, v, slow_noise)
    red = sampled_texture("red-ink-patch.png", u, v, slow_noise)
    gap = np.clip(-cream / 1.4, 0, 1)
    fiber = np.clip(red / 1.6, 0, 1)
    coverage = np.clip(0.975 - 0.20 * dark - 0.33 * gap - 0.16 * fiber - 0.07 * tension * channels, 0.20, 1)
    if clean_view:
        # Flat color exposes the short mirrored sample tile as repeated loops.
        # Use nonperiodic fine coverage variation here; keep model #20 unchanged.
        clean_rng = np.random.default_rng(720261017)
        grain = smooth(clean_rng.random(lum.shape, dtype=np.float32), max(0.30, 0.40 * tex_scale))
        grain = (grain - float(grain.mean())) / max(float(grain.std()), 1e-6)
        fibers = smooth(clean_rng.random(lum.shape, dtype=np.float32), max(0.45, 0.68 * tex_scale))
        fibers = (fibers - float(fibers.mean())) / max(float(fibers.std()), 1e-6)
        clean_gaps = np.clip((-grain - 0.65) / 2.0, 0, 1)
        clean_fibers = np.clip((fibers - 0.70) / 2.2, 0, 1)
        # Heather is a yarn color difference, not a deep hole through the ink.
        coverage = np.clip(0.985 - 0.045 * dark - 0.18 * clean_gaps - 0.045 * clean_fibers, 0.70, 1)
        relief = (1 + np.clip(fine * 0.004, -0.035, 0.035)) * (1 + np.clip(grain * 0.009, -0.025, 0.025))
    else:
        relief = (1 + np.clip(fine * 0.012, -0.07, 0.06)) * (1 + np.clip(cream * 0.04, -0.08, 0.07))

    envelope = np.clip(np.minimum.reduce([un, vn, 1 - un, 1 - vn]) / 0.12, 0, 1)
    envelope = envelope * envelope * (3 - 2 * envelope)
    fold_signal = smooth(lum, 3 * tex_scale) - smooth(lum, 40 * tex_scale)
    gy, gx = np.gradient(smooth(lum, 5 * tex_scale))
    dx = 0.25 * np.clip(gx * 3.4, -4, 4) * envelope
    dy = 0.25 * np.clip(gy * 3.4, -4, 4) * envelope
    for item in GUIDES[name]:
        cx, cy = curve_field(item["points"], item["width"], item["amplitude"], item["kind"], xx, yy, envelope)
        dx += item["weight"] * cx
        dy += item["weight"] * cy
    wrap_weight = 0 if record["view"] == "clean" else 0.3
    dx += wrap_weight * (2 * un - 1) * (1 - (2 * un - 1) ** 2) * 4.3 * envelope
    dy += wrap_weight * np.sin(np.pi * un) * (vn - 0.45) * 4 * envelope
    dx = smooth(dx, 2) * envelope
    dy = smooth(dy, 2) * envelope
    jacobian = (1 + np.gradient(dx, axis=1)) * (1 + np.gradient(dy, axis=0)) - np.gradient(dx, axis=0) * np.gradient(
        dy, axis=1
    )
    max_displacement = float(np.hypot(dx, dy).max())
    minimum_jacobian = float(jacobian.min())
    if not (max_displacement < 12 and minimum_jacobian > 0.20):
        raise ValueError("Fold deformation exceeds the displacement or Jacobian safety bounds")
    if not (np.all(dx[envelope == 0] == 0) and np.all(dy[envelope == 0] == 0)):
        raise ValueError("Fold displacement changed the pinned perimeter")

    projected = project(quad, surface, dx, dy)
    ink = np.asarray(projected, dtype=np.float32)
    valley = np.clip(-fold_signal / 12, 0, 1)
    alpha = ink[:, :, 3] / 255 * np.clip(coverage - 0.012 * valley, 0.20, 1) * visibility
    factor = np.clip(
        np.exp(fold_signal * (0.012 if clean_view else 0.045 * 0.75)),
        0.90 if clean_view else 0.72,
        1.06 if clean_view else 1.08,
    )
    colors = ink[:, :, :3].copy()
    grey = colors.mean(2)
    colors = grey[:, :, None] + (colors - grey[:, :, None]) * 0.98
    colors *= np.clip(shade * relief * factor, 0.36, 1.10)[:, :, None]
    out = np.uint8(np.clip(cloth * (1 - alpha[:, :, None]) + colors * alpha[:, :, None], 0, 255))
    out[alpha == 0] = base_array[alpha == 0]
    if not np.array_equal(out[alpha == 0], base_array[alpha == 0]):
        raise ValueError("Pixels outside the ink were changed")
    result = Image.fromarray(out)
    result.save(path)
    projected.save(ROOT / "sources" / f"{name}-projected-art.png")
    Image.fromarray(np.uint8(np.clip(alpha * 255, 0, 255))).save(ROOT / "sources" / f"{name}-effective-alpha.png")
    if record.get("retainSurfaceMap", False):
        np.savez_compressed(ROOT / "sources" / f"{name}-surface-map.npz", dx=dx, dy=dy)
    return result, dict(
        selected20ByteIdentical=False,
        clothTreatment=("flat-provider-nonperiodic-v3" if clean_view else "selected-20"),
        maxLocalDisplacementPx=round(max_displacement, 3),
        minimumMappingJacobian=round(minimum_jacobian, 3),
        addedArtworkBlurPixels=0,
        outsideInkPixelsIdentical=True,
        perimeterDisplacementPixels=0,
        foldGuides=GUIDES[name],
        estimatedTextureCoordinateSpan=list(units),
        texturePixelScale=round(tex_scale, 4),
        meanInkCoverage=round(float(np.clip(coverage - 0.012 * valley, 0.20, 1)[mask].mean()), 4),
        wrapWeight=wrap_weight,
        foregroundVisibilityMask=record.get("visibilityMask"),
        visibleInkFraction=round(float((ink[:, :, 3] * visibility).sum() / max(ink[:, :, 3].sum(), 1)), 4),
    )
