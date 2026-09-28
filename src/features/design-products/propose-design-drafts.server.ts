import "server-only"

import { GARMENT_MODEL } from "@/features/design-library/garment-model"
import type { LibraryDesign } from "@/features/design-library/library-types"
import { createPostgresLibraryStore } from "@/features/design-library/postgres-library-store.server"

import type { DesignRecipeProposal } from "./build-design-recipe"
import type { DesignRecipeSourceOptions } from "./read-design-recipe-sources.server"

import { buildDesignRecipe } from "./build-design-recipe"
import { readDesignRecipeSources } from "./read-design-recipe-sources.server"

export type DesignDraftProposal = DesignRecipeProposal & {
  number: number
  /** Null when the number finds nothing; `blockers` then says so. */
  design: { id: string; displayNumber: number; title: string } | null
  /** The revision a numbered selection would freeze: this owner's pinned favorite, else the current one. */
  revisionId: string | null
}

/**
 * What a draft of each numbered design would be, in that design's own garment colours, worked out
 * before anything is reserved. It is the design page's proposal for a whole page of designs.
 *
 * Read-only: nothing is written here or at Printify, and no binding is reserved. That is the point
 * of asking first. A binding cannot be redone for different colours, so whoever creates the draft
 * has to see which garments would be left out while leaving them out is still a choice.
 *
 * One design that cannot be drafted never fails the others: its refusal is its own `blockers`, in
 * the same words the design page uses.
 */
export async function proposeDesignDrafts(
  userId: string,
  input: { numbers: number[] },
  options: DesignRecipeSourceOptions & {
    getDesign?: (userId: string, displayNumber: number) => Promise<LibraryDesign | null>
  } = {}
): Promise<{ modelLabel: string; proposals: DesignDraftProposal[] }> {
  const getDesign =
    options.getDesign ??
    // Pending collections included, as `library.get` and the draft freeze both see them.
    ((id, number) => createPostgresLibraryStore().getDesign(id, number, { includePending: true }))

  const found: { number: number; design: LibraryDesign | null; revisionId: string | null; refusal: string | null }[] =
    []
  // One at a time: each read holds a connection, and a full page at once would take the pool.
  for (const number of new Set(input.numbers)) {
    const design = await getDesign(userId, number)
    // The same choice the draft freeze makes for a numbered selection.
    const revisionId = design ? (design.favoriteRevisionId ?? design.revision?.id ?? null) : null
    found.push({
      number,
      design,
      revisionId,
      refusal: !design
        ? `Design #${number} is not in this library`
        : design.state !== "active"
          ? "Restore this design before creating a product from it"
          : !revisionId
            ? "This design has no artwork revision to make a product from"
            : null,
    })
  }

  // Nothing to build means nothing to ask the shop or Printify.
  const sources = found.some(({ refusal }) => !refusal) ? await readDesignRecipeSources(options) : null

  return {
    modelLabel: GARMENT_MODEL.label,
    proposals: found.map(({ number, design, revisionId, refusal }) => ({
      number,
      design: design && { id: design.id, displayNumber: design.displayNumber, title: design.title },
      revisionId,
      ...(refusal === null
        ? // No refusal means the design was found, and one such design is what made `sources` be read.
          buildDesignRecipe({ ...sources!, modelLabel: GARMENT_MODEL.label, design: design! })
        : {
            recipe: null,
            colors: [],
            sizes: [],
            skipped: [],
            blockers: [refusal],
            placementDonor: null,
            unverified: [],
          }),
    })),
  }
}
