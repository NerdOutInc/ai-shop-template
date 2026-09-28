// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest"

import type { LibraryDesign } from "@/features/design-library/library-types"

import type { PublishedProductRecipe } from "./list-published-product-recipes.server"

import { proposeAdminDesignDraft } from "./propose-admin-design-draft.server"

const { env } = vi.hoisted(() => ({ env: { PRINTIFY_DRAFTS_API_TOKEN: "", PRINTIFY_SHOP_ID: "42" } }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env }))

const revisionId = "c2b7f1d4-6a4f-4b8b-8a55-2f1d9d0c3b33"
const design = {
  id: "5a0c8f6e-3a63-4f56-9f0b-0b8f4d1f7a22",
  displayNumber: 149,
  title: "Good Holds",
  summary: "A very optimistic pattern.",
  state: "active",
  revisions: [{ id: revisionId }],
  colors: [{ name: "CVC Black", position: 0, source: "assigned" }],
} as unknown as LibraryDesign
const tee: PublishedProductRecipe = {
  blueprintId: 1317,
  printProviderId: 99,
  productIds: ["a"],
  titles: [],
  variants: [{ id: 11, price: 2800, color: "CVC Midnight Navy", size: "M" }],
  placement: { position: "front", x: 0.5, y: 0.4, scale: 0.63, angle: 0 },
  placementDonorProductId: "a",
  placementDonorTitle: "Sample Garden Illustration",
  sizeGuideDonor: {
    productId: "a",
    title: "Sample Garden Illustration",
    description:
      '<p><strong>The tee</strong></p><table id="size-guide"><tr><th></th><th>M</th></tr><tr><td>Width, in</td><td>20.50</td></tr></table>',
    sizes: ["M"],
  },
  unverified: ["variants[].price", "placement"],
  blocked: [],
}
const input = { designId: design.id, displayNumber: 149, revisionId }
const getDesign = vi.fn()
const listModels = vi.fn()
const listCatalogVariants = vi.fn()
const options = { getDesign, listModels, listCatalogVariants }
beforeEach(() => {
  vi.resetAllMocks()
  env.PRINTIFY_DRAFTS_API_TOKEN = ""
  getDesign.mockResolvedValue(design)
  listModels.mockResolvedValue([{ ...tee, blueprintId: 77 }, tee])
  listCatalogVariants.mockResolvedValue([{ id: 101, color: "CVC Black", size: "M", available: true }])
})

it("proposes the library's own garment model from the shop's published tee of it", async () => {
  const { proposal, modelLabel } = await proposeAdminDesignDraft("owner", input, options)
  expect(modelLabel).toBe("Next Level 6210")
  expect(proposal.recipe).toMatchObject({ blueprintId: 1317, printProviderId: 99 })
  expect(proposal.recipe?.variants).toEqual([{ id: 101, price: 2800, color: "CVC Black", size: "M" }])
  expect(proposal.placementDonor).toEqual({
    productId: "a",
    title: "Sample Garden Illustration",
    placement: tee.placement,
  })
  expect(proposal.unverified).toEqual(["variants[].price", "placement"])
  expect(listCatalogVariants).toHaveBeenCalledWith({
    blueprintId: 1317,
    printProviderId: 99,
    position: "front",
  })
})

it("asks Printify nothing when no tee of the model has been published", async () => {
  listModels.mockResolvedValue([{ ...tee, blueprintId: 77 }])
  const { proposal } = await proposeAdminDesignDraft("owner", input, options)
  expect(proposal.blockers.join(" ")).toContain("Publish one Next Level 6210 tee first")
  expect(proposal.placementDonor).toBeNull()
  expect(proposal.unverified).toEqual([])
  expect(listCatalogVariants).not.toHaveBeenCalled()
})

it.each([
  ["a design that is gone", null],
  ["a number that now means another design", { ...design, id: "11111111-1111-4111-8111-111111111111" }],
  ["a revision that is not this design's", { ...design, revisions: [] }],
])("finds nothing for %s", async (_case, found) => {
  getDesign.mockResolvedValue(found)
  await expect(proposeAdminDesignDraft("owner", input, options)).rejects.toMatchObject({ code: "NOT_FOUND" })
  expect(listModels).not.toHaveBeenCalled()
})

it("will not make a product of an archived design", async () => {
  getDesign.mockResolvedValue({ ...design, state: "archived" })
  await expect(proposeAdminDesignDraft("owner", input, options)).rejects.toThrow("Restore this design")
})

it("says plainly when the store has no draft access, before reading anything else", async () => {
  await expect(proposeAdminDesignDraft("owner", input, { getDesign, listModels })).rejects.toThrow(
    "Printify draft access is not configured"
  )
  expect(listModels).not.toHaveBeenCalled()
})
