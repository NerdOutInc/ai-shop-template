// @vitest-environment node
import { createHash } from "node:crypto"
import { beforeEach, expect, it, vi } from "vitest"
import sharp from "sharp"
import { storeConfig } from "@/lib/store-config"
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  assetCount: vi.fn(),
  add: vi.fn(),
  put: vi.fn(),
  env: { PRIVATE_BLOB_READ_WRITE_TOKEN: "synthetic" as string | undefined },
}))
vi.mock("server-only", () => ({}))
vi.mock("@vercel/blob", () => ({ put: mocks.put }))
vi.mock("@/lib/env", () => ({ env: mocks.env }))
vi.mock("./get-product-gallery-store.server", () => ({
  getProductGalleryStore: () => ({ read: mocks.read, assetCount: mocks.assetCount, addAsset: mocks.add }),
}))
import { uploadGalleryPhoto } from "./upload-gallery-photo.server"
beforeEach(() => {
  vi.resetAllMocks()
  mocks.env.PRIVATE_BLOB_READ_WRITE_TOKEN = "synthetic"
  mocks.assetCount.mockResolvedValue(0)
})
function request(bytes: Buffer, length = String(bytes.length)) {
  return new Request("https://store.example/upload", {
    method: "POST",
    headers: { "x-photo-bytes": length },
    body: new Uint8Array(bytes),
  })
}
const photo = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 60, b: 90 } } })
    .jpeg()
    .toBuffer()

it("strips private photo metadata before private storage", async () => {
  const image = await sharp({ create: { width: 1200, height: 800, channels: 4, background: "#00000000" } })
    .png()
    .withMetadata({ orientation: 6 })
    .toBuffer()
  const result = await uploadGalleryPhoto(request(image), "sample-tee", "owner")
  const [pathname, bytes, options] = mocks.put.mock.calls[0]! as [string, Buffer, Record<string, unknown>]
  const metadata = await sharp(bytes).metadata()
  expect(metadata).toMatchObject({ format: "jpeg", width: 800, height: 1200 })
  expect(metadata.orientation).toBeUndefined()
  expect(metadata.exif).toBeUndefined()
  expect(pathname).toBe(`product-gallery/v1/${result.id}.jpg`)
  expect(options).toMatchObject({
    access: "private",
    token: "synthetic",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "image/jpeg",
  })
  expect(options.abortSignal).toBeInstanceOf(AbortSignal)
  expect(mocks.add).toHaveBeenCalledWith(
    "sample-tee",
    {
      id: result.id,
      pathname,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      width: 800,
      height: 1200,
      contentType: "image/jpeg",
    },
    "owner"
  )
})

it("flattens transparency onto the storefront background", async () => {
  const image = await sharp({ create: { width: 900, height: 900, channels: 4, background: "#00000000" } })
    .png()
    .toBuffer()
  await uploadGalleryPhoto(request(image), "sample-tee", "owner")
  const { data } = await sharp(mocks.put.mock.calls[0]![1] as Buffer)
    .raw()
    .toBuffer({ resolveWithObject: true })
  const expected = storeConfig.theme.background.match(/[0-9a-f]{2}/gi)!.map((hex) => parseInt(hex, 16))
  for (const [index, channel] of expected.entries()) expect(Math.abs(data[index]! - channel)).toBeLessThanOrEqual(2)
})

it("bounds the archive and the declared size before reading any bytes", async () => {
  const image = await photo(800, 800)
  mocks.assetCount.mockResolvedValue(500)
  await expect(uploadGalleryPhoto(request(image), "sample-tee", "owner")).rejects.toThrow("500-photo")
  mocks.assetCount.mockResolvedValue(0)
  for (const length of ["", "0", "1.5", "3145729", "not a number"])
    await expect(uploadGalleryPhoto(request(image, length), "sample-tee", "owner")).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("smaller than 3 MB"),
    })
  await expect(uploadGalleryPhoto(request(image, String(image.length - 1)), "sample-tee", "owner")).rejects.toThrow(
    "valid"
  )
  expect(mocks.put).not.toHaveBeenCalled()
})

it("refuses small or unsupported images", async () => {
  const gif = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#336699" } })
    .gif()
    .toBuffer()
  for (const image of [await photo(799, 1200), await photo(1200, 799), gif])
    await expect(uploadGalleryPhoto(request(image), "sample-tee", "owner")).rejects.toMatchObject({ status: 400 })
  expect(mocks.put).not.toHaveBeenCalled()
})

it("rejects corrupt bytes and validates the product and storage before any upload", async () => {
  await expect(uploadGalleryPhoto(request(Buffer.from("not a photo")), "sample-tee", "owner")).rejects.toThrow("valid")
  mocks.env.PRIVATE_BLOB_READ_WRITE_TOKEN = undefined
  await expect(uploadGalleryPhoto(request(await photo(800, 800)), "sample-tee", "owner")).rejects.toMatchObject({
    status: 409,
    code: "PHOTO_STORAGE_CONFIGURATION",
  })
  expect(mocks.assetCount).toHaveBeenCalledTimes(1)
  mocks.read.mockRejectedValue(new Error("missing"))
  await expect(uploadGalleryPhoto(request(Buffer.from("bad")), "missing", "owner")).rejects.toThrow("missing")
  expect(mocks.put).not.toHaveBeenCalled()
  expect(mocks.add).not.toHaveBeenCalled()
})
