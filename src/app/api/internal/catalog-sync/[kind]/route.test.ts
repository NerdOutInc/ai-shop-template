// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest"
import { refreshCatalog } from "@/features/catalog-sync/refresh-catalog.server"
import { GET, POST } from "./route"
vi.mock("server-only", () => ({}))
vi.mock("@/features/catalog-sync/refresh-catalog.server", () => ({ refreshCatalog: vi.fn() }))
const config = vi.hoisted(() => ({ CRON_SECRET: "secret" as string | undefined, PRINTIFY_PUBLISHING_ENABLED: true }))
vi.mock("@/lib/env", () => ({ env: config }))
const context = (kind = "stock") => ({ params: Promise.resolve({ kind }) })
const request = (secret = "secret") =>
  new Request("https://store.test/api/internal/catalog-sync/stock", { headers: { authorization: `Bearer ${secret}` } })
beforeEach(() => {
  config.CRON_SECRET = "secret"
  config.PRINTIFY_PUBLISHING_ENABLED = true
  vi.mocked(refreshCatalog).mockResolvedValue("updated")
})
it.each([GET, POST])("authenticates before doing any work", async (handler) => {
  expect((await handler(request("wrong"), context())).status).toBe(401)
  expect(refreshCatalog).not.toHaveBeenCalled()
})
it("requires the worker secret", async () => {
  config.CRON_SECRET = undefined
  expect((await GET(request(), context())).status).toBe(503)
  expect(refreshCatalog).not.toHaveBeenCalled()
})
it("skips disabled publishing without provider or database work", async () => {
  config.PRINTIFY_PUBLISHING_ENABLED = false
  expect(await (await GET(request(), context())).json()).toEqual({ processed: false, reason: "disabled" })
  expect(refreshCatalog).not.toHaveBeenCalled()
})
it.each(["stock", "popularity"])("runs %s and prevents response caching", async (kind) => {
  const response = await GET(request(), context(kind))
  expect(await response.json()).toEqual({ processed: true, result: "updated" })
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(refreshCatalog).toHaveBeenCalledExactlyOnceWith(kind, { force: false })
})
it("rejects unknown jobs", async () => {
  expect((await GET(request(), context("publish"))).status).toBe(404)
  expect(refreshCatalog).not.toHaveBeenCalled()
})
it("reports skips honestly", async () => {
  vi.mocked(refreshCatalog).mockResolvedValue("busy")
  expect(await (await POST(request(), context())).json()).toEqual({ processed: false, result: "busy" })
})
it("returns a failed cron result without leaking private failures", async () => {
  vi.mocked(refreshCatalog).mockRejectedValue(new Error("private token and provider response"))
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
  const response = await GET(request(), context())
  expect(response.status).toBe(500)
  expect(await response.text()).not.toContain("private")
  expect(JSON.stringify(log.mock.calls)).not.toContain("private")
})

it("lets authenticated manual POSTs bypass recency without changing cron GETs", async () => {
  await POST(request(), context())
  expect(refreshCatalog).toHaveBeenCalledExactlyOnceWith("stock", { force: true })
})
