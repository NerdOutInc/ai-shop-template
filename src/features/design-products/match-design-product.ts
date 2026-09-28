import { z } from "zod"
import type { DesignProductPayload } from "./design-draft-types"
import { readProductArtworkImages } from "./read-product-artwork-images"
import { isProviderCareLabel } from "./is-provider-care-label"

const image = z.object({
  src: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  id: z.union([z.string(), z.number()]).transform(String),
  x: z.number(),
  y: z.number(),
  scale: z.number(),
  angle: z.number(),
  flipX: z.literal(false).optional(),
  flipY: z.literal(false).optional(),
  pattern: z.null().optional(),
  input_text: z.literal("").optional(),
})
const area = z.object({
  variant_ids: z.array(z.number()),
  background: z.union([z.null(), z.literal(""), z.literal("transparent")]).optional(),
  placeholders: z.array(
    z.object({ position: z.string(), decoration_method: z.string().optional(), images: z.array(image) })
  ),
})
const product = z.object({
  title: z.string(),
  description: z.string(),
  blueprint_id: z.number(),
  print_provider_id: z.number(),
  variants: z.array(z.object({ id: z.number(), price: z.number(), is_enabled: z.boolean() })),
  print_areas: z.array(area),
})
function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000
}
function normalizeText(value: string) {
  return value.normalize("NFC").replace(/\r\n?/g, "\n").trim()
}
function normalize(value: z.infer<typeof product>) {
  const enabled = value.variants.filter((variant) => variant.is_enabled).toSorted((a, b) => a.id - b.id)
  return {
    title: normalizeText(value.title),
    description: normalizeText(value.description),
    blueprint_id: value.blueprint_id,
    print_provider_id: value.print_provider_id,
    variants: enabled.map(({ id, price }) => ({ id, price })),
    areas: enabled.map((variant) => ({
      variant: variant.id,
      areas: value.print_areas
        .filter((entry) => entry.variant_ids.includes(variant.id))
        .map((entry) =>
          entry.placeholders
            .filter((placeholder) => placeholder.images.some((entry) => !isProviderCareLabel(placeholder, entry)))
            .map((placeholder) => ({
              position: placeholder.position,
              images: placeholder.images
                .filter((entry) => !isProviderCareLabel(placeholder, entry))
                .map((art) => ({
                  id: art.id,
                  x: rounded(art.x),
                  y: rounded(art.y),
                  scale: rounded(art.scale),
                  angle: art.angle,
                })),
            }))
            .sort((a, b) => a.position.localeCompare(b.position))
        ),
    })),
  }
}

/** Match effective enabled layouts, allowing Printify to regroup color areas without hiding extra layers. */
export function matchDesignProduct(
  raw: unknown,
  payload: DesignProductPayload,
  expectedImage?: { width: number | null; height: number | null }
): boolean {
  const parsed = product.safeParse(raw)
  const controls = readProductArtworkImages(raw)
  return (
    controls !== null &&
    !controls.hasUnsupportedArtwork &&
    (!expectedImage ||
      controls.front.every(
        (image) =>
          (image.width === undefined || image.width === expectedImage.width) &&
          (image.height === undefined || image.height === expectedImage.height)
      )) &&
    parsed.success &&
    JSON.stringify(normalize(parsed.data)) === JSON.stringify(normalize(payload))
  )
}
