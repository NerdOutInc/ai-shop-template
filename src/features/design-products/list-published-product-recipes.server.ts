import "server-only"

import { z } from "zod"

import { listPublishedProducts } from "@/features/publishing/list-published-products-for-admin.server"

import { readGarmentDescription } from "./read-garment-description"
import { readProductArtworkImages } from "./read-product-artwork-images"

const option = z.object({
  name: z.string(),
  type: z.string().optional(),
  values: z.array(z.object({ id: z.number().int(), title: z.string() })),
})
const snapshot = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    title: z.string().optional(),
    description: z.string().optional(),
    blueprint_id: z.number().int().positive(),
    print_provider_id: z.number().int().positive(),
    options: z.array(option).default([]),
    variants: z
      .array(
        z.object({
          id: z.number().int(),
          price: z.number().int().nonnegative(),
          is_enabled: z.boolean().optional().default(false),
          options: z.array(z.number().int()).default([]),
        })
      )
      .default([]),
  })
  .passthrough()

export type PublishedProductRecipe = {
  blueprintId: number
  printProviderId: number
  productIds: string[]
  titles: string[]
  variants: { id: number; price: number; color: string | null; size: string | null }[]
  placement: { position: "front"; x: number; y: number; scale: number; angle: number } | null
  /** The published product whose single front placement is copied. */
  placementDonorProductId: string | null
  placementDonorTitle: string | null
  /** The published product whose description carries the garment, care and size-chart text to copy. */
  sizeGuideDonor: { productId: string; title: string | null; description: string; sizes: string[] } | null
  /** Facts recovered from a past publish that only Printify can confirm are still current. */
  unverified: string[]
  /** Why this model cannot be offered yet. Non-empty means do not create a draft from it. */
  blocked: string[]
}

/**
 * The product models this shop has ALREADY published, with as much of a recipe as can honestly be
 * recovered from them.
 *
 * The point is to offer a short, real list instead of the whole Printify catalogue. Everything here
 * is READ BACK from published products; nothing about a garment is invented. Where a value cannot be
 * recovered the model is `blocked` and carries no proposed recipe, and where a value is recovered but
 * could have drifted at Printify it is listed in `unverified` so the agent must say so rather than
 * present it as current.
 *
 * Read publication snapshots rather than draft bindings: bindings also retain removed and
 * uncertain product attempts, which do not establish current published membership.
 */
export async function listPublishedProductRecipes() {
  const raw = await listPublishedProducts()
  const models = new Map<string, PublishedProductRecipe>()
  const skipped: { productId: string; reasons: string[] }[] = []
  // The list arrives in the owner's Featured order, and the first product of a model lends it its
  // variants, placement and size chart. Read in product id order instead, so the same shop always
  // answers the same way and dragging tees round the Products page cannot change whose prices and
  // measurements get copied.
  const idOf = (entry: Record<string, unknown>) => String(entry.id ?? "")
  const ordered = raw.toSorted((a, b) => (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0))

  for (const entry of ordered) {
    const parsed = snapshot.safeParse(entry)
    if (!parsed.success) {
      skipped.push({ productId: String(entry.id ?? "unknown"), reasons: ["The saved product could not be read"] })
      continue
    }
    const product = parsed.data
    const key = `${product.blueprint_id}:${product.print_provider_id}`
    const model =
      models.get(key) ??
      ({
        blueprintId: product.blueprint_id,
        printProviderId: product.print_provider_id,
        productIds: [],
        titles: [],
        variants: [],
        placement: null,
        placementDonorProductId: null,
        placementDonorTitle: null,
        sizeGuideDonor: null,
        // A published price is as of the last publish that carried variants; nothing in the
        // production fingerprint covers price, so a change at Printify would not have failed.
        unverified: ["variants[].price"],
        blocked: [],
      } satisfies PublishedProductRecipe)
    models.set(key, model)
    model.productIds.push(product.id)
    if (product.title) model.titles.push(product.title)

    if (model.variants.length === 0) {
      const colors = product.options.find((entry) => entry.type === "color" || /^colou?rs?$/i.test(entry.name))
      const sizes = product.options.find((entry) => entry.type === "size" || /^sizes?$/i.test(entry.name))
      model.variants = product.variants
        .filter((variant) => variant.is_enabled && variant.price > 0)
        .map((variant) => ({
          id: variant.id,
          price: variant.price,
          color: colors?.values.find((value) => variant.options.includes(value.id))?.title ?? null,
          size: sizes?.values.find((value) => variant.options.includes(value.id))?.title ?? null,
        }))
      if (model.variants.some((variant) => variant.color === null || variant.size === null))
        model.unverified.push("variants[].color", "variants[].size")
    }

    // Ahead of the placement check: a size chart describes the garment, so a tee whose artwork
    // cannot stand in for another can still lend its measurements.
    if (model.sizeGuideDonor === null && product.description) {
      const read = readGarmentDescription(product.description, product.title ?? "")
      if (read)
        model.sizeGuideDonor = {
          productId: product.id,
          title: product.title ?? null,
          description: product.description,
          sizes: read.sizeGuide.sizes,
        }
    }

    const placement = readPlacement(entry)
    if (placement) {
      if (model.placement === null) {
        // Different designs have deliberately different sizes. Copy one stable reference, just
        // as we do for prices; only disagreement within that product makes its placement unusable.
        model.placement = placement
        model.placementDonorProductId = product.id
        model.placementDonorTitle = product.title ?? null
      } else if (!samePlacement(model.placement, placement)) {
        // Different artwork can need different sizing. Keep the reference stable, but surface the
        // disagreement so the owner can assess that reference before creating the draft.
        model.unverified.push("placement")
      }
    }
  }

  for (const model of models.values()) {
    if (model.variants.length === 0) model.blocked.push("No enabled, priced variants were recovered")
    if (model.placement === null) model.blocked.push("No usable artwork placement was recovered")
    if (model.sizeGuideDonor === null)
      model.blocked.push("No published product of this model has a garment section with a size chart to copy")
    model.blocked = [...new Set(model.blocked)]
    model.unverified = [...new Set(model.unverified)]
  }

  return {
    productsRead: raw.length,
    models: [...models.values()].toSorted(
      (a, b) => a.blueprintId - b.blueprintId || a.printProviderId - b.printProviderId
    ),
    skipped,
  }
}

/** The one front placement a product agrees on, or null when it cannot stand in for another. */
function readPlacement(raw: unknown) {
  const controls = readProductArtworkImages(raw)
  if (!controls || controls.hasUnsupportedArtwork || controls.hasLayeredArtwork || controls.hasOtherArtwork) return null
  const [first, ...rest] = controls.front
  if (!first) return null
  const placement = {
    position: "front" as const,
    x: first.x,
    y: first.y,
    scale: first.scale,
    angle: first.angle,
  }
  if (!isCompletePlacement(placement)) return null
  return rest.every((entry) => samePlacement(placement, entry)) ? placement : null
}

function isCompletePlacement(value: {
  x?: number
  y?: number
  scale?: number
  angle?: number
}): value is { position: "front"; x: number; y: number; scale: number; angle: number } {
  return (
    typeof value.x === "number" &&
    value.x >= 0 &&
    value.x <= 1 &&
    typeof value.y === "number" &&
    value.y >= 0 &&
    value.y <= 1 &&
    typeof value.scale === "number" &&
    value.scale > 0 &&
    value.scale <= 10 &&
    Number.isInteger(value.angle) &&
    value.angle! >= 0 &&
    value.angle! <= 359
  )
}

function samePlacement(a: { x: number; y: number; scale: number; angle: number }, b: Record<string, unknown>) {
  const rounded = (value: unknown) => (typeof value === "number" ? Math.round(value * 1_000_000) / 1_000_000 : null)
  return (
    rounded(a.x) === rounded(b.x) &&
    rounded(a.y) === rounded(b.y) &&
    rounded(a.scale) === rounded(b.scale) &&
    a.angle === b.angle
  )
}
