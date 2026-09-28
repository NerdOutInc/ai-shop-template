// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { LibraryError } from "@/features/design-library/library-error"
import { PUT } from "./route"

const { getAdminActor, setFavorite, env } = vi.hoisted(() => ({
  getAdminActor: vi.fn(),
  setFavorite: vi.fn(),
  env: { VERCEL_ENV: "production", VERCEL_URL: "preview.vercel.app" },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor }))
vi.mock("@/features/design-library/postgres-library-store.server", () => ({
  createPostgresLibraryStore: () => ({ setFavorite }),
}))
vi.mock("@/lib/env", () => ({ env }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))
const design = "63210e29-266e-4bc0-a3c1-22be95c5c0bb",
  revisionId = "fbaec396-3541-47bb-882b-8e1749a07ad5"
function request(origin: string | null = "https://store.example", body: unknown = { revisionId, selected: true }) {
  return new Request("http://0.0.0.0:3000/api/admin/concepts/a/favorite", {
    method: "PUT",
    headers: { ...(origin ? { origin } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
const context = { params: Promise.resolve({ design }) }
beforeEach(() => {
  vi.clearAllMocks()
  env.VERCEL_ENV = "production"
  getAdminActor.mockResolvedValue({ userId: "owner" })
  setFavorite.mockResolvedValue({ selected: true, revisionId })
})
describe("personal favorite route", () => {
  it.each([null, "null", "https://foreign.example"])("denies origin %s before authentication", async (origin) => {
    expect((await PUT(request(origin), context)).status).toBe(403)
    expect(getAdminActor).not.toHaveBeenCalled()
    expect(setFavorite).not.toHaveBeenCalled()
  })
  it("accepts the configured public origin even when Next sees an internal listener", async () => {
    const result = await PUT(request(), context)
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ selected: true, revisionId })
    expect(setFavorite).toHaveBeenCalledWith("owner", { designId: design, revisionId, selected: true })
    expect(result.headers.get("cache-control")).toContain("no-store")
  })
  it("permits the deployment origin only in a configured Vercel preview", async () => {
    expect((await PUT(request("https://preview.vercel.app"), context)).status).toBe(403)
    env.VERCEL_ENV = "preview"
    expect((await PUT(request("https://preview.vercel.app"), context)).status).toBe(200)
  })
  it.each(["visitor", "non-admin"])("rejects a %s before any mutation", async () => {
    getAdminActor.mockResolvedValue(null)
    expect((await PUT(request(), context)).status).toBe(401)
    expect(setFavorite).not.toHaveBeenCalled()
  })
  it("rejects invalid artwork inputs before mutation", async () => {
    expect((await PUT(request(null), context)).status).toBe(403)
    expect((await PUT(request("https://store.example", { revisionId: "bad", selected: true }), context)).status).toBe(
      400
    )
    expect((await PUT(request(), { params: Promise.resolve({ design: "bad" }) })).status).toBe(404)
    expect(setFavorite).not.toHaveBeenCalled()
  })
  it.each([
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["INVALID_INPUT", 400],
    ["CONFLICT", 409],
  ] as const)("maps %s to %s without exposing internal details", async (code, status) => {
    setFavorite.mockRejectedValue(new LibraryError(code, "private internal details"))
    const result = await PUT(request(), context)
    expect(result.status).toBe(status)
    expect(await result.text()).not.toContain("private internal details")
    expect(result.headers.get("cache-control")).toContain("no-store")
  })
  it("reports a database outage as retryable service failure", async () => {
    setFavorite.mockRejectedValue(new Error("private database host"))
    const result = await PUT(request(), context)
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain("private database host")
  })
})
