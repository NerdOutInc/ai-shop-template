// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "./route"

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

describe("Google copy preview route and coherent reader", () => {
  it("uses a short read-only repeatable-read transaction and the same client, never a mutator", async () => {
    const response = await POST(...request("POST", previewInput))
    expect(response.status).toBe(200)
    privateHeaders(response)
    expect(await response.json()).toMatchObject({
      expectedRevision: "7",
      copy: { origin: "generated", reviewed_variants: [{ id: 11, color: "Navy", size: "M" }] },
      descriptions: [{ content: "Explicit reviewed wording. Color: Navy. Size: M." }],
    })
    expect(query.mock.calls[0]![0]).toBe("begin isolation level repeatable read read only")
    expect(query).toHaveBeenCalledWith("set local statement_timeout='5s'")
    expect(query).toHaveBeenCalledWith("set local idle_in_transaction_session_timeout='5s'")
    expect(listFeedProfiles).toHaveBeenCalledWith(await connect.mock.results[0]!.value)
    expect(query).toHaveBeenCalledWith(expect.stringContaining("order by revision desc limit 101"), ["123", "tee", "7"])
    expect(query).toHaveBeenCalledWith("commit")
    expect(release).toHaveBeenCalledOnce()
    expect(query.mock.calls.some(([sql]) => /\b(update|insert|delete|for update)\b/i.test(String(sql)))).toBe(false)
    expect(updateGoogleMerchantCopy).not.toHaveBeenCalled()
  })
  it.each(["profile", "provenance", "snapshot", "commit"])(
    "rolls back and releases when the %s read fails without leaking database diagnostics",
    async (kind) => {
      const original = query.getMockImplementation()!
      if (kind === "profile") listFeedProfiles.mockRejectedValue(new Error("postgres://PRIVATE_DATABASE_URL"))
      else
        query.mockImplementation(async (sql: string) => {
          if (
            (kind === "provenance" && sql.includes("printify_product_revisions")) ||
            (kind === "snapshot" && sql.includes("printify_products")) ||
            (kind === "commit" && sql === "commit")
          )
            throw new Error("PRIVATE RAW ERROR")
          return original(sql)
        })
      const response = await POST(...request("POST", previewInput))
      expect(response.status).toBe(503)
      privateHeaders(response)
      expect(await response.text()).not.toContain("PRIVATE")
      expect(query).toHaveBeenCalledWith("rollback")
      expect(release).toHaveBeenCalledOnce()
      expect(updateGoogleMerchantCopy).not.toHaveBeenCalled()
    }
  )
  it("releases the client even if rollback itself fails", async () => {
    listFeedProfiles.mockRejectedValue(new Error("PRIVATE read failure"))
    const original = query.getMockImplementation()!
    query.mockImplementation(async (sql: string) => {
      if (sql === "rollback") throw new Error("PRIVATE rollback failure")
      return original(sql)
    })
    const response = await POST(...request("POST", previewInput))
    expect(response.status).toBe(503)
    privateHeaders(response)
    expect(await response.text()).not.toContain("PRIVATE")
    expect(release).toHaveBeenCalledOnce()
  })
  it("cancels an oversized body stream and refuses invalid UTF-8 before private reads", async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(65537))
      },
      cancel,
    })
    const response = await POST(
      new Request("http://localhost/api/admin/products/tee/google-copy/preview", {
        method: "POST",
        headers: { origin: "https://shop.example", "content-type": "application/json" },
        body: stream,
        duplex: "half",
      } as RequestInit),
      { params: Promise.resolve({ product: "tee" }) }
    )
    expect(response.status).toBe(400)
    privateHeaders(response)
    expect(cancel).toHaveBeenCalledOnce()
    expect(connect).not.toHaveBeenCalled()
    const invalid = await POST(
      new Request("http://localhost/api/admin/products/tee/google-copy/preview", {
        method: "POST",
        headers: { origin: "https://shop.example", "content-type": "application/json" },
        body: new Uint8Array([0xff]),
      }),
      { params: Promise.resolve({ product: "tee" }) }
    )
    expect(invalid.status).toBe(400)
    expect(connect).not.toHaveBeenCalled()
  })
  it("reports malformed records, job blocks, profiles, revision drift and unknown variants as conflicts", async () => {
    for (const kind of ["record", "job", "inactive", "revision", "variant", "profile"]) {
      snapshot.google_merchant_copy = undefined
      row!.active = true
      row!.blocked = false
      listFeedProfiles.mockResolvedValue(
        new Map([[1317, { googleProductCategory: 212, gender: "unisex", ageGroup: "adult", sizeSystem: "US" }]])
      )
      if (kind === "record") snapshot.google_merchant_copy = { origin: "generated", private: "PRIVATE" }
      if (kind === "job") row!.blocked = true
      if (kind === "inactive") row!.active = false
      if (kind === "profile") listFeedProfiles.mockResolvedValue(new Map())
      const response = await POST(
        ...request("POST", {
          ...previewInput,
          ...(kind === "revision" ? { expectedRevision: "6" } : {}),
          ...(kind === "variant" ? { variantIds: [99] } : {}),
        })
      )
      expect(response.status, kind).toBe(409)
      privateHeaders(response)
      expect(await response.text()).not.toContain("PRIVATE")
    }
  })
  it("enforces bounded historical generated/incomplete provenance and lifecycle boundaries", async () => {
    for (const [rows, status] of [
      [[{ origin: "generated", boundary: false }], 409],
      [Array.from({ length: 101 }, () => ({ origin: null, boundary: false })), 409],
      [
        [
          { origin: null, boundary: true },
          { origin: "generated", boundary: false },
        ],
        200,
      ],
    ] as const) {
      history = [...rows]
      expect((await POST(...request("POST", { ...previewInput, origin: "human" }))).status).toBe(status)
    }
  })
  it.each([
    { ...previewInput, unknown: true },
    { ...previewInput, origin: null },
    { ...previewInput, variantIds: [] },
    { ...previewInput, variantIds: [11, 11] },
    { ...previewInput, expectedRevision: "0" },
    null,
  ])("rejects strict invalid shape before private reads", async (body) => {
    const response = await POST(...request("POST", body))
    expect(response.status).toBe(400)
    privateHeaders(response)
    expect(connect).not.toHaveBeenCalled()
  })
  it.each([
    { headers: { "content-type": "text/plain" } },
    { headers: { "content-length": "65537" } },
    { raw: '{"invalid":' },
    { raw: "x".repeat(65537) },
    { raw: JSON.stringify({ ...previewInput, content: "😀".repeat(17000) }) },
  ])("bounds streamed bytes/content-type/JSON before private reads", async (options) => {
    const response = await POST(...request("POST", previewInput, options as Parameters<typeof request>[2]))
    expect(response.status).toBe(400)
    privateHeaders(response)
    expect(connect).not.toHaveBeenCalled()
  })
})

describe("current-admin boundary", () => {
  it.each(["signed-out", "inactive", "revoked", "banned", "anonymous", "unconfirmed"])(
    "POST rejects %s before publishing and private reads",
    async (kind) => {
      if (kind === "signed-out") getUser.mockResolvedValue({ data: { user: null }, error: null })
      if (kind === "inactive" || kind === "revoked") isActiveMember.mockResolvedValue(false)
      if (kind === "banned") getUser.mockResolvedValue({ data: { user: validUser }, error: { message: "banned" } })
      if (kind === "anonymous")
        getUser.mockResolvedValue({ data: { user: { ...validUser, is_anonymous: true } }, error: null })
      if (kind === "unconfirmed")
        getUser.mockResolvedValue({ data: { user: { ...validUser, email_confirmed_at: null } }, error: null })
      config.PRINTIFY_PUBLISHING_ENABLED = false
      const response = await POST(...request("POST", previewInput))
      expect(response.status).toBe(401)
      privateHeaders(response)
      expect(connect).not.toHaveBeenCalled()
      expect(updateGoogleMerchantCopy).not.toHaveBeenCalled()
    }
  )
  it.each(["", "bad id", "../etc", "x".repeat(129)])(
    "POST refuses invalid targets before private reads",
    async (product) => {
      const response = await POST(...request("POST", previewInput, { product }))
      expect(response.status).toBe(404)
      privateHeaders(response)
      expect(connect).not.toHaveBeenCalled()
    }
  )
  it("POST checks current admin before the publishing gate", async () => {
    config.PRINTIFY_PUBLISHING_ENABLED = false
    const response = await POST(...request("POST", previewInput))
    expect(response.status).toBe(503)
    privateHeaders(response)
    expect(getUser).toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  it.each([null, "null", "https://foreign.example"])("POST refuses origin %s before auth", async (origin) => {
    const response = await POST(...request("POST", previewInput, { origin }))
    expect(response.status).toBe(403)
    privateHeaders(response)
    expect(getUser).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })
  it("POST trusts a deployment origin only when configured as a preview", async () => {
    expect((await POST(...request("POST", previewInput, { origin: "https://preview.vercel.app" }))).status).toBe(403)
    config.VERCEL_ENV = "preview"
    expect((await POST(...request("POST", previewInput, { origin: "https://preview.vercel.app" }))).status).not.toBe(
      403
    )
  })
})
