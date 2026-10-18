// @vitest-environment node
import { createHash } from "node:crypto"
import { BlobAccessError, BlobNotFoundError, BlobStoreNotFoundError } from "@vercel/blob"
import { beforeEach, expect, it, vi } from "vitest"
import type { GalleryAsset } from "./product-gallery-store.server"
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  env: { PRIVATE_BLOB_READ_WRITE_TOKEN: "synthetic" as string | undefined },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env: mocks.env }))
vi.mock("@vercel/blob", async (original) => ({ ...(await original<typeof import("@vercel/blob")>()), get: mocks.get }))
import { readGalleryPhoto } from "./read-gallery-photo.server"
const bytes = Buffer.from("verified private photo fixture")
const asset: GalleryAsset = {
  id: "fixture",
  pathname: "private/fixture.jpg",
  sha256: createHash("sha256").update(bytes).digest("hex"),
  bytes: bytes.length,
  width: 1000,
  height: 1200,
  contentType: "image/jpeg",
}
const found = (content: Buffer) => ({
  statusCode: 200,
  blob: { size: content.length },
  stream: new Response(new Uint8Array(content)).body,
})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.env.PRIVATE_BLOB_READ_WRITE_TOKEN = "synthetic"
})

it("returns verified private bytes from an uncached private read", async () => {
  mocks.get.mockResolvedValue(found(bytes))
  expect(await readGalleryPhoto(asset)).toEqual(bytes)
  expect(mocks.get).toHaveBeenCalledWith(asset.pathname, {
    access: "private",
    token: "synthetic",
    useCache: false,
    abortSignal: expect.any(AbortSignal),
  })
})

it("refuses missing or changed private bytes before they can become public", async () => {
  mocks.get.mockResolvedValue(null)
  await expect(readGalleryPhoto(asset)).rejects.toMatchObject({ status: 409, code: "PHOTO_MISSING" })
  mocks.get.mockRejectedValue(new BlobNotFoundError())
  await expect(readGalleryPhoto(asset)).rejects.toMatchObject({ status: 409, code: "PHOTO_MISSING" })
  for (const content of [Buffer.from("different length"), Buffer.alloc(bytes.length)]) {
    mocks.get.mockResolvedValue(found(content))
    await expect(readGalleryPhoto(asset)).rejects.toMatchObject({ status: 409, code: "PHOTO_CHANGED" })
  }
})

it("labels permanent storage failures and leaves transient ones retryable", async () => {
  for (const error of [new BlobAccessError(), new BlobStoreNotFoundError()]) {
    mocks.get.mockRejectedValue(error)
    await expect(readGalleryPhoto(asset)).rejects.toMatchObject({ status: 409, code: "PHOTO_STORAGE_CONFIGURATION" })
  }
  const transient = new Error("network reset")
  mocks.get.mockRejectedValue(transient)
  await expect(readGalleryPhoto(asset)).rejects.toBe(transient)
  mocks.env.PRIVATE_BLOB_READ_WRITE_TOKEN = undefined
  mocks.get.mockReset()
  await expect(readGalleryPhoto(asset)).rejects.toMatchObject({ status: 409, code: "PHOTO_STORAGE_CONFIGURATION" })
  expect(mocks.get).not.toHaveBeenCalled()
})
