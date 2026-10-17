import { z } from "zod"
import { isProviderCareLabel } from "./is-provider-care-label"
const image = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  src: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  layerType: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  scale: z.number().optional(),
  angle: z.number().optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  pattern: z.unknown().optional(),
  input_text: z.string().optional(),
  font_family: z.string().optional(),
  font_size: z.unknown().optional(),
  font_weight: z.unknown().optional(),
  font_color: z.string().optional(),
  font_style: z.string().optional(),
  text_align: z.string().optional(),
})
const empty = z.union([z.null(), z.literal(""), z.literal("transparent")]).optional()
const schema = z.object({
  print_details: z.unknown().optional(),
  print_areas: z.array(
    z.object({
      background: z.unknown().optional(),
      font_color: z.unknown().optional(),
      font_family: z.unknown().optional(),
      placeholders: z.array(
        z.object({ position: z.string(), decoration_method: z.string().optional(), images: z.array(image) })
      ),
    })
  ),
})
export function readProductArtworkImages(raw: unknown) {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return null
  const areas = parsed.data.print_areas
  const images = areas.flatMap((area) =>
    area.placeholders.flatMap((placeholder) =>
      placeholder.images
        .filter((entry) => !isProviderCareLabel(placeholder, entry))
        .map((entry) => ({ ...entry, position: placeholder.position, decorationMethod: placeholder.decoration_method }))
    )
  )
  const details = parsed.data.print_details
  const nondefaultDetails =
    details !== undefined && details !== null && JSON.stringify(details) !== "{}" && JSON.stringify(details) !== "[]"
  const areaControls = areas.some((area) => {
    // Unused editor defaults also appear alongside the provider's required care label.
    // Actual text layers and their controls remain unsupported below.
    const unusedRasterFonts =
      area.font_family === "Roboto" &&
      (area.font_color === undefined ||
        area.font_color === null ||
        area.font_color === "" ||
        area.font_color === "auto" ||
        (typeof area.font_color === "string" && /^#(?:000|000000|000000ff)$/i.test(area.font_color))) &&
      area.placeholders.every((placeholder) =>
        placeholder.images.every(
          (entry) =>
            isProviderCareLabel(placeholder, entry) ||
            ((!entry.type || entry.type === "image/png") &&
              (!entry.layerType || entry.layerType === "image") &&
              !entry.input_text &&
              !entry.font_family &&
              !entry.font_size &&
              !entry.font_weight &&
              !entry.font_color &&
              !entry.font_style &&
              !entry.text_align)
        )
      )
    return (
      !empty.safeParse(area.background).success ||
      (!unusedRasterFonts && ![area.font_color, area.font_family].every((value) => empty.safeParse(value).success))
    )
  })
  return {
    images,
    front: images.filter((entry) => entry.position === "front"),
    hasOtherArtwork: images.some((entry) => entry.position !== "front"),
    hasLayeredArtwork: areas.some((area) =>
      area.placeholders.some(
        (placeholder) => placeholder.images.filter((entry) => !isProviderCareLabel(placeholder, entry)).length > 1
      )
    ),
    hasUnsupportedArtwork:
      nondefaultDetails ||
      areaControls ||
      images.some(
        (entry) =>
          (entry.type && entry.type !== "image/png") ||
          (entry.layerType && entry.layerType !== "image") ||
          entry.flipX ||
          entry.flipY ||
          entry.pattern ||
          entry.input_text ||
          entry.font_family ||
          entry.font_size ||
          entry.font_weight ||
          entry.font_color ||
          entry.font_style ||
          entry.text_align ||
          (entry.decorationMethod && entry.decorationMethod !== "dtg")
      ),
  }
}
