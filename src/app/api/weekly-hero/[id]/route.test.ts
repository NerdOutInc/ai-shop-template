import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ enabled: true, currentAsset: vi.fn(), read: vi.fn() }))
vi.mock("@/lib/store-config", () => ({
  storeConfig: {
    features: {
      get designOfTheWeek() {
        return mocks.enabled
      },
    },
  },
}))
vi.mock("@/features/weekly-heroes/get-weekly-hero-store.server", () => ({
  getWeeklyHeroStore: () => ({ currentAsset: mocks.currentAsset }),
}))
vi.mock("@/features/weekly-heroes/read-hero-image.server", () => ({ readHeroImage: mocks.read }))
import { GET } from "./route"
const id = "11111111-1111-4111-8111-111111111111"
beforeEach(() => {
  vi.clearAllMocks()
  mocks.enabled = true
  mocks.currentAsset.mockResolvedValue(null)
  mocks.read.mockResolvedValue({ bytes: Buffer.from("image"), contentType: "image/webp" })
})
it("does not fetch private bytes for drafts, future weeks or guessed asset IDs", async () => {
  const response = await GET(new Request(`https://store.test/api/weekly-hero/${id}`), {
    params: Promise.resolve({ id }),
  })
  expect(response.status).toBe(404)
  expect(response.headers.get("cache-control")).toContain("no-store")
  expect(mocks.read).not.toHaveBeenCalled()
})
it("serves only the active hero's image with private browser revalidation but no shared cache", async () => {
  const asset = { id, pathname: "private/hero.webp", sha256: "a".repeat(64) }
  mocks.currentAsset.mockResolvedValue(asset)
  const response = await GET(new Request(`https://store.test/api/weekly-hero/${id}`), {
    params: Promise.resolve({ id }),
  })
  expect(mocks.currentAsset).toHaveBeenCalledWith(id)
  expect(mocks.read).toHaveBeenCalledWith(asset)
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("private, no-cache")
  expect(response.headers.get("etag")).toBe(`"${"a".repeat(64)}"`)
  expect(response.headers.get("cdn-cache-control")).toBe("no-store")
  expect(await response.text()).toBe("image")
})

it("blocks already approved images when the weekly feature is disabled", async () => {
  mocks.enabled = false
  mocks.currentAsset.mockResolvedValue({ id })
  const response = await GET(new Request(`https://store.test/api/weekly-hero/${id}`), {
    params: Promise.resolve({ id }),
  })
  expect(response.status).toBe(404)
  expect(mocks.currentAsset).not.toHaveBeenCalled()
  expect(mocks.read).not.toHaveBeenCalled()
})

it.each([`"${"a".repeat(64)}"`, `W/"${"a".repeat(64)}"`, `"other", "${"a".repeat(64)}"`, "*"])(
  "checks eligibility before a matching validator skips Blob (%s)",
  async (validator) => {
    mocks.currentAsset.mockResolvedValue({ id, sha256: "a".repeat(64) })
    const request = () =>
      new Request(`https://store.test/api/weekly-hero/${id}`, { headers: { "if-none-match": validator } })
    const response = await GET(request(), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(304)
    expect(await response.text()).toBe("")
    expect(response.headers.get("cache-control")).toBe("private, no-cache")
    expect(mocks.currentAsset).toHaveBeenCalledOnce()
    expect(mocks.read).not.toHaveBeenCalled()
    mocks.currentAsset.mockResolvedValue(null)
    const withdrawn = await GET(request(), { params: Promise.resolve({ id }) })
    expect(withdrawn.status).toBe(404)
    expect(withdrawn.headers.get("cache-control")).toContain("no-store")
    expect(mocks.read).not.toHaveBeenCalled()
  }
)
it("requires bytes and integrity validation for a mismatching validator", async () => {
  mocks.currentAsset.mockResolvedValue({ id, sha256: "a".repeat(64) })
  mocks.read.mockRejectedValue(new Error("Integrity failure"))
  const response = await GET(
    new Request(`https://store.test/api/weekly-hero/${id}`, { headers: { "if-none-match": '"other"' } }),
    { params: Promise.resolve({ id }) }
  )
  expect(response.status).toBe(503)
  expect(response.headers.get("cache-control")).toContain("no-store")
  expect(mocks.read).toHaveBeenCalledOnce()
})
