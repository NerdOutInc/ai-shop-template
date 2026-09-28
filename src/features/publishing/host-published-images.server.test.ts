// @vitest-environment node
import { createHash } from "node:crypto"
import { BlobAccessError, BlobNotFoundError } from "@vercel/blob"
import sharp from "sharp"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { catalogProductSchema } from "@/features/catalog/catalog-product-schema"

import { hostPublishedImages } from "./host-published-images.server"

vi.mock("server-only", () => ({}))

const blobHost = "teststore.public.blob.vercel-storage.com"
const front = "https://images-api.printify.com/mockup/product/front.jpg?size=1500"
const back = "https://images-api.printify.com/mockup/product/back.jpg?size=1500"
let bytes: Buffer
let pathname: string
let hosted: string
let differentBytes: Buffer

beforeAll(async () => {
  bytes = await sharp({ create: { width: 500, height: 500, channels: 3, background: "#123456" } })
    .jpeg()
    .toBuffer()
  pathname = `published-mockups/v1/${createHash("sha256").update(bytes).digest("hex")}.jpg`
  hosted = `https://${blobHost}/${pathname}`
  differentBytes = await sharp({ create: { width: 500, height: 500, channels: 3, background: "#abcdef" } })
    .jpeg()
    .toBuffer()
})

function fixture() {
  const receipts = new Map<string, string>()
  const uploads = {
    read: vi.fn(async (key: string) => receipts.get(key) ?? null),
    save: vi.fn(async (key: string, url: string) => {
      receipts.set(key, url)
    }),
  }
  const request = vi.fn(async () => new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg" } }))
  const stored = new Map<string, { url: string; pathname: string; contentType: string; size: number }>()
  const blob = {
    put: vi.fn(async (path: string, body: Buffer, options: { contentType: string }) => {
      if (stored.has(path)) throw new Error("Immutable object already exists")
      const result = { url: `https://${blobHost}/${path}`, pathname: path, contentType: options.contentType }
      stored.set(path, { ...result, size: body.length })
      return result
    }),
    head: vi.fn(async (path: string) => {
      const result = stored.get(path)
      if (!result) throw new BlobNotFoundError()
      return result
    }),
  }
  const snapshot = {
    id: "published-product",
    title: "Previous approved design",
    print_areas: [{ variants: [1, 2] }],
    images: [
      { src: front, variant_ids: [1, 2], is_default: true, custom: { preserved: true } },
      { src: back, variant_ids: [1], is_default: false, custom: { preserved: false } },
    ],
  }
  return {
    receipts,
    stored,
    uploads,
    blob,
    request,
    snapshot,
    options: {
      snapshot,
      revisionKey: "publish:product:event:fingerprint",
      uploads,
      deadline: 100_000,
      blobHost,
      now: () => 1000,
      fetch: request,
      blob,
    },
  }
}

describe("hosting frozen published mockups", () => {
  it("copies bytes to immutable hash paths while preserving image order, mappings, and other snapshot fields", async () => {
    const { options, snapshot, blob } = fixture()
    const before = structuredClone(snapshot)
    const result = await hostPublishedImages(options)
    expect(result).toEqual({
      complete: true,
      snapshot: { ...before, images: before.images.map((image) => ({ ...image, src: hosted, source_src: image.src })) },
    })
    expect(snapshot).toEqual(before)
    expect(blob.put).toHaveBeenCalledWith(
      pathname,
      bytes,
      expect.objectContaining({
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "image/jpeg",
        cacheControlMaxAge: 31_536_000,
      })
    )
  })

  it("resumes from durable receipts after a bounded batch without re-downloading completed images", async () => {
    const { options, request, uploads, snapshot } = fixture()
    request
      .mockResolvedValueOnce(new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg" } }))
      .mockImplementation(
        async () => new Response(new Uint8Array(differentBytes), { headers: { "content-type": "image/jpeg" } })
      )
    const first = await hostPublishedImages({ ...options, maxImages: 1 })
    expect(first.complete).toBe(false)
    expect(first.snapshot.images).toEqual([
      { ...snapshot.images[0], src: hosted, source_src: front },
      snapshot.images[1],
    ])
    expect(snapshot.images[0]?.src).toBe(front)
    const second = await hostPublishedImages({ ...options, maxImages: 1 })
    expect(second.complete).toBe(true)
    // One candidate download discovers that the next object would exceed this run's upload budget.
    expect(request).toHaveBeenCalledTimes(3)
    expect(uploads.save).toHaveBeenCalledTimes(2)
    expect(uploads.save.mock.calls.every(([key]) => /^[a-f0-9]{64}$/.test(key))).toBe(true)
  })

  it("reuses repeated source URLs within one batch even with different color mappings", async () => {
    const { options, snapshot, request, uploads } = fixture()
    snapshot.images[1]!.src = front
    const result = await hostPublishedImages({ ...options, maxImages: 1 })
    expect(result.complete).toBe(true)
    expect(request).toHaveBeenCalledOnce()
    expect(uploads.save).toHaveBeenCalledOnce()
  })

  it("refreshes source bytes for a new revision while unchanged bytes retain their URL", async () => {
    const { options, request, uploads, blob } = fixture()
    await hostPublishedImages(options)
    await hostPublishedImages({ ...options, revisionKey: "publish:product:next-event:new-fingerprint" })
    expect(request).toHaveBeenCalledTimes(4)
    expect(new Set(uploads.save.mock.calls.map(([key]) => key)).size).toBe(4)
    expect(new Set(uploads.save.mock.calls.map(([, url]) => url))).toEqual(new Set([hosted]))
    expect(blob.put).toHaveBeenCalledOnce()
  })

  it("leaves completed hosted snapshots and unrelated snapshot fields unchanged", async () => {
    const { options, request, stored } = fixture()
    stored.set(pathname, { url: hosted, pathname, contentType: "image/jpeg", size: bytes.length })
    const snapshot = {
      images: [
        { src: hosted, variant_ids: [1] },
        { src: front, is_selected_for_publishing: false },
      ],
    }
    const result = await hostPublishedImages({ ...options, snapshot })
    expect(result.complete).toBe(true)
    expect(result.snapshot.images).toEqual([
      snapshot.images[0],
      { ...snapshot.images[1], src: hosted, source_src: front },
    ])
    expect(request).toHaveBeenCalledOnce()
  })

  it("yields before starting network work when the worker deadline is near", async () => {
    const { options, request, blob, uploads } = fixture()
    expect((await hostPublishedImages({ ...options, deadline: 2499 })).complete).toBe(false)
    expect(request).not.toHaveBeenCalled()
    expect(blob.put).not.toHaveBeenCalled()
    expect(uploads.save).not.toHaveBeenCalled()
  })

  it("stops receipt reads at the deadline even when every image was already uploaded", async () => {
    const { options, uploads, request, snapshot } = fixture()
    let now = 1000
    uploads.read.mockImplementation(async () => {
      now = options.deadline
      return hosted
    })
    const result = await hostPublishedImages({ ...options, now: () => now })
    expect(result.complete).toBe(false)
    expect(result.snapshot.images).toEqual(snapshot.images)
    expect(uploads.read).toHaveBeenCalledOnce()
    expect(request).not.toHaveBeenCalled()
  })

  it.each([
    "http://images-api.printify.com/mockup/product.jpg",
    "https://user:password@images-api.printify.com/mockup/product.jpg",
    "https://images-api.printify.com:8443/mockup/product.jpg",
    "https://images-api.printify.com:443/mockup/product.jpg",
    "https://images-api.printify.com/mockup/product.jpg#fragment",
    "https://images-api.printify.com/api/file/print-source.png",
    "https://images-api.printify.com/mockup/../api/file/print-source.png",
    "https://images-api.printify.com.example.org/mockup/product.jpg",
    "https://127.0.0.1/mockup/product.jpg",
    "https://otherstore.public.blob.vercel-storage.com/published-mockups/v1/fake.jpg",
  ])("rejects sources outside the mockup allowlist: %s", async (src) => {
    const { options, request, uploads } = fixture()
    await expect(hostPublishedImages({ ...options, snapshot: { images: [{ src }] } })).rejects.toMatchObject({
      code: "IMAGE_SOURCE_INVALID",
      retryable: false,
    })
    expect(request).not.toHaveBeenCalled()
    expect(uploads.read).not.toHaveBeenCalled()
  })

  it("verifies existing content after an immutable-path conflict or uncertain upload", async () => {
    const { options, blob, request, uploads } = fixture()
    blob.put.mockRejectedValueOnce(new Error("blob exists or upload response lost"))
    blob.head
      .mockRejectedValueOnce(new BlobNotFoundError())
      .mockResolvedValueOnce({ url: hosted, pathname, contentType: "image/jpeg", size: bytes.length })
    const result = await hostPublishedImages({ ...options, snapshot: { images: [{ src: front }] } })
    expect(result.complete).toBe(true)
    expect(request.mock.calls).toHaveLength(2)
    expect(blob.head).toHaveBeenCalledWith(pathname, expect.objectContaining({ abortSignal: expect.any(AbortSignal) }))
    expect(uploads.save).toHaveBeenCalledWith(expect.any(String), hosted)
  })

  it("rejects a same-path collision with mismatched metadata", async () => {
    const { options, blob, uploads } = fixture()
    blob.put.mockRejectedValueOnce(new Error("exists"))
    blob.head.mockResolvedValueOnce({ url: hosted, pathname, contentType: "image/jpeg", size: bytes.length + 1 })
    await expect(hostPublishedImages(options)).rejects.toMatchObject({
      code: "IMAGE_STORAGE_CONFLICT",
      retryable: false,
    })
    expect(uploads.save).not.toHaveBeenCalled()
    expect(blob.put).not.toHaveBeenCalled()
  })

  it("treats a failed verification download as storage unavailability rather than a merchant image failure", async () => {
    const { options, blob, request, uploads } = fixture()
    blob.put.mockRejectedValueOnce(new Error("upload response lost"))
    blob.head
      .mockRejectedValueOnce(new BlobNotFoundError())
      .mockResolvedValueOnce({ url: hosted, pathname, contentType: "image/jpeg", size: bytes.length })
    request
      .mockResolvedValueOnce(new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg" } }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(hostPublishedImages(options)).rejects.toMatchObject({
      code: "IMAGE_STORAGE_UNAVAILABLE",
      retryable: true,
    })
    expect(uploads.save).not.toHaveBeenCalled()
  })

  it("checks the actual hash before accepting a same-path collision with plausible metadata", async () => {
    const { options, blob, request, uploads } = fixture()
    const other = await sharp({ create: { width: 500, height: 500, channels: 3, background: "#abcdef" } })
      .jpeg()
      .toBuffer()
    blob.put.mockRejectedValueOnce(new Error("exists"))
    blob.head
      .mockRejectedValueOnce(new BlobNotFoundError())
      .mockResolvedValueOnce({ url: hosted, pathname, contentType: "image/jpeg", size: bytes.length })
    request
      .mockResolvedValueOnce(new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(other), { headers: { "content-type": "image/jpeg" } }))
    await expect(hostPublishedImages(options)).rejects.toMatchObject({
      code: "IMAGE_STORAGE_CONFLICT",
      retryable: false,
    })
    expect(uploads.save).not.toHaveBeenCalled()
  })

  it("retries an unconfirmed storage failure but reports configuration failures separately", async () => {
    const { options, blob } = fixture()
    blob.put.mockRejectedValueOnce(new Error("secret storage failure"))
    blob.head.mockRejectedValueOnce(new BlobNotFoundError())
    await expect(hostPublishedImages(options)).rejects.toMatchObject({
      code: "IMAGE_STORAGE_UNAVAILABLE",
      retryable: true,
    })
    blob.put.mockRejectedValueOnce(new BlobAccessError())
    await expect(hostPublishedImages(options)).rejects.toMatchObject({
      code: "IMAGE_STORAGE_CONFIGURATION",
      retryable: false,
    })
  })

  it("rejects receipts and SDK results outside the configured public store", async () => {
    const { options, uploads, blob } = fixture()
    const wrongUrl = hosted.replace("teststore", "otherstore")
    uploads.read.mockResolvedValueOnce(wrongUrl)
    await expect(hostPublishedImages(options)).rejects.toMatchObject({ code: "IMAGE_STORAGE_CONFIGURATION" })
    expect(blob.put).not.toHaveBeenCalled()
    blob.put.mockResolvedValueOnce({ url: wrongUrl, pathname, contentType: "image/jpeg" })
    await expect(hostPublishedImages(options)).rejects.toMatchObject({ code: "IMAGE_STORAGE_CONFIGURATION" })
    expect(uploads.save).not.toHaveBeenCalled()
  })

  it("turns receipt persistence failures into safe retryable errors", async () => {
    const { options, uploads } = fixture()
    uploads.read.mockRejectedValueOnce(new Error("secret SQL query"))
    await expect(hostPublishedImages(options)).rejects.toMatchObject({
      code: "IMAGE_RECEIPT_UNAVAILABLE",
      retryable: true,
    })
    uploads.save.mockRejectedValueOnce(new Error("secret DB address"))
    await expect(hostPublishedImages(options)).rejects.toMatchObject({
      code: "IMAGE_RECEIPT_UNAVAILABLE",
      retryable: true,
    })
  })

  it("finishes more than four existing hash hits with no rejected uploads or Blob downloads", async () => {
    const { options, blob, request, stored } = fixture()
    const imageBytes = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        sharp({ create: { width: 500, height: 500, channels: 3, background: `#${String(index).repeat(6)}` } })
          .jpeg()
          .toBuffer()
      )
    )
    const snapshot = {
      images: imageBytes.map((_, index) => ({ src: `${front}&image=${index}`, variant_ids: [index] })),
    }
    for (const image of imageBytes) {
      const path = `published-mockups/v1/${createHash("sha256").update(image).digest("hex")}.jpg`
      stored.set(path, {
        url: `https://${blobHost}/${path}`,
        pathname: path,
        contentType: "image/jpeg",
        size: image.length,
      })
      request.mockResolvedValueOnce(new Response(new Uint8Array(image), { headers: { "content-type": "image/jpeg" } }))
    }
    expect((await hostPublishedImages({ ...options, snapshot })).complete).toBe(true)
    expect(blob.head).toHaveBeenCalledTimes(8)
    expect(blob.put).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledTimes(8)
  })

  it("keeps original mockup provenance private after hosting", async () => {
    const { options } = fixture()
    const source = `${front}&camera_label=person-1-front`
    options.snapshot.images[0]!.src = source
    const result = await hostPublishedImages(options)
    const images = result.snapshot.images as Record<string, unknown>[]
    expect(images[0]).toMatchObject({ src: hosted, source_src: source, variant_ids: [1, 2], is_default: true })
    const parsed = catalogProductSchema.shape.images.parse(images)
    expect(parsed[0]).toMatchObject({ src: hosted, view_key: "person-1-front" })
    expect(JSON.stringify(parsed)).not.toMatch(/source_src|images-api\.printify\.com/)
  })

  it("rehosts an old public Blob store from vetted provenance without fetching the old store", async () => {
    const { options, request, blob } = fixture()
    const image = {
      src: hosted.replace("teststore", "old-store"),
      source_src: front,
      variant_ids: [7],
      is_default: true,
    }
    const result = await hostPublishedImages({ ...options, snapshot: { images: [image] } })
    expect(result).toEqual({ snapshot: { images: [{ ...image, src: hosted }] }, complete: true })
    expect(request).toHaveBeenCalledExactlyOnceWith(front, expect.any(Object))
    expect(blob.put).toHaveBeenCalledOnce()
  })

  it("recreates an accidentally deleted object using the original bytes and immutable URL", async () => {
    const { options, request, blob } = fixture()
    const image = { src: hosted, source_src: front, variant_ids: [7] }
    const result = await hostPublishedImages({ ...options, snapshot: { images: [image] } })
    expect(result).toEqual({ snapshot: { images: [image] }, complete: true })
    expect(blob.put).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledExactlyOnceWith(front, expect.any(Object))
  })

  it("recovers missing objects referenced by receipts instead of reactivating their broken URLs", async () => {
    const { options, request, blob, uploads } = fixture()
    uploads.read.mockResolvedValueOnce(hosted)
    expect((await hostPublishedImages({ ...options, snapshot: { images: [{ src: front }] } })).complete).toBe(true)
    expect(request).toHaveBeenCalledExactlyOnceWith(front, expect.any(Object))
    expect(blob.put).toHaveBeenCalledOnce()
    expect(uploads.save).toHaveBeenCalledWith(expect.any(String), hosted)
  })

  it.each(["existing store", "rotated store", "receipt"])(
    "refuses mutated Printify bytes when recovering %s",
    async (kind) => {
      const { options, request, blob, uploads } = fixture()
      request.mockResolvedValueOnce(
        new Response(new Uint8Array(differentBytes), { headers: { "content-type": "image/jpeg" } })
      )
      const image =
        kind === "receipt"
          ? { src: front }
          : { src: kind === "existing store" ? hosted : hosted.replace("teststore", "old-store"), source_src: front }
      if (kind === "receipt") uploads.read.mockResolvedValueOnce(hosted)
      await expect(hostPublishedImages({ ...options, snapshot: { images: [image] } })).rejects.toMatchObject({
        code: "IMAGE_SOURCE_CHANGED",
        retryable: false,
      })
      expect(blob.put).not.toHaveBeenCalled()
      expect(uploads.save).not.toHaveBeenCalled()
    }
  )

  it.each([undefined, "https://127.0.0.1/mockup/private", "https://images-api.printify.com/api/file/private.png"])(
    "does not recover a hosted image from missing or unsafe provenance",
    async (source_src) => {
      const { options, request, blob } = fixture()
      const image = { src: hosted.replace("teststore", "old-store"), source_src }
      await expect(hostPublishedImages({ ...options, snapshot: { images: [image] } })).rejects.toMatchObject({
        code: "IMAGE_SOURCE_INVALID",
      })
      expect(request).not.toHaveBeenCalled()
      expect(blob.put).not.toHaveBeenCalled()
    }
  )

  it("will not use provenance to broaden a non-Blob source URL", async () => {
    const { options, request } = fixture()
    await expect(
      hostPublishedImages({
        ...options,
        snapshot: { images: [{ src: "https://untrusted.example/image.jpg", source_src: front }] },
      })
    ).rejects.toMatchObject({ code: "IMAGE_SOURCE_INVALID" })
    expect(request).not.toHaveBeenCalled()
  })
})
