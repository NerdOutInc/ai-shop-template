import "server-only"

import { createHash } from "node:crypto"

import { z } from "zod"

import { cartLimits } from "@/lib/cart-limits"

import { productionFingerprintVersion } from "./production-fingerprint-version"

const productSchema = z.object({
  id: z.string(),
  shop_id: z.number().int(),
  title: z.string().min(1),
  blueprint_id: z.number().int(),
  print_provider_id: z.number().int(),
  print_areas: z.array(z.json()).min(1),
  print_details: z.json().optional(),
  images: z.array(z.unknown()).catch([]).default([]),
  variants: z.array(
    z.object({
      id: z.number().int(),
      sku: z.string().optional(),
      price: z.number().int().nonnegative().max(cartLimits.maxUnitAmount),
      is_enabled: z.boolean(),
      is_available: z.boolean(),
      options: z.array(z.number().int()),
    })
  ),
  options: z.array(
    z.object({
      values: z.array(z.object({ id: z.number().int(), title: z.string() })),
    })
  ),
})

const mockupSchema = z.object({
  src: z.string().refine((src) => {
    try {
      const url = new URL(src)
      return url.protocol === "https:" && !url.username && !url.password
    } catch {
      return false
    }
  }),
  variant_ids: z.array(z.number().int()),
  is_default: z.boolean().optional().default(false),
})

// Project the response onto the settings we compare. Extra provider attributes and
// image retrieval metadata must not invalidate a product or change its v2 identity.
const imageSchema = z.object({
  id: z.union([z.string().min(1), z.number().int()]),
  x: z.number(),
  y: z.number(),
  scale: z.number(),
  angle: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  type: z.string().optional(),
  layerType: z.string().optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  font_family: z.string().optional(),
  font_size: z.union([z.string(), z.number()]).optional(),
  font_weight: z.union([z.string(), z.number()]).optional(),
  font_color: z.string().optional(),
  font_style: z.string().optional(),
  input_text: z.string().optional(),
  text_align: z.string().optional(),
  pattern: z
    .object({ spacing_x: z.number(), spacing_y: z.number(), angle: z.number(), offset: z.number() })
    .nullable()
    .optional(),
})
const printAreasSchema = z.array(
  z.object({
    variant_ids: z.array(z.number().int()),
    placeholders: z.array(
      z.object({
        position: z.string().min(1),
        decoration_method: z.string().optional(),
        images: z.array(imageSchema),
      })
    ),
    background: z.string().nullable().optional(),
    font_color: z.string().nullable().optional(),
    font_family: z.string().nullable().optional(),
  })
)
const printDetailsSchema = z
  .union([
    z.object({
      print_on_side: z.string().optional(),
      separator_type: z.string().optional(),
      separator_color: z.string().optional(),
    }),
    z.array(z.never()),
  ])
  .optional()

function canonicalProductionValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalProductionValue)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalProductionValue(entry)])
  )
}

function hash(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalProductionValue(value)))
    .digest("hex")
}

export function parsePrintifyProduct(raw: unknown, expected: { productId: string; shopId: string }) {
  const parsed = productSchema.safeParse(raw)
  if (!parsed.success || parsed.data.id !== expected.productId || String(parsed.data.shop_id) !== expected.shopId)
    return null
  const product = parsed.data
  if (new Set(product.variants.map((variant) => variant.id)).size !== product.variants.length) return null
  const printAreas = printAreasSchema.safeParse(product.print_areas)
  const printDetails = printDetailsSchema.safeParse(product.print_details)
  if (!printAreas.success || !printDetails.success) {
    // Report malformed settings we consume without logging payloads or private validation details.
    console.error("Printify production schema changed", {
      code: "PRODUCT_SCHEMA_DRIFT",
      ...(/^[a-zA-Z0-9_-]{1,128}$/.test(product.id) ? { productId: product.id } : {}),
      ...(/^\d{1,20}$/.test(expected.shopId) ? { shopId: expected.shopId } : {}),
    })
    return null
  }
  const assignments = product.variants.map((variant) =>
    printAreas.data.filter((area) => area.variant_ids.includes(variant.id))
  )
  if (
    assignments.some((areas, index) => areas.length > 1 || (product.variants[index]!.is_enabled && areas.length !== 1))
  )
    return null
  // Mockups are optional display data; a malformed photo must not invalidate a printable product.
  const mockups = product.images.flatMap((rawImage) => {
    const image = mockupSchema.safeParse(rawImage)
    return image.success ? [image.data] : []
  })
  return {
    id: product.id,
    title: product.title,
    variants: product.variants.map((variant, index) => {
      const variantImages = mockups.filter((image) => image.variant_ids.includes(variant.id))
      const imageUrl = (variantImages.find((image) => image.is_default) ?? variantImages[0])?.src
      const area = assignments[index]![0]
      const printArea = area
        ? {
            background: area.background,
            font_color: area.font_color,
            font_family: area.font_family,
            placeholders: area.placeholders
              .map((placeholder) => ({
                position: placeholder.position,
                decoration_method: placeholder.decoration_method,
                images: placeholder.images,
              }))
              .sort((left, right) => (left.position < right.position ? -1 : left.position > right.position ? 1 : 0)),
          }
        : null
      const design = {
        blueprintId: product.blueprint_id,
        providerId: product.print_provider_id,
        printArea,
        printDetails: printDetails.data,
      }
      return {
        id: variant.id,
        ...(imageUrl ? { imageUrl } : {}),
        unitAmount: variant.price,
        enabled: variant.is_enabled,
        inStock: variant.is_available,
        label: product.options
          .flatMap((option) =>
            option.values.filter((value) => variant.options.includes(value.id)).map((value) => value.title)
          )
          .join(" / "),
        designFingerprint: `${productionFingerprintVersion}:${hash(design)}`,
        fingerprint: `${productionFingerprintVersion}:${hash({ ...design, productId: product.id, variantId: variant.id, sku: variant.sku, options: variant.options.toSorted((a, b) => a - b) })}`,
      }
    }),
  }
}
