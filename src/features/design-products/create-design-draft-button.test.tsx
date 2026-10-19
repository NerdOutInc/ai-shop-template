import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CreateDesignDraftButton } from "./create-design-draft-button"

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const designId = "5a0c8f6e-3a63-4f56-9f0b-0b8f4d1f7a22"
const revisionId = "c2b7f1d4-6a4f-4b8b-8a55-2f1d9d0c3b33"
const proposal = {
  title: "Good Holds",
  modelLabel: "Next Level 6210",
  colors: ["CVC Black", "Heather Maroon"],
  sizes: [
    { size: "M", price: 2800 },
    { size: "2XL", price: 3200 },
  ],
  skipped: [{ color: "Heather Maroon", size: "2XL", reason: "Printify cannot make it right now" }],
  blockers: [] as string[],
  placementDonor: {
    productId: "published-reference",
    title: "Sample Garden Illustration",
    placement: { position: "front", x: 0.5, y: 0.4, scale: 0.63, angle: 0 },
  },
  unverified: ["variants[].price"],
}
const answer = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body })
const result = (status: string, extra: object = {}) => ({
  designId,
  status,
  message: `The pipeline's own words about ${status}`,
  owningRequestId: null,
  ...extra,
})
const button = () => <CreateDesignDraftButton designId={designId} displayNumber={149} revisionId={revisionId} />
const posted = (request: ReturnType<typeof vi.fn>, call: number) =>
  JSON.parse(String(request.mock.calls[call]?.[1]?.body))

describe("CreateDesignDraftButton", () => {
  it("shows what would be created, and reserves nothing until the owner confirms", async () => {
    const request = vi.fn().mockResolvedValue(answer(proposal))
    vi.stubGlobal("fetch", request)
    render(button())
    await userEvent.click(screen.getByRole("button", { name: "Create Printify draft" }))
    expect(await screen.findByRole("heading", { name: "Good Holds on Next Level 6210" })).toBeVisible()
    expect(screen.getByText("Black, Heather Maroon")).toBeVisible()
    expect(screen.getByText("M $28.00, 2XL $32.00")).toBeVisible()
    expect(screen.getByText("Heather Maroon, 2XL: Printify cannot make it right now")).toBeVisible()
    expect(screen.getByText("Sample Garden Illustration")).toBeVisible()
    expect(screen.getByText("Printify product published-reference")).toBeVisible()
    expect(screen.queryByText("Review the placement")).not.toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(1)
    expect(String(request.mock.calls[0]?.[0])).toBe(
      `/api/admin/concepts/${designId}/draft?number=149&revision=${revisionId}`
    )
    expect(request.mock.calls[0]?.[1]?.method).toBeUndefined()
    // The trigger and the review replace one another, so focus is carried rather than dropped.
    expect(screen.getByRole("heading", { name: "Good Holds on Next Level 6210" })).toHaveFocus()
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.getByRole("button", { name: "Create Printify draft" })).toHaveFocus()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it("names the copied reference and warns about differing placements before any create", async () => {
    const request = vi.fn().mockResolvedValue(answer({ ...proposal, unverified: ["variants[].price", "placement"] }))
    vi.stubGlobal("fetch", request)
    render(button())
    await userEvent.click(screen.getByRole("button", { name: "Create Printify draft" }))
    expect(await screen.findByText("Sample Garden Illustration")).toBeVisible()
    expect(screen.getByText(/Published tees of this model use different placements/)).toBeVisible()
    expect(screen.getByRole("button", { name: "Create draft" })).toBeEnabled()
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]?.[1]?.method).toBeUndefined()
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(request).toHaveBeenCalledTimes(1)
  })

  it("identifies an untitled placement reference by its product id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(answer({ ...proposal, placementDonor: { ...proposal.placementDonor, title: null } }))
    )
    render(button())
    await userEvent.click(screen.getByRole("button", { name: "Create Printify draft" }))
    expect(await screen.findByText("Printify product published-reference")).toBeVisible()
    expect(screen.queryByText("Sample Garden Illustration")).not.toBeInTheDocument()
  })

  it("continues the same request until Printify is done, then refreshes the page's product list", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(answer(proposal))
      .mockResolvedValueOnce(answer({ requestId: "r-1", pending: 1, result: result("busy") }))
      .mockResolvedValueOnce(answer({ requestId: "r-1", pending: 0, result: result("draft") }))
    vi.stubGlobal("fetch", request)
    render(button())
    await userEvent.click(screen.getByRole("button", { name: "Create Printify draft" }))
    await userEvent.click(await screen.findByRole("button", { name: "Create draft" }))
    expect(await screen.findByText(/Draft created\. Review its mockups in Printify/)).toBeVisible()
    // One product per design and model: a finished draft leaves nothing here to create again.
    expect(screen.queryByRole("button", { name: "Create Printify draft" })).not.toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(3)
    expect(posted(request, 1)).toMatchObject({ action: "create", displayNumber: 149, revisionId })
    // The first answer's id is the one continued, so a carried-on earlier request is followed.
    expect(posted(request, 2)).toMatchObject({ action: "create", requestId: "r-1" })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it("lists blockers with no way to create past them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(answer({ ...proposal, colors: [], sizes: [], blockers: ["Assign colors first"] }))
    )
    render(button())
    await userEvent.click(screen.getByRole("button", { name: "Create Printify draft" }))
    expect(await screen.findByText("Assign colors first")).toBeVisible()
    expect(screen.queryByRole("button", { name: "Create draft" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Close" })).toBeVisible()
  })

  it("offers a provider re-check, never a second create, for an uncertain draft", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(answer(proposal))
      .mockResolvedValueOnce(
        answer({ requestId: "r-2", pending: 0, result: result("needs-reconciliation", { owningRequestId: "r-1" }) })
      )
      .mockResolvedValueOnce(answer({ requestId: "r-1", pending: 0, result: result("draft") }))
    vi.stubGlobal("fetch", request)
    render(button())
    await userEvent.click(screen.getByRole("button", { name: "Create Printify draft" }))
    await userEvent.click(await screen.findByRole("button", { name: "Create draft" }))
    expect(await screen.findByText("The pipeline's own words about needs-reconciliation")).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: "Check Printify again" }))
    expect(await screen.findByText(/Draft created/)).toBeVisible()
    // The request that owns the reservation is the one reconciled.
    expect(posted(request, 2)).toMatchObject({ action: "reconcile", requestId: "r-1" })
  })

  it("passes a refusal through in the pipeline's words, and warns when the outcome is unknown", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(answer(proposal))
      .mockResolvedValueOnce(answer({ error: "Prepare and verify the transparent PNG first" }, false))
      .mockRejectedValueOnce(new Error("network"))
    vi.stubGlobal("fetch", request)
    render(button())
    await userEvent.click(screen.getByRole("button", { name: "Create Printify draft" }))
    await userEvent.click(await screen.findByRole("button", { name: "Create draft" }))
    expect(await screen.findByText("Prepare and verify the transparent PNG first")).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: "Create draft" }))
    expect(await screen.findByText(/could not be confirmed\. Refresh this page/)).toBeVisible()
    expect(refresh).not.toHaveBeenCalled()
  })

  it("reads as carrying on when an earlier draft of this tee is unfinished", () => {
    render(<CreateDesignDraftButton designId={designId} displayNumber={149} revisionId={revisionId} resuming />)
    expect(screen.getByRole("button", { name: "Continue Printify draft" })).toBeVisible()
  })
})
