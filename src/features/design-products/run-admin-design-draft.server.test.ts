// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest"

import type { DesignDraftInput, DesignDraftResult } from "./design-draft-types"

import { runAdminDesignDraft } from "./run-admin-design-draft.server"

vi.mock("server-only", () => ({}))

const userId = "0b1f5a52-9d0e-4f0c-8f2e-6f6f0e0d1a11"
const step = {
  action: "create" as const,
  requestId: "adf15313-8c0a-47a0-96c2-a891e4d531c1",
  designId: "5a0c8f6e-3a63-4f56-9f0b-0b8f4d1f7a22",
  displayNumber: 149,
  revisionId: "c2b7f1d4-6a4f-4b8b-8a55-2f1d9d0c3b33",
}
const recipe: DesignDraftInput["recipe"] = {
  blueprintId: 1317,
  productModelLabel: "Next Level 6210",
  printProviderId: 99,
  variants: [{ id: 101, price: 2800, color: "CVC Black", size: "M" }],
  placement: { position: "front", x: 0.5, y: 0.4, scale: 0.63, angle: 0 },
  description: "<p>Tee</p>",
  titleTemplate: "{title}",
}
const result = (status: DesignDraftResult["status"], owningRequestId: string | null = null): DesignDraftResult => ({
  designId: step.designId,
  requestedRevisionId: step.revisionId,
  boundRevisionId: null,
  productId: null,
  status,
  message: status,
  storefrontUrl: null,
  blockingProductIds: [],
  owningRequestId,
})
const outcome = (requestId: string, entry: DesignDraftResult) => ({
  requestId,
  results: [entry],
  pending: entry.status === "busy" ? 1 : 0,
})
const services = { create: vi.fn(), reconcile: vi.fn(), frozenInput: vi.fn() }
const propose = vi.fn()
const proposal = (overrides: object = {}) => ({
  proposal: { recipe, colors: ["CVC Black"], sizes: [], skipped: [], blockers: [], ...overrides },
})
beforeEach(() => vi.resetAllMocks())

it("freezes a new request from the proposed recipe and this exact revision", async () => {
  services.frozenInput.mockResolvedValue(null)
  propose.mockResolvedValue(proposal())
  services.create.mockResolvedValue(outcome(step.requestId, result("draft")))
  expect((await runAdminDesignDraft(userId, step, { services, propose })).results[0]?.status).toBe("draft")
  expect(services.create).toHaveBeenCalledWith({
    requestId: step.requestId,
    selection: { kind: "revisions", items: [{ designId: step.designId, revisionId: step.revisionId }] },
    recipe,
  })
})

it("continues a request from its own frozen input, never from a recipe rebuilt now", async () => {
  const frozen = {
    requestId: step.requestId,
    selection: { kind: "favorites" },
    recipe: { ...recipe, description: "x" },
  }
  services.frozenInput.mockResolvedValue(frozen)
  services.create.mockResolvedValue(outcome(step.requestId, result("busy")))
  await runAdminDesignDraft(userId, step, { services, propose })
  expect(propose).not.toHaveBeenCalled()
  expect(services.create).toHaveBeenCalledWith(frozen)
})

it("refuses with the blockers, reserving nothing, when there is no recipe to offer", async () => {
  services.frozenInput.mockResolvedValue(null)
  propose.mockResolvedValue(proposal({ recipe: null, blockers: ["Assign colors first", "No size guide"] }))
  await expect(runAdminDesignDraft(userId, step, { services, propose })).rejects.toThrow(
    "Assign colors first. No size guide"
  )
  expect(services.create).not.toHaveBeenCalled()
})

it("carries on this owner's earlier unfinished request instead of stranding it", async () => {
  const earlier = { requestId: "11111111-1111-4111-8111-111111111111", selection: { kind: "favorites" }, recipe }
  services.frozenInput.mockImplementation(async ({ requestId }) => (requestId === earlier.requestId ? earlier : null))
  propose.mockResolvedValue(proposal())
  services.create
    .mockResolvedValueOnce(outcome(step.requestId, result("reserved-elsewhere", earlier.requestId)))
    .mockResolvedValueOnce(outcome(earlier.requestId, result("draft")))
  const carried = await runAdminDesignDraft(userId, step, { services, propose })
  expect(carried.requestId).toBe(earlier.requestId)
  expect(services.create).toHaveBeenLastCalledWith(earlier)
})

it("leaves another owner's reservation alone", async () => {
  services.frozenInput.mockResolvedValue(null)
  propose.mockResolvedValue(proposal())
  services.create.mockResolvedValue(outcome(step.requestId, result("reserved-elsewhere")))
  expect((await runAdminDesignDraft(userId, step, { services, propose })).results[0]?.status).toBe("reserved-elsewhere")
  expect(services.create).toHaveBeenCalledTimes(1)
})

it("reconciles by provider reads only, never creating", async () => {
  services.reconcile.mockResolvedValue(outcome(step.requestId, result("draft")))
  await runAdminDesignDraft(userId, { ...step, action: "reconcile" }, { services, propose })
  expect(services.reconcile).toHaveBeenCalledWith({ requestId: step.requestId })
  expect(services.create).not.toHaveBeenCalled()
  expect(propose).not.toHaveBeenCalled()
})
