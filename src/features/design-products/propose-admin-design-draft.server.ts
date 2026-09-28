import "server-only"

import { GARMENT_MODEL } from "@/features/design-library/garment-model"
import type { LibraryDesign } from "@/features/design-library/library-types"
import { createPostgresLibraryStore } from "@/features/design-library/postgres-library-store.server"

import type { DesignRecipeSourceOptions } from "./read-design-recipe-sources.server"

import { buildDesignRecipe } from "./build-design-recipe"
import { DesignDraftError } from "./design-draft-error"
import { readDesignRecipeSources } from "./read-design-recipe-sources.server"

/**
 * What the design page's draft button would create, worked out before anything is reserved.
 *
 * Read-only: it reads the library, the shop's published tees and the provider's catalogue, and
 * writes nothing here or at Printify. The route shows it to the owner, and creation rebuilds it.
 */
export async function proposeAdminDesignDraft(
  userId: string,
  input: { designId: string; displayNumber: number; revisionId: string },
  options: DesignRecipeSourceOptions & {
    getDesign?: (userId: string, displayNumber: number) => Promise<LibraryDesign | null>
  } = {}
) {
  const design = await (options.getDesign ?? ((id, number) => createPostgresLibraryStore().getDesign(id, number)))(
    userId,
    input.displayNumber
  )
  // The number finds the design and the id proves the page and the library mean the same one.
  if (!design || design.id !== input.designId || !design.revisions.some(({ id }) => id === input.revisionId))
    throw new DesignDraftError("NOT_FOUND", "That design or artwork revision is no longer in the library")
  if (design.state !== "active")
    throw new DesignDraftError("INVALID_INPUT", "Restore this design before creating a product from it")

  const { model, catalog } = await readDesignRecipeSources(options)

  return {
    design: { id: design.id, displayNumber: design.displayNumber, title: design.title },
    revisionId: input.revisionId,
    modelLabel: GARMENT_MODEL.label,
    proposal: buildDesignRecipe({ model, modelLabel: GARMENT_MODEL.label, catalog, design }),
  }
}
