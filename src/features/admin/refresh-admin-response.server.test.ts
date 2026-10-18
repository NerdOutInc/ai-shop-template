// @vitest-environment node
import { NextRequest } from "next/server"
import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ auth: vi.fn(), refresh: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("./get-admin-auth-config.server", () => ({ getAdminAuthConfig: mocks.auth }))
vi.mock("./is-admin-local-development", () => ({ isAdminLocalDevelopment: () => false }))
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (...args: unknown[]) => void } }) => ({
    auth: { getClaims: async () => mocks.refresh(options.cookies.setAll) },
  }),
}))
import { refreshAdminResponse } from "./refresh-admin-response.server"

const asset = "e3a4e34c-cb28-442e-8741-bef56b70b97d"
const photo = `/api/admin/products/sample-tee/gallery/assets/${asset}`
const request = (path: string, method = "GET") => new NextRequest(`https://store.example${path}`, { method })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockReturnValue(null)
})

it("lets only the private gallery photo GET keep its route-level ETag caching", async () => {
  for (const auth of [null, { url: "https://auth.example/", key: "synthetic" }]) {
    mocks.auth.mockReturnValue(auth)
    const response = await refreshAdminResponse(request(photo))
    expect(response.headers.get("cache-control")).toBeNull()
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow")
  }
})

it("keeps the blanket no-store on every other admin request", async () => {
  for (const [path, method] of [
    [photo, "POST"],
    [photo, "HEAD"],
    ["/api/admin/products/sample-tee/gallery/assets/not-a-uuid-but-thirty-six-chars-long", "GET"],
    [`${photo}/extra`, "GET"],
    [`${photo}/`, "GET"],
    [`/api/admin/products/sample-tee/gallery/assets/${asset}x`, "GET"],
    [`/api/admin/products/${"p".repeat(129)}/gallery/assets/${asset}`, "GET"],
    [`/api/admin/products/sample.tee/gallery/assets/${asset}`, "GET"],
    [`/api/admin/weekly-heroes/assets/${asset}`, "GET"],
    ["/api/admin/products/sample-tee/gallery/assets", "POST"],
    ["/api/admin/products/sample-tee/gallery", "GET"],
    ["/admin/products/sample-tee", "GET"],
  ] as const) {
    const response = await refreshAdminResponse(request(path, method))
    expect(response.headers.get("cache-control"), `${method} ${path}`).toBe("private, no-store")
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow")
  }
})

it("keeps refreshed session cookies private and unindexed, including on the photo route", async () => {
  mocks.auth.mockReturnValue({ url: "https://auth.example/", key: "synthetic" })
  mocks.refresh.mockImplementation((setAll: (cookies: unknown[], headers: Record<string, string>) => void) =>
    setAll([{ name: "session", value: "refreshed", options: {} }], {})
  )
  for (const path of [photo, "/admin"]) {
    const response = await refreshAdminResponse(request(path))
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow")
    expect(response.cookies.get("session")?.value).toBe("refreshed")
  }
})
