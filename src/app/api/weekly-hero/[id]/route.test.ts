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
it("serves only the active hero's image without a reusable source cache", async () => {
  const asset = { id, pathname: "private/hero.webp" }
  mocks.currentAsset.mockResolvedValue(asset)
  const response = await GET(new Request(`https://store.test/api/weekly-hero/${id}`), {
    params: Promise.resolve({ id }),
  })
  expect(mocks.currentAsset).toHaveBeenCalledWith(id)
  expect(mocks.read).toHaveBeenCalledWith(asset)
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toContain("no-store")
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
