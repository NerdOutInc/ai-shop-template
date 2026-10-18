// @vitest-environment node
import sharp from "sharp"
import { BlobAccessError, BlobStoreSuspendedError } from "@vercel/blob"
import { createHash, randomUUID } from "node:crypto"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { GalleryError } from "./gallery-error"
import type { GalleryAsset } from "./product-gallery-store.server"
const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
  promotion: vi.fn(),
  record: vi.fn(),
  activate: vi.fn(),
  read: vi.fn(),
  put: vi.fn(),
  head: vi.fn(),
  tag: vi.fn(),
  path: vi.fn(),
  env: {} as Record<string, string | undefined>,
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env: mocks.env }))
vi.mock("@vercel/blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/blob")>()),
  put: mocks.put,
  head: mocks.head,
}))
vi.mock("next/cache", () => ({ revalidateTag: mocks.tag, revalidatePath: mocks.path }))
vi.mock("./read-gallery-photo.server", () => ({ readGalleryPhoto: mocks.read }))
vi.mock("./get-product-gallery-store.server", () => ({
  getProductGalleryStore: () => ({
    activationPlan: mocks.plan,
    promotion: mocks.promotion,
    recordPromotion: mocks.record,
    activate: mocks.activate,
  }),
}))
import { activateProductGallery } from "./activate-product-gallery.server"
const host = "galleryfixtures.public.blob.vercel-storage.com"
const input = { action: "activate" as const, revision: randomUUID(), productRevision: "1", confirmations: {} }
let assets: GalleryAsset[], bytes: Map<string, Buffer>
const location = (pathname: string) => ({ pathname, url: `https://${host}/${pathname}`, contentType: "image/jpeg" })
beforeEach(async () => {
  vi.resetAllMocks()
  for (const key of Object.keys(mocks.env)) delete mocks.env[key]
  Object.assign(mocks.env, {
    NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST: host,
    BLOB_READ_WRITE_TOKEN: "synthetic-public-token",
  })
  bytes = new Map()
  assets = await Promise.all(
    Array.from({ length: 3 }, async (_, i) => {
      const id = randomUUID(),
        data = await sharp({
          create: { width: 800, height: 1000, channels: 3, background: { r: 20 + i, g: 40, b: 60 } },
        })
          .jpeg()
          .toBuffer()
      bytes.set(id, data)
      return {
        id,
        pathname: `private/${id}.jpg`,
        sha256: createHash("sha256").update(data).digest("hex"),
        bytes: data.length,
        width: 1000,
        height: 1200,
        contentType: "image/jpeg",
      }
    })
  )
  mocks.plan.mockImplementation(async () => ({
    assets,
    photoLabels: Object.fromEntries(assets.map((asset, index) => [asset.id, `Sample color, photo ${index + 1}`])),
    manifest: { colors: [{ entries: assets.map((a) => ({ source: "store", assetId: a.id })) }] },
  }))
  mocks.read.mockImplementation(async (asset: GalleryAsset) => bytes.get(asset.id))
  mocks.put.mockImplementation(async (pathname: string) => location(pathname))
  mocks.activate.mockResolvedValue({ revision: randomUUID() })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it("resumes bounded preparation from receipts and activates only after every photo is ready", async () => {
  let now = 0
  vi.spyOn(Date, "now").mockImplementation(() => now)
  const receipts = new Map<string, { sha256: string; url: string }>()
  mocks.promotion.mockImplementation(async (_product, asset: GalleryAsset) => receipts.get(asset.id))
  mocks.record.mockImplementation(async (_product, asset: GalleryAsset, _host, url: string) => {
    receipts.set(asset.id, { sha256: asset.sha256, url })
  })
  mocks.put.mockImplementation(async (pathname: string) => {
    now += 12000
    return location(pathname)
  })
  expect(await activateProductGallery("sample-tee", input, "owner")).toEqual({
    status: "preparing",
    completed: 2,
    total: 3,
  })
  expect(mocks.activate).not.toHaveBeenCalled()
  expect(mocks.tag).not.toHaveBeenCalled()
  expect(await activateProductGallery("sample-tee", input, "owner")).toMatchObject({
    status: "activated",
    cacheRefreshed: true,
  })
  expect(mocks.put).toHaveBeenCalledTimes(3)
  expect(mocks.activate).toHaveBeenCalledTimes(1)
})
it("recovers a lost upload response only after verifying the existing public bytes", async () => {
  assets = assets.slice(0, 1)
  const asset = assets[0]!,
    data = bytes.get(asset.id)!
  mocks.put.mockRejectedValue(new Error("upload response lost"))
  mocks.head.mockImplementation(async (pathname: string) => ({ ...location(pathname), size: data.length }))
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(new Uint8Array(data), { headers: { "content-type": "image/jpeg" } }))
  vi.stubGlobal("fetch", fetch)
  expect(await activateProductGallery("sample-tee", input, "owner")).toMatchObject({ status: "activated" })
  expect(mocks.record).toHaveBeenCalledWith(
    "sample-tee",
    asset,
    host,
    `https://${host}/published-product-photos/v1/${asset.sha256}.jpg`
  )
  expect(fetch).toHaveBeenCalledTimes(1)
})
it("leaves the active selection and caches untouched if recovered public bytes do not match", async () => {
  assets = assets.slice(0, 1)
  mocks.put.mockRejectedValue(new Error("upload response lost"))
  mocks.head.mockImplementation(async (pathname: string) => ({ ...location(pathname), size: assets[0]!.bytes }))
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(Buffer.alloc(assets[0]!.bytes))))
  await expect(activateProductGallery("sample-tee", input, "owner")).rejects.toMatchObject({
    status: 409,
    code: "PHOTO_STORAGE_CONFLICT",
    message: expect.stringContaining("Sample color, photo 1"),
  })
  expect(mocks.record).not.toHaveBeenCalled()
  expect(mocks.activate).not.toHaveBeenCalled()
  expect(mocks.tag).not.toHaveBeenCalled()
})

it.each([new BlobAccessError(), new BlobStoreSuspendedError()])(
  "reports permanent storage failures without attempting recovery",
  async (error) => {
    assets = assets.slice(0, 1)
    mocks.put.mockRejectedValue(error)
    await expect(activateProductGallery("sample-tee", input, "owner")).rejects.toThrow("not configured or accessible")
    expect(mocks.head).not.toHaveBeenCalled()
    expect(mocks.activate).not.toHaveBeenCalled()
  }
)

it.each(["PHOTO_MISSING", "PHOTO_CHANGED", "PHOTO_OWNERSHIP"] as const)(
  "refuses activation when a selected photo cannot be repaired by retrying: %s",
  async (code) => {
    assets = assets.slice(0, 1)
    if (code === "PHOTO_OWNERSHIP") {
      mocks.plan.mockResolvedValue({
        assets: [],
        photoLabels: { [assets[0]!.id]: "Sample color, photo 1" },
        manifest: { colors: [{ entries: [{ source: "store", assetId: assets[0]!.id }] }] },
      })
    } else mocks.read.mockRejectedValue(new GalleryError("Upload a replacement and review it.", 409, code))
    await expect(activateProductGallery("sample-tee", input, "owner")).rejects.toMatchObject({
      status: 409,
      code,
      message: expect.stringContaining("Sample color, photo 1"),
    })
    expect(mocks.put).not.toHaveBeenCalled()
    expect(mocks.activate).not.toHaveBeenCalled()
  }
)

it("accepts OIDC store configuration without requiring a legacy public token", async () => {
  mocks.env.BLOB_READ_WRITE_TOKEN = undefined
  mocks.env.BLOB_STORE_ID = "synthetic-public-store"
  expect(await activateProductGallery("sample-tee", input, "owner")).toMatchObject({ status: "activated" })
  expect(mocks.put).toHaveBeenCalledTimes(3)
})

it("requires public photo storage before preparing store photos", async () => {
  mocks.env.BLOB_READ_WRITE_TOKEN = undefined
  await expect(activateProductGallery("sample-tee", input, "owner")).rejects.toMatchObject({
    status: 409,
    code: "PHOTO_STORAGE_CONFIGURATION",
  })
  mocks.env.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST = undefined
  await expect(activateProductGallery("sample-tee", input, "owner")).rejects.toMatchObject({
    code: "PHOTO_STORAGE_CONFIGURATION",
  })
  expect(mocks.plan).toHaveBeenCalledTimes(1)
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.put).not.toHaveBeenCalled()
  expect(mocks.activate).not.toHaveBeenCalled()
})

it("reuses matching receipts and reports a cache refresh failure separately", async () => {
  mocks.promotion.mockImplementation(async (_product, asset: GalleryAsset) => ({
    sha256: asset.sha256,
    url: `https://${host}/published-product-photos/v1/${asset.sha256}.jpg`,
  }))
  mocks.tag.mockImplementation(() => {
    throw new Error("cache unavailable")
  })
  expect(await activateProductGallery("sample-tee", input, "owner")).toMatchObject({
    status: "activated",
    cacheRefreshed: false,
  })
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.put).not.toHaveBeenCalled()
  expect(mocks.record).not.toHaveBeenCalled()
  expect(mocks.activate).toHaveBeenCalledWith("sample-tee", input, "owner", host)
})
