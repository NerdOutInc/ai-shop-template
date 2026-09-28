import "server-only"

import { GARMENT_MODEL } from "@/features/design-library/garment-model"
import { env } from "@/lib/env"

import type { DesignCatalogVariant } from "./design-draft-types"
import type { PublishedProductRecipe } from "./list-published-product-recipes.server"

import { DesignDraftError } from "./design-draft-error"
import { listPublishedProductRecipes } from "./list-published-product-recipes.server"
import { PrintifyDesignDraftClient } from "./printify-design-draft-client.server"

export type DesignRecipeSourceOptions = {
  signal?: AbortSignal
  listModels?: () => Promise<PublishedProductRecipe[]>
  listCatalogVariants?: (model: {
    blueprintId: number
    printProviderId: number
    position: "front"
  }) => Promise<DesignCatalogVariant[]>
}

/**
 * The two things every design's recipe is built from: the shop's published tee of the library's
 * garment model, and what the provider can make of that model right now.
 *
 * Read-only, and the same for every design, so one read serves a whole page of proposals. The
 * drafts token stays here: a caller gets variant ids and availability, never the credential.
 */
export async function readDesignRecipeSources(options: DesignRecipeSourceOptions = {}) {
  let listCatalogVariants = options.listCatalogVariants
  if (!listCatalogVariants) {
    if (!env.PRINTIFY_DRAFTS_API_TOKEN?.trim())
      throw new DesignDraftError("INVALID_INPUT", "Printify draft access is not configured for this store yet")
    const client = new PrintifyDesignDraftClient(
      env.PRINTIFY_DRAFTS_API_TOKEN,
      env.PRINTIFY_SHOP_ID ?? "",
      fetch,
      options.signal
    )
    listCatalogVariants = (model) => client.listCatalogVariants(model)
  }

  const models = await (options.listModels ?? (async () => (await listPublishedProductRecipes()).models))()
  const model =
    models.find(
      (entry) =>
        entry.blueprintId === GARMENT_MODEL.blueprintId && entry.printProviderId === GARMENT_MODEL.printProviderId
    ) ?? null
  // No published tee means nothing to copy, so there is no reason to ask Printify anything.
  const catalog = model
    ? await listCatalogVariants({
        blueprintId: GARMENT_MODEL.blueprintId,
        printProviderId: GARMENT_MODEL.printProviderId,
        position: "front",
      })
    : []
  return { model, catalog }
}
