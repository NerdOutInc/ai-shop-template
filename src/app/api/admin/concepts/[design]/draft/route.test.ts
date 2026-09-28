// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DesignDraftError } from "@/features/design-products/design-draft-error"

import { GET, POST, maxDuration } from "./route"

const { getAdminActor, proposeAdminDesignDraft, runAdminDesignDraft, env } = vi.hoisted(() => ({
  getAdminActor: vi.fn(),
  proposeAdminDesignDraft: vi.fn(),
  runAdminDesignDraft: vi.fn(),
  env: { VERCEL_ENV: "production", VERCEL_URL: "preview.vercel.app" },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor }))
vi.mock("@/features/design-products/propose-admin-design-draft.server", () => ({ proposeAdminDesignDraft }))
vi.mock("@/features/design-products/run-admin-design-draft.server", () => ({ runAdminDesignDraft }))
vi.mock("@/lib/env", () => ({ env }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))

const designId = "5a0c8f6e-3a63-4f56-9f0b-0b8f4d1f7a22"
const revisionId = "c2b7f1d4-6a4f-4b8b-8a55-2f1d9d0c3b33"
const requestId = "adf15313-8c0a-47a0-96c2-a891e4d531c1"
const context = (design = designId) => ({ params: Promise.resolve({ design }) })
const step = { action: "create", requestId, displayNumber: 149, revisionId }
const draft = { designId, status: "draft", message: "Draft", productId: "product-a" }

function review(query = `number=149&revision=${revisionId}`) {
  return new Request(`http://0.0.0.0:3000/api/admin/concepts/${designId}/draft?${query}`)
}
function post(body: unknown = step, origin: string | null = "https://store.example") {
  return new Request(`http://0.0.0.0:3000/api/admin/concepts/${designId}/draft`, {
    method: "POST",
    headers: { ...(origin ? { origin } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  getAdminActor.mockResolvedValue({ userId: "owner" })
  proposeAdminDesignDraft.mockResolvedValue({
    design: { id: designId, displayNumber: 149, title: "Good Holds" },
    modelLabel: "Next Level 6210",
    proposal: {
      recipe: { description: "never sent to the browser" },
      colors: ["CVC Black"],
      sizes: [{ size: "M", price: 2800 }],
      skipped: [],
      blockers: [],
      placementDonor: {
        productId: "published-reference",
        title: "Sample Garden Illustration",
        placement: { position: "front", x: 0.5, y: 0.4, scale: 0.63, angle: 0 },
      },
      unverified: ["variants[].price", "placement"],
    },
  })
  runAdminDesignDraft.mockResolvedValue({ requestId, pending: 0, results: [{ designId: "other" }, draft] })
})

describe("reviewing a draft", () => {
  it("answers with what would be created, without the recipe itself", async () => {
    const response = await GET(review(), context())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      title: "Good Holds",
      modelLabel: "Next Level 6210",
      colors: ["CVC Black"],
      sizes: [{ size: "M", price: 2800 }],
      skipped: [],
      blockers: [],
      placementDonor: {
        productId: "published-reference",
        title: "Sample Garden Illustration",
        placement: { position: "front", x: 0.5, y: 0.4, scale: 0.63, angle: 0 },
      },
      unverified: ["variants[].price", "placement"],
    })
    expect(proposeAdminDesignDraft).toHaveBeenCalledWith(
      "owner",
      { designId, displayNumber: 149, revisionId },
      expect.anything()
    )
    expect(response.headers.get("Cache-Control")).toContain("no-store")
  })
  it("needs an administrator and a whole design reference", async () => {
    expect((await GET(review("number=149"), context())).status).toBe(404)
    expect((await GET(review("number=0&revision=" + revisionId), context())).status).toBe(404)
    expect((await GET(review(), context("not-a-uuid"))).status).toBe(404)
    getAdminActor.mockResolvedValue(null)
    expect((await GET(review(), context())).status).toBe(401)
    expect(proposeAdminDesignDraft).not.toHaveBeenCalled()
  })
})

describe("creating a draft", () => {
  it("runs one step as the signed-in administrator and answers for this design only", async () => {
    const response = await POST(post(), context())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ requestId, pending: 0, result: draft })
    expect(runAdminDesignDraft).toHaveBeenCalledWith("owner", { ...step, designId }, expect.anything())
    expect(maxDuration).toBe(60)
  })
  it("refuses another site's form, a signed-out visitor and a malformed step before any draft work", async () => {
    expect((await POST(post(step, "https://evil.example"), context())).status).toBe(403)
    expect((await POST(post(step, null), context())).status).toBe(403)
    expect((await POST(post({ ...step, action: "publish" }), context())).status).toBe(400)
    expect((await POST(post({ ...step, recipe: {} }), context())).status).toBe(400)
    expect((await POST(post(), context("not-a-uuid"))).status).toBe(404)
    getAdminActor.mockResolvedValue(null)
    expect((await POST(post(), context())).status).toBe(401)
    expect(runAdminDesignDraft).not.toHaveBeenCalled()
  })
  it.each([
    ["INVALID_INPUT", 400],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["PROVIDER_REJECTED", 502],
    ["PROVIDER_UNAVAILABLE", 503],
  ] as const)("passes a %s draft refusal through in the owner's words", async (code, status) => {
    runAdminDesignDraft.mockRejectedValue(new DesignDraftError(code, "Assign this design's garment colors first"))
    const response = await POST(post(), context())
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: "Assign this design's garment colors first" })
  })
  it("says nothing of an unexpected failure's details", async () => {
    runAdminDesignDraft.mockRejectedValue(new Error("connect ECONNREFUSED postgres://secret"))
    const response = await POST(post(), context())
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain("secret")
  })
})
