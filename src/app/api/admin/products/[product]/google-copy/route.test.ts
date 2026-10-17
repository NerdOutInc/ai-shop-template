// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { prepareGoogleMerchantCopyPreview } from "@/features/merchant-feed/prepare-google-merchant-copy-preview.server"
import { readGoogleMerchantCopyEditor } from "@/features/merchant-feed/read-google-merchant-copy-editor.server"
import { googleMerchantCopyReviewDigest } from "@/features/merchant-feed/google-merchant-copy-review-digest"
import { GET, PUT } from "./route"

const { config, getUser, isActiveMember, connect, query, release, listFeedProfiles, updateGoogleMerchantCopy } =
  vi.hoisted(() => ({
    config: {
      ADMIN_LIBRARY_ENABLED: true,
      PRINTIFY_PUBLISHING_ENABLED: true,
      DATABASE_URL: "postgresql://localhost/mock",
      PRINTIFY_SHOP_ID: "123",
      VERCEL_ENV: "production",
      VERCEL_URL: "preview.vercel.app",
    },
    getUser: vi.fn(),
    isActiveMember: vi.fn(),
    connect: vi.fn(),
    query: vi.fn(),
    release: vi.fn(),
    listFeedProfiles: vi.fn(),
    updateGoogleMerchantCopy: vi.fn(),
  }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env: config }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://shop.example") }))
vi.mock("@/features/admin/get-admin-auth-config.server", () => ({ getAdminAuthConfig: () => ({}) }))
vi.mock("@/features/admin/create-admin-server-client.server", () => ({
  createAdminServerClient: async () => ({ auth: { getUser } }),
}))
vi.mock("@/features/admin/admin-store.server", () => ({
  AdminStore: class {
    isActiveMember = isActiveMember
  },
}))
vi.mock("@/features/admin/get-admin-database.server", () => ({ getAdminDatabase: () => ({ connect }) }))
vi.mock("@/features/publishing/get-publishing-store.server", () => ({
  getPublishingStore: () => ({ garments: { listFeedProfiles }, updateGoogleMerchantCopy }),
}))
let snapshot: Record<string, unknown>
let row: { revision: string; snapshot: Record<string, unknown> | null; active: boolean; blocked: boolean } | undefined
let history: { origin: string | null; boundary: boolean }[]
function request(
  method: string,
  body?: unknown,
  options: { origin?: string | null; product?: string; headers?: Record<string, string>; raw?: string } = {}
) {
  const product = options.product ?? "tee"
  return [
    new Request(`http://0.0.0.0:3000/api/admin/products/${product}/google-copy`, {
      method,
      headers: {
        ...(options.origin === null ? {} : { origin: options.origin ?? "https://shop.example" }),
        "content-type": "application/json",
        ...options.headers,
      },
      ...(method === "GET" ? {} : { body: options.raw ?? JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ product }) },
  ] as const
}
const validUser = { id: "owner", email: "owner@example.test", email_confirmed_at: "2026-10-01", is_anonymous: false }
const previewInput = {
  expectedRevision: "7",
  content: "Explicit reviewed wording.",
  origin: "generated",
  variantIds: [11],
}
async function frozen() {
  const read = await readGoogleMerchantCopyEditor("tee")
  const preview = prepareGoogleMerchantCopyPreview(read, previewInput as never).preview!
  vi.clearAllMocks()
  return {
    expectedRevision: preview.expectedRevision,
    copy: preview.copy,
    digest: preview.digest,
    confirmation: "APPLY_GOOGLE_COPY",
  }
}
function privateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toContain("private, no-store")
  expect(response.headers.get("x-robots-tag")).toContain("noindex")
  expect(response.headers.get("cdn-cache-control")).toBe("no-store")
}
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(config, {
    ADMIN_LIBRARY_ENABLED: true,
    PRINTIFY_PUBLISHING_ENABLED: true,
    DATABASE_URL: "postgresql://localhost/mock",
    PRINTIFY_SHOP_ID: "123",
    VERCEL_ENV: "production",
  })
  getUser.mockResolvedValue({ data: { user: validUser }, error: null })
  isActiveMember.mockResolvedValue(true)
  snapshot = {
    id: "tee",
    shop_id: 123,
    title: "Graphic tee",
    description: "Published story.",
    blueprint_id: 1317,
    print_provider_id: 99,
    visible: true,
    variants: [{ id: 11, price: 2000, options: [1, 2], is_enabled: true, is_available: true }],
    options: [
      { name: "Colors", type: "color", values: [{ id: 1, title: "Navy" }] },
      { name: "Sizes", type: "size", values: [{ id: 2, title: "M" }] },
    ],
    images: [{ src: "https://images.example/tee.jpg", variant_ids: [11], is_default: true }],
    print_areas: [
      {
        variant_ids: [11],
        placeholders: [{ position: "front", images: [{ id: "art", x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
      },
    ],
  }
  row = { revision: "7", snapshot, active: true, blocked: false }
  history = []
  connect.mockResolvedValue({ query, release })
  query.mockImplementation(async (sql: string) => ({
    rows: sql.includes("from commerce.printify_products")
      ? row
        ? [row]
        : []
      : sql.includes("from commerce.printify_product_revisions")
        ? history
        : [],
  }))
  listFeedProfiles.mockResolvedValue(
    new Map([[1317, { googleProductCategory: 212, gender: "unisex", ageGroup: "adult", sizeSystem: "US" }]])
  )
  updateGoogleMerchantCopy.mockResolvedValue({ newRevision: "8" })
})

describe("Google copy initialization and exact frozen Apply", () => {
  it("GET needs no Origin and initializes blank from the saved snapshot", async () => {
    const response = await GET(...request("GET", undefined, { origin: null }))
    expect(response.status).toBe(200)
    privateHeaders(response)
    expect(await response.json()).toMatchObject({
      expectedRevision: "7",
      content: "",
      origin: null,
      variants: [{ id: 11, selected: false }],
    })
    expect(updateGoogleMerchantCopy).not.toHaveBeenCalled()
  })
  it.each(["cross-site", "same-site"])("GET refuses %s fetch metadata before auth", async (site) => {
    const response = await GET(...request("GET", undefined, { headers: { "sec-fetch-site": site } }))
    expect(response.status).toBe(403)
    privateHeaders(response)
    expect(getUser).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })
  it("GET distinctly blocks malformed saved metadata without losing it", async () => {
    snapshot.google_merchant_copy = { content: "PRIVATE", origin: "generated", unknown: true }
    const response = await GET(...request("GET"))
    expect(await response.json()).toMatchObject({ blocked: "GOOGLE_COPY_INVALID_RECORD" })
    expect(snapshot.google_merchant_copy).toHaveProperty("unknown", true)
  })
  it("passes the frozen full object unchanged to the sole writer with committed revision evidence", async () => {
    const input = await frozen()
    const response = await PUT(...request("PUT", input))
    expect(response.status).toBe(200)
    privateHeaders(response)
    expect(await response.json()).toEqual({ newRevision: "8" })
    expect(updateGoogleMerchantCopy).toHaveBeenCalledExactlyOnceWith("tee", "7", input.copy)
  })
  it.each(["content", "revision", "target", "shop", "digest"])(
    "rejects inconsistent %s digest binding before reads or writes",
    async (kind) => {
      const input = await frozen()
      if (kind === "content") input.copy.content += "changed"
      if (kind === "revision") input.expectedRevision = "8"
      if (kind === "shop") config.PRINTIFY_SHOP_ID = "124"
      if (kind === "digest") input.digest = "a".repeat(64)
      const response = await PUT(...request("PUT", input, { product: kind === "target" ? "other" : "tee" }))
      expect(response.status).toBe(409)
      privateHeaders(response)
      expect(connect).not.toHaveBeenCalled()
      expect(updateGoogleMerchantCopy).not.toHaveBeenCalled()
    }
  )
  it.each(["add", "change", "drop", "empty-presence"])(
    "blocks metadata %s even with a recomputed unkeyed digest",
    async (kind) => {
      const input = await frozen()
      if (kind !== "add") snapshot.google_merchant_copy = { ...input.copy, pattern: "Saved graphic", materials: {} }
      if (kind === "add" || kind === "change") input.copy.pattern = "Tampered"
      if (kind === "empty-presence") input.copy.pattern = "Saved graphic"
      input.digest = googleMerchantCopyReviewDigest("123", "tee", "7", input.copy)
      const response = await PUT(...request("PUT", input))
      expect(response.status).toBe(409)
      privateHeaders(response)
      expect(await response.json()).toMatchObject({ code: "GOOGLE_COPY_METADATA_CONFLICT" })
      expect(updateGoogleMerchantCopy).not.toHaveBeenCalled()
    }
  )
  it("rejects metadata tampering with materials values and preserves unchanged metadata", async () => {
    const input = await frozen()
    input.copy.materials = { Navy: "Verified cotton" }
    snapshot.google_merchant_copy = structuredClone(input.copy)
    input.digest = googleMerchantCopyReviewDigest("123", "tee", "7", input.copy)
    expect((await PUT(...request("PUT", input))).status).toBe(200)
    updateGoogleMerchantCopy.mockClear()
    input.copy.materials.Navy = "Tampered"
    input.digest = googleMerchantCopyReviewDigest("123", "tee", "7", input.copy)
    expect((await PUT(...request("PUT", input))).status).toBe(409)
    expect(updateGoogleMerchantCopy).not.toHaveBeenCalled()
  })
  it.each([
    "null",
    "GOOGLE_COPY_INVALID_APPROVAL",
    "GOOGLE_COPY_INVALID_TARGET",
    "GOOGLE_COPY_ORIGIN_DOWNGRADE",
    "GOOGLE_COPY_PROVENANCE_INCOMPLETE",
    "GOOGLE_COPY_UNSUPPORTED_BLUEPRINT",
  ])("maps writer %s guards to fresh-preview conflict, never retrying", async (code) => {
    const input = await frozen()
    if (code === "null") updateGoogleMerchantCopy.mockResolvedValue(null)
    else updateGoogleMerchantCopy.mockRejectedValue(new Error(code))
    const response = await PUT(...request("PUT", input))
    expect(response.status).toBe(409)
    privateHeaders(response)
    expect(updateGoogleMerchantCopy).toHaveBeenCalledOnce()
  })
  it("refuses garment drift without a revision bump and never rebinds frozen identities", async () => {
    const input = await frozen()
    listFeedProfiles.mockResolvedValue(
      new Map([[1317, { googleProductCategory: 212, gender: "male", ageGroup: "adult", sizeSystem: "US" }]])
    )
    expect((await PUT(...request("PUT", input))).status).toBe(409)
    expect(updateGoogleMerchantCopy).not.toHaveBeenCalled()
  })
  it("returns unknown for unexpected writer failures, with no secrets or optimistic success", async () => {
    const input = await frozen()
    updateGoogleMerchantCopy.mockRejectedValue(new Error("PRIVATE postgres://secret"))
    const response = await PUT(...request("PUT", input))
    expect(response.status).toBe(503)
    privateHeaders(response)
    expect(await response.json()).toMatchObject({ code: "GOOGLE_COPY_UNKNOWN" })
    expect(updateGoogleMerchantCopy).toHaveBeenCalledOnce()
  })
  it.each([null, {}, { copy: null }, { confirmation: true }, { confirmation: "yes" }])(
    "rejects missing frozen object/confirmation and unknown shapes before reads",
    async (change) => {
      const input = await frozen()
      const response = await PUT(
        ...request(
          "PUT",
          change === null
            ? null
            : { ...input, ...change, ...(Object.keys(change).length === 0 ? { unknown: true } : {}) }
        )
      )
      expect(response.status).toBe(400)
      privateHeaders(response)
      expect(connect).not.toHaveBeenCalled()
      expect(updateGoogleMerchantCopy).not.toHaveBeenCalled()
    }
  )
  it.each([{ headers: { "content-type": "text/plain" } }, { raw: "x".repeat(65537) }, { raw: "{" }])(
    "bounds Apply content and streams before reads",
    async (options) => {
      const input = await frozen()
      const response = await PUT(...request("PUT", input, options))
      expect(response.status).toBe(400)
      privateHeaders(response)
      expect(connect).not.toHaveBeenCalled()
    }
  )
  it("refuses stale revisions, missing/inactive targets and callback work before the writer", async () => {
    const input = await frozen()
    for (const kind of ["stale", "inactive", "callback", "missing"]) {
      row = {
        revision: kind === "stale" ? "8" : "7",
        snapshot,
        active: kind !== "inactive",
        blocked: kind === "callback",
      }
      if (kind === "missing") row = undefined
      const response = await PUT(...request("PUT", input))
      expect(response.status, kind).toBe(409)
      privateHeaders(response)
      expect(updateGoogleMerchantCopy).not.toHaveBeenCalled()
    }
  })
})

describe("current-admin boundary", () => {
  it.each(["signed-out", "inactive", "revoked", "banned", "anonymous", "unconfirmed"])(
    "GET rejects %s before publishing and private reads",
    async (kind) => {
      if (kind === "signed-out") getUser.mockResolvedValue({ data: { user: null }, error: null })
      if (kind === "inactive" || kind === "revoked") isActiveMember.mockResolvedValue(false)
      if (kind === "banned") getUser.mockResolvedValue({ data: { user: validUser }, error: { message: "banned" } })
      if (kind === "anonymous")
        getUser.mockResolvedValue({ data: { user: { ...validUser, is_anonymous: true } }, error: null })
      if (kind === "unconfirmed")
        getUser.mockResolvedValue({ data: { user: { ...validUser, email_confirmed_at: null } }, error: null })
      config.PRINTIFY_PUBLISHING_ENABLED = false
      const response = await GET(...request("GET", {}))
      expect(response.status).toBe(401)
      privateHeaders(response)
      expect(connect).not.toHaveBeenCalled()
      expect(updateGoogleMerchantCopy).not.toHaveBeenCalled()
    }
  )
  it.each(["", "bad id", "../etc", "x".repeat(129)])(
    "GET refuses invalid targets before private reads",
    async (product) => {
      const response = await GET(...request("GET", previewInput, { product }))
      expect(response.status).toBe(404)
      privateHeaders(response)
      expect(connect).not.toHaveBeenCalled()
    }
  )
  it("GET checks current admin before the publishing gate", async () => {
    config.PRINTIFY_PUBLISHING_ENABLED = false
    const response = await GET(...request("GET", previewInput))
    expect(response.status).toBe(503)
    privateHeaders(response)
    expect(getUser).toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  it.each(["signed-out", "inactive", "revoked", "banned", "anonymous", "unconfirmed"])(
    "PUT rejects %s before publishing and private reads",
    async (kind) => {
      if (kind === "signed-out") getUser.mockResolvedValue({ data: { user: null }, error: null })
      if (kind === "inactive" || kind === "revoked") isActiveMember.mockResolvedValue(false)
      if (kind === "banned") getUser.mockResolvedValue({ data: { user: validUser }, error: { message: "banned" } })
      if (kind === "anonymous")
        getUser.mockResolvedValue({ data: { user: { ...validUser, is_anonymous: true } }, error: null })
      if (kind === "unconfirmed")
        getUser.mockResolvedValue({ data: { user: { ...validUser, email_confirmed_at: null } }, error: null })
      config.PRINTIFY_PUBLISHING_ENABLED = false
      const response = await PUT(...request("PUT", previewInput))
      expect(response.status).toBe(401)
      privateHeaders(response)
      expect(connect).not.toHaveBeenCalled()
      expect(updateGoogleMerchantCopy).not.toHaveBeenCalled()
    }
  )
  it.each(["", "bad id", "../etc", "x".repeat(129)])(
    "PUT refuses invalid targets before private reads",
    async (product) => {
      const response = await PUT(...request("PUT", previewInput, { product }))
      expect(response.status).toBe(404)
      privateHeaders(response)
      expect(connect).not.toHaveBeenCalled()
    }
  )
  it("PUT checks current admin before the publishing gate", async () => {
    config.PRINTIFY_PUBLISHING_ENABLED = false
    const response = await PUT(...request("PUT", previewInput))
    expect(response.status).toBe(503)
    privateHeaders(response)
    expect(getUser).toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  it.each([null, "null", "https://foreign.example"])("PUT refuses origin %s before auth", async (origin) => {
    const response = await PUT(...request("PUT", previewInput, { origin }))
    expect(response.status).toBe(403)
    privateHeaders(response)
    expect(getUser).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })
  it("PUT trusts a deployment origin only when configured as a preview", async () => {
    expect((await PUT(...request("PUT", previewInput, { origin: "https://preview.vercel.app" }))).status).toBe(403)
    config.VERCEL_ENV = "preview"
    expect((await PUT(...request("PUT", previewInput, { origin: "https://preview.vercel.app" }))).status).not.toBe(403)
  })
})
