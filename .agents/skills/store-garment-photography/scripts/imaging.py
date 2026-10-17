"""Decode in viewer orientation and normalize tagged colors before blending."""

from functools import lru_cache
import io
import struct

from PIL import Image, ImageCms, ImageOps


@lru_cache(maxsize=1)
def srgb_profile_bytes():
    profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
    # LittleCMS stamps newly created profiles with the clock. A stable ICC header
    # keeps repeated encodes deterministic without altering the color transform.
    profile[24:36] = struct.pack(">6H", 2000, 1, 1, 0, 0, 0)
    profile[84:100] = bytes(16)
    return bytes(profile)


def load_image(path, mode="RGB"):
    with Image.open(path) as original:
        image = ImageOps.exif_transpose(original)
        alpha = image.convert("RGBA").getchannel("A") if mode == "RGBA" else None
        embedded = image.info.get("icc_profile")
        if embedded:
            try:
                source = ImageCms.ImageCmsProfile(io.BytesIO(embedded))
                target = ImageCms.ImageCmsProfile(io.BytesIO(srgb_profile_bytes()))
                rgb = ImageCms.profileToProfile(image, source, target, outputMode="RGB")
            except (ImageCms.PyCMSError, OSError, ValueError) as error:
                raise ValueError(f"Cannot convert embedded color profile in {path.name} to sRGB") from error
        else:
            rgb = image.convert("RGB")
        if alpha is not None:
            rgb.putalpha(alpha)
        # Do not carry the original orientation or other private EXIF metadata
        # into normalized diagnostics/outputs. Original input bytes stay archived.
        rgb.info.clear()
        rgb.info["icc_profile"] = srgb_profile_bytes()
        return rgb
