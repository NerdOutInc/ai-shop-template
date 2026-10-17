// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest"
import sharp from "sharp"
import { uploadHeroImage } from "./upload-hero-image.server"
import { WeeklyHeroError } from "./weekly-hero-error"
const mocks = vi.hoisted(() => ({ put: vi.fn(), store: vi.fn(), addAsset: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@vercel/blob", () => ({ put: mocks.put }))
vi.mock("@/lib/env", () => ({ env: { PRIVATE_BLOB_READ_WRITE_TOKEN: "test-only" } }))
vi.mock("./get-weekly-hero-store.server", () => ({ getWeeklyHeroStore: mocks.store }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.store.mockReturnValue({ addAsset: mocks.addAsset })
})
function request(bytes: Buffer) {
  return new Request("https://store.test/api/admin/weekly-heroes/assets?kind=desktop", {
    method: "POST",
    headers: { "x-hero-bytes": String(bytes.length) },
    body: new Uint8Array(bytes),
  })
}
it("rejects a truncated image after readable headers, before writing Blob or a receipt", async () => {
  const complete = await sharp({ create: { width: 1800, height: 600, channels: 3, background: "#436066" } })
    .png()
    .toBuffer()
  const truncated = complete.subarray(0, Math.floor(complete.length / 2))
  expect(await sharp(truncated).metadata()).toMatchObject({ format: "png", width: 1800, height: 600 })
  await expect(uploadHeroImage(request(truncated), "admin")).rejects.toBeInstanceOf(WeeklyHeroError)
  expect(mocks.put).not.toHaveBeenCalled()
  expect(mocks.addAsset).not.toHaveBeenCalled()
})
it("resolves storage configuration before writing any bytes", async () => {
  mocks.store.mockImplementation(() => {
    throw new Error("Storage unavailable")
  })
  await expect(uploadHeroImage(request(Buffer.from("not an image")), "admin")).rejects.toThrow("Storage unavailable")
  expect(mocks.put).not.toHaveBeenCalled()
  expect(mocks.addAsset).not.toHaveBeenCalled()
})
it("keeps the immutable upload receipt for a fully decoded valid image", async () => {
  const bytes = await sharp({ create: { width: 1800, height: 600, channels: 3, background: "#436066" } })
    .png()
    .toBuffer()
  const asset = await uploadHeroImage(request(bytes), "admin")
  expect(asset).toMatchObject({ kind: "desktop", width: 1800, height: 600 })
  expect(mocks.put).toHaveBeenCalledOnce()
  expect(mocks.addAsset).toHaveBeenCalledWith(
    expect.objectContaining({ id: asset.id, bytes: bytes.length, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    "admin"
  )
  expect(mocks.store.mock.invocationCallOrder[0]).toBeLessThan(mocks.put.mock.invocationCallOrder[0]!)
})
