// @vitest-environment node
import type { Pool } from "pg"
import { beforeEach, describe, it, expect, vi } from "vitest"
import { executeDesignAgentCommand } from "./execute-design-agent-command.server"
import { getDesignAgentCommandScope } from "./get-design-agent-command-scope"
import { designDraftInput } from "../../../test/design-draft-input"
import type { getDesignDraftServices } from "@/features/design-products/get-design-draft-services.server"
const {
  active,
  owned,
  issue,
  verify,
  finalize,
  listDesigns,
  draftServices,
  createDraft,
  reconcileDraft,
  reconcileBinding,
  getPublishingStore,
  listRecipes,
  proposeDrafts,
  getDesign,
  refreshStorefront,
} = vi.hoisted(() => ({
  active: vi.fn(),
  owned: vi.fn(),
  issue: vi.fn(),
  verify: vi.fn(),
  finalize: vi.fn(),
  listDesigns: vi.fn(),
  draftServices: vi.fn(),
  createDraft: vi.fn(),
  reconcileDraft: vi.fn(),
  reconcileBinding: vi.fn(),
  getPublishingStore: vi.fn(),
  listRecipes: vi.fn(),
  proposeDrafts: vi.fn(),
  getDesign: vi.fn(),
  refreshStorefront: vi.fn(),
}))
vi.mock("server-only", () => ({}))
// The real policy, wrapped only so one test can step past it to reach the executor's own guard.
vi.mock("./get-design-agent-command-scope", async (importOriginal) => {
  const original = await importOriginal<typeof import("./get-design-agent-command-scope")>()
  return { getDesignAgentCommandScope: vi.fn(original.getDesignAgentCommandScope) }
})
vi.mock("@/features/publishing/get-publishing-store.server", () => ({ getPublishingStore }))
vi.mock("@/features/design-of-the-week/refresh-storefront.server", () => ({ refreshStorefront }))
vi.mock("@/features/design-products/list-published-product-recipes.server", () => ({
  listPublishedProductRecipes: listRecipes,
}))
vi.mock("@/features/design-products/propose-design-drafts.server", () => ({ proposeDesignDrafts: proposeDrafts }))
vi.mock("./design-agent-grant-store.server", () => ({
  DesignAgentGrantStore: class {
    requireActive = active
  },
}))
vi.mock("./design-generation-store.server", () => ({
  DesignGenerationStore: class {
    ownedAsset = owned
  },
}))
vi.mock("@/features/design-library/postgres-library-store.server", () => ({
  createPostgresLibraryStore: () => ({ finalizeAsset: finalize, listDesigns, getDesign }),
}))
vi.mock("@/features/design-library/issue-private-asset-upload.server", () => ({ issuePrivateAssetUpload: issue }))
vi.mock("@/features/design-library/verify-private-asset-upload.server", () => ({ verifyPrivateAssetUpload: verify }))
vi.mock("@/features/design-products/get-design-draft-services.server", () => ({
  getDesignDraftServices: draftServices,
}))
const actor = { userId: "owner", grantId: "grant" },
  database = {} as Pool
beforeEach(() => {
  vi.clearAllMocks()
  active.mockResolvedValue(undefined)
  owned.mockResolvedValue({ id: "asset", status: "pending", sha256: "hash", bytes: 50 })
  issue.mockResolvedValue({ token: "scoped", pathname: "immutable" })
  verify.mockResolvedValue({ assetId: "asset", pathname: "immutable" })
  listDesigns.mockResolvedValue({ designs: [], total: 0 })
  finalize.mockResolvedValue(undefined)
  draftServices.mockReturnValue({ create: createDraft, reconcile: reconcileDraft, reconcileBinding })
})
it("constrains upload issuance to the owned registered asset and checks the grant immediately before issuance", async () => {
  await executeDesignAgentCommand(database, actor, { command: "asset.upload", batchId: "batch", assetId: "asset" })
  expect(owned).toHaveBeenCalledWith(actor, "batch", "asset")
  expect(active).toHaveBeenCalledTimes(2)
  expect(issue).toHaveBeenCalledWith(expect.objectContaining({ id: "asset" }))
})
it("a revoked grant after byte verification cannot finalize a library record", async () => {
  active.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("revoked"))
  await expect(
    executeDesignAgentCommand(database, actor, { command: "asset.finalize", batchId: "batch", assetId: "asset" })
  ).rejects.toThrow("revoked")
  expect(verify).toHaveBeenCalled()
  expect(finalize).not.toHaveBeenCalled()
})
it("an asset outside the active batch cannot receive an upload credential", async () => {
  owned.mockRejectedValue(new Error("not owned"))
  await expect(
    executeDesignAgentCommand(database, actor, { command: "asset.upload", batchId: "batch", assetId: "other" })
  ).rejects.toThrow("not owned")
  expect(issue).not.toHaveBeenCalled()
})
it("binds draft favorites and every subsequent provider authorization to the grant owner", async () => {
  const signal = new AbortController().signal
  createDraft.mockImplementationOnce(async () => {
    const options = draftServices.mock.calls[0]![0] as Parameters<typeof getDesignDraftServices>[0]
    active.mockRejectedValueOnce(new Error("revoked during draft work"))
    await options.authorize()
  })
  await expect(
    executeDesignAgentCommand(database, actor, { command: "drafts.create", input: designDraftInput }, { signal })
  ).rejects.toThrow("revoked during draft work")
  expect(draftServices).toHaveBeenCalledWith({ ...actor, database, signal, authorize: expect.any(Function) })
  expect(createDraft).toHaveBeenCalledWith(designDraftInput)
  expect(active.mock.calls).toEqual([
    [actor, "drafts:create"],
    [actor, "drafts:create"],
  ])
})
it("denies drafts before constructing provider services when draft authority is absent", async () => {
  active.mockRejectedValueOnce(new Error("missing drafts:create"))
  await expect(
    executeDesignAgentCommand(database, actor, { command: "drafts.create", input: designDraftInput })
  ).rejects.toThrow("missing drafts:create")
  expect(draftServices).not.toHaveBeenCalled()
  expect(createDraft).not.toHaveBeenCalled()
})
it("routes recovery commands to read-and-reconcile operations without a new create", async () => {
  await executeDesignAgentCommand(database, actor, {
    command: "drafts.reconcile",
    requestId: designDraftInput.requestId,
  })
  await executeDesignAgentCommand(database, actor, { command: "drafts.reconcileBinding", bindingId: "binding" })
  expect(reconcileDraft).toHaveBeenCalledWith({ requestId: designDraftInput.requestId })
  expect(reconcileBinding).toHaveBeenCalledWith({ bindingId: "binding" })
  expect(createDraft).not.toHaveBeenCalled()
})

describe("proposing drafts in each design's own colors", () => {
  const proposals = { modelLabel: "Next Level 6210", proposals: [{ number: 149, recipe: null, blockers: ["No"] }] }
  beforeEach(() => proposeDrafts.mockResolvedValue(proposals))

  // Reading first is the whole point: a binding cannot be redone for different colors.
  it("answers for the grant owner without constructing anything that could reserve or write", async () => {
    const signal = new AbortController().signal
    expect(
      await executeDesignAgentCommand(database, actor, { command: "drafts.propose", numbers: [149, 211] }, { signal })
    ).toEqual(proposals)
    expect(proposeDrafts).toHaveBeenCalledWith(
      "owner",
      { numbers: [149, 211] },
      { signal, getDesign: expect.any(Function) }
    )
    expect(draftServices).not.toHaveBeenCalled()
    expect(createDraft).not.toHaveBeenCalled()
  })

  // The freeze and library.get both see pending collections; a proposal that could not would refuse
  // a design the very next command accepts.
  it("finds designs the way library.get and the draft freeze do, through this request's database", async () => {
    await executeDesignAgentCommand(database, actor, { command: "drafts.propose", numbers: [149] })
    const options = proposeDrafts.mock.calls[0]![2] as { getDesign: (userId: string, number: number) => unknown }
    await options.getDesign("owner", 149)
    expect(getDesign).toHaveBeenCalledWith("owner", 149, { includePending: true })
  })

  it("is denied before anything is read when the grant lacks draft authority", async () => {
    active.mockRejectedValueOnce(new Error("missing drafts:create"))
    await expect(
      executeDesignAgentCommand(database, actor, { command: "drafts.propose", numbers: [149] })
    ).rejects.toThrow("missing drafts:create")
    expect(active).toHaveBeenCalledWith(actor, "drafts:create")
    expect(proposeDrafts).not.toHaveBeenCalled()
  })
})

it("asks for the owner's favorites in every design state", async () => {
  await executeDesignAgentCommand(database, actor, { command: "library.favorites", offset: 0, limit: 50 })
  // The library hides archived designs by default. A favorite the owner archived is still
  // a favorite, and this list is what product creation is handed.
  expect(listDesigns).toHaveBeenCalledWith(
    actor.userId,
    expect.objectContaining({ favoritesOnly: true, designState: "all" })
  )
})

describe("a command neither switch names", () => {
  // Only reachable if the parser and these switches drift apart, which the compiler cannot see at runtime.
  const bogus = { command: "products.publish" } as unknown as Parameters<typeof executeDesignAgentCommand>[2]

  it("is refused before any grant is consulted", async () => {
    await expect(executeDesignAgentCommand(database, actor, bogus)).rejects.toMatchObject({ code: "INVALID_INPUT" })
    expect(active).not.toHaveBeenCalled()
  })

  // Even with a scope in hand it must not fall out of the switch and be answered with HTTP 200.
  it("is refused by the executor itself rather than echoed back", async () => {
    vi.mocked(getDesignAgentCommandScope).mockReturnValueOnce("library:read")
    await expect(executeDesignAgentCommand(database, actor, bogus)).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "Unknown command",
    })
    expect(active).toHaveBeenCalledWith(actor, "library:read")
  })
})

describe("read-only product recipes", () => {
  it("still reads the published catalogue without touching a Printify token", async () => {
    listRecipes.mockResolvedValue({ productsRead: 2, models: [], skipped: [] })
    expect(await executeDesignAgentCommand(database, actor, { command: "products.recipes" })).toEqual({
      productsRead: 2,
      models: [],
      skipped: [],
    })
    expect(draftServices).not.toHaveBeenCalled()
  })
})
