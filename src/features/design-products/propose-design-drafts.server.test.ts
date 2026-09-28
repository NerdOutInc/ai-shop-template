// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest"

import type { LibraryDesign } from "@/features/design-library/library-types"

import type { PublishedProductRecipe } from "./list-published-product-recipes.server"

import { proposeDesignDrafts } from "./propose-design-drafts.server"
import { validateDesignDraftInput } from "./validate-design-draft-input"

const { env } = vi.hoisted(() => ({ env: { PRINTIFY_DRAFTS_API_TOKEN: "", PRINTIFY_SHOP_ID: "42" } }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env }))

const current = "c2b7f1d4-6a4f-4b8b-8a55-2f1d9d0c3b33"
const pinned = "0e9d3c1a-7b52-4c6e-9a14-8d2f6b3e5c77"
const beard = {
  id: "5a0c8f6e-3a63-4f56-9f0b-0b8f4d1f7a22",
  displayNumber: 149,
  title: "Sample Character",
  summary: "A very optimistic pattern.",
  state: "active",
  revision: { id: current },
  revisions: [{ id: current }, { id: pinned }],
  favoriteRevisionId: null,
  colors: [{ name: "CVC Black", position: 0, source: "assigned" }],
} as unknown as LibraryDesign
const sloth = {
  ...beard,
  id: "8f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  displayNumber: 211,
  title: "Sample Calm Scene",
  colors: [
    { name: "Sand", position: 1, source: "assigned" },
    { name: "CVC Midnight Navy", position: 0, source: "assigned" },
  ],
} as unknown as LibraryDesign
const tee: PublishedProductRecipe = {
  blueprintId: 1317,
  printProviderId: 99,
  productIds: ["a"],
  titles: [],
  // The published tee is navy only: exactly the colors an agent used to be stuck with.
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
const getDesign = vi.fn()
const listModels = vi.fn()
const listCatalogVariants = vi.fn()
const options = { getDesign, listModels, listCatalogVariants }
beforeEach(() => {
  vi.resetAllMocks()
  env.PRINTIFY_DRAFTS_API_TOKEN = ""
  getDesign.mockImplementation(async (_userId: string, number: number) =>
    number === 149 ? beard : number === 211 ? sloth : null
  )
  listModels.mockResolvedValue([tee])
  listCatalogVariants.mockResolvedValue([
    { id: 101, color: "CVC Black", size: "M", available: true },
    { id: 102, color: "CVC Midnight Navy", size: "M", available: true },
    { id: 103, color: "Sand", size: "M", available: false },
  ])
})

it("gives each design its own colors rather than the published tee's", async () => {
  const { modelLabel, proposals } = await proposeDesignDrafts("owner", { numbers: [149, 211] }, options)
  expect(modelLabel).toBe("Next Level 6210")
  expect(proposals.map(({ number, colors }) => [number, colors])).toEqual([
    [149, ["CVC Black"]],
    [211, ["CVC Midnight Navy"]],
  ])
  expect(proposals[0]!.recipe?.variants).toEqual([{ id: 101, price: 2800, color: "CVC Black", size: "M" }])
  // A garment Printify cannot make is named and left out, where the agent can see it before reserving.
  expect(proposals[1]!.skipped).toEqual([{ color: "Sand", size: null, reason: "No size of this color is available" }])
})

it("reads the shop and Printify once for the whole page", async () => {
  await proposeDesignDrafts("owner", { numbers: [149, 211, 149] }, options)
  expect(getDesign).toHaveBeenCalledTimes(2)
  expect(listModels).toHaveBeenCalledTimes(1)
  expect(listCatalogVariants).toHaveBeenCalledTimes(1)
})

it("carries the selected placement reference and uncertainty into every design's proposal", async () => {
  const { proposals } = await proposeDesignDrafts("owner", { numbers: [149, 211] }, options)
  for (const proposal of proposals) {
    expect(proposal.placementDonor).toEqual({
      productId: "a",
      title: "Sample Garden Illustration",
      placement: tee.placement,
    })
    expect(proposal.unverified).toEqual(["variants[].price", "placement"])
    expect(proposal.recipe?.placement).toEqual(proposal.placementDonor?.placement)
  }
})

it("answers with a recipe drafts.create accepts as it stands", async () => {
  const [proposal] = (await proposeDesignDrafts("owner", { numbers: [149] }, options)).proposals
  const input = {
    requestId: "bcf9282a-9002-4e4c-91ae-fcc3224d73f0",
    selection: { kind: "revisions", items: [{ designId: proposal!.design!.id, revisionId: proposal!.revisionId }] },
    recipe: proposal!.recipe,
  }
  expect(validateDesignDraftInput(input)).toEqual(input)
})

it("names the revision a numbered selection would freeze: the owner's pinned favorite first", async () => {
  getDesign.mockResolvedValue({ ...beard, favoriteRevisionId: pinned })
  expect((await proposeDesignDrafts("owner", { numbers: [149] }, options)).proposals[0]!.revisionId).toBe(pinned)
  getDesign.mockResolvedValue(beard)
  expect((await proposeDesignDrafts("owner", { numbers: [149] }, options)).proposals[0]!.revisionId).toBe(current)
})

it.each([
  ["a number that finds nothing", null, "Design #149 is not in this library"],
  ["an archived design", { ...beard, state: "archived" }, "Restore this design"],
  ["a design with no artwork revision", { ...beard, revision: null }, "no artwork revision"],
  ["a design with no assigned colors", { ...beard, colors: [] }, "Assign this design's garment colors first"],
])("refuses %s in its own blockers without failing its neighbor", async (_case, found, blocker) => {
  getDesign.mockImplementation(async (_userId: string, number: number) => (number === 149 ? found : sloth))
  const { proposals } = await proposeDesignDrafts("owner", { numbers: [149, 211] }, options)
  expect(proposals[0]).toMatchObject({ number: 149, recipe: null })
  expect(proposals[0]!.blockers.join(" ")).toContain(blocker)
  expect(proposals[1]!.recipe).not.toBeNull()
})

it("asks the shop and Printify nothing when no design could be drafted anyway", async () => {
  const { proposals } = await proposeDesignDrafts("owner", { numbers: [7, 8] }, options)
  expect(proposals.map(({ design, recipe }) => [design, recipe])).toEqual([
    [null, null],
    [null, null],
  ])
  expect(proposals.map(({ placementDonor, unverified }) => ({ placementDonor, unverified }))).toEqual([
    { placementDonor: null, unverified: [] },
    { placementDonor: null, unverified: [] },
  ])
  expect(listModels).not.toHaveBeenCalled()
  expect(listCatalogVariants).not.toHaveBeenCalled()
})

it("blocks every design, and skips Printify, when no tee of the model has been published", async () => {
  listModels.mockResolvedValue([{ ...tee, blueprintId: 77 }])
  const { proposals } = await proposeDesignDrafts("owner", { numbers: [149, 211] }, options)
  for (const proposal of proposals) {
    expect(proposal.recipe).toBeNull()
    expect(proposal.blockers.join(" ")).toContain("Publish one Next Level 6210 tee first")
  }
  expect(listCatalogVariants).not.toHaveBeenCalled()
})

it("says plainly when the store has no draft access, rather than proposing from a guess", async () => {
  await expect(proposeDesignDrafts("owner", { numbers: [149] }, { getDesign, listModels })).rejects.toMatchObject({
    code: "INVALID_INPUT",
    message: expect.stringContaining("Printify draft access is not configured"),
  })
  expect(listModels).not.toHaveBeenCalled()
})
