import type { DesignCatalogVariant, DesignDraftRecipe } from "./design-draft-types"
import type { PublishedProductRecipe } from "./list-published-product-recipes.server"

import { buildDesignParagraph } from "./build-design-paragraph"
import { readGarmentDescription } from "./read-garment-description"

export type DesignRecipeProposal = {
  /** Null whenever `blockers` is non-empty: a partial recipe is never offered. */
  recipe: DesignDraftRecipe | null
  colors: string[]
  sizes: { size: string; price: number }[]
  /** Garments the design asked for that are left out, so the owner sees the gap before confirming. */
  skipped: { color: string; size: string | null; reason: string }[]
  blockers: string[]
  placementDonor: {
    productId: string
    title: string | null
    placement: DesignDraftRecipe["placement"]
  } | null
  unverified: string[]
}

/**
 * A design's own recipe: the owner's assigned garment colours, in the sizes and at the prices the
 * shop already sells, placed where the shop already prints.
 *
 * The published recipe alone cannot do this, because it carries only the colours of the tee it was
 * recovered from. The provider's catalogue supplies the variant for each assigned colour and size;
 * price is per size and comes from the published tee, since the catalogue has costs, not prices.
 *
 * Nothing about the garment is invented. Whatever cannot be read back is a blocker rather than a
 * guess, and a garment the provider cannot make right now is left out and named.
 */
export function buildDesignRecipe(input: {
  model: PublishedProductRecipe | null
  modelLabel: string
  catalog: DesignCatalogVariant[]
  design: { summary: string; colors: { name: string; position: number }[] }
}): DesignRecipeProposal {
  const { model, catalog, design } = input
  const blockers: string[] = []
  const skipped: DesignRecipeProposal["skipped"] = []
  const placementDonor =
    model?.placementDonorProductId && model.placement
      ? { productId: model.placementDonorProductId, title: model.placementDonorTitle, placement: model.placement }
      : null
  const unverified = [...(model?.unverified ?? [])]
  const blocked = (): DesignRecipeProposal => ({
    recipe: null,
    colors: [],
    sizes: [],
    skipped,
    blockers,
    placementDonor,
    unverified,
  })

  if (!model) {
    blockers.push(`Publish one ${input.modelLabel} tee first; its sizes, prices and placement are what get copied`)
    return blocked()
  }
  blockers.push(...model.blocked)

  const colors = design.colors.toSorted((first, second) => first.position - second.position).map(({ name }) => name)
  if (!colors.length) blockers.push("Assign this design's garment colors first")
  const summary = design.summary.trim()
  if (!summary) blockers.push("This design has no summary to describe it")

  const prices = new Map<string, Set<number>>()
  for (const variant of model.variants)
    if (variant.size) prices.set(variant.size, (prices.get(variant.size) ?? new Set()).add(variant.price))
  const sizes = [...prices].map(([size, values]) => ({ size, price: [...values][0]! }))
  for (const [size, values] of prices)
    if (values.size > 1)
      // Two colours of one size at different prices: copying either would be choosing for the owner.
      blockers.push(`The published ${size} is sold at more than one price; settle it in Printify first`)
  if (!sizes.length && !model.blocked.length) blockers.push("No published sizes were recovered")

  const garment = model.sizeGuideDonor
    ? readGarmentDescription(model.sizeGuideDonor.description, model.sizeGuideDonor.title ?? "")
    : null
  if (model.sizeGuideDonor && !garment)
    blockers.push("The published description has no garment section with a size guide to copy")
  const description = `${buildDesignParagraph(summary)}${garment?.description ?? ""}`
  if (description.length > 10000) blockers.push("The copied description is too long for a draft")

  if (blockers.length || !model.placement) return blocked()

  const variants: DesignDraftRecipe["variants"] = []
  const offered: string[] = []
  for (const color of colors) {
    const before = variants.length
    const missing: typeof skipped = []
    for (const { size, price } of sizes) {
      const found = catalog.find((variant) => variant.color === color && variant.size === size)
      if (found?.available) variants.push({ id: found.id, price, color, size })
      else
        missing.push({
          color,
          size,
          reason: found ? "Printify cannot make it right now" : "Printify does not list it",
        })
    }
    if (variants.length === before) skipped.push({ color, size: null, reason: "No size of this color is available" })
    else {
      offered.push(color)
      skipped.push(...missing)
    }
  }
  if (!variants.length) {
    blockers.push("None of this design's colors is available from Printify right now")
    return blocked()
  }

  return {
    recipe: {
      blueprintId: model.blueprintId,
      productModelLabel: input.modelLabel,
      printProviderId: model.printProviderId,
      variants,
      placement: model.placement,
      description,
      // The storefront appends its own suffixes, so a title carrying one would double up.
      titleTemplate: "{title}",
    },
    colors: offered,
    sizes: sizes.filter(({ size }) => variants.some((variant) => variant.size === size)),
    skipped,
    blockers,
    placementDonor,
    unverified,
  }
}
