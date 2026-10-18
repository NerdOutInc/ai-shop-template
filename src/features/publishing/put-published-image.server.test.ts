// @vitest-environment node
import { BlobAccessError, BlobNotFoundError, BlobStoreSuspendedError } from "@vercel/blob"
import sharp from "sharp"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { PublishedImageError } from "./published-image-error"
import { putPublishedImage } from "./put-published-image.server"

vi.mock("server-only", () => ({}))

const blobHost = "teststore.public.blob.vercel-storage.com"
const pathname = "published-mockups/v1/sample.jpg"
const url = `https://${blobHost}/${pathname}`
let bytes: Buffer
let otherBytes: Buffer

beforeAll(async () => {
  const image = (background: string) =>
    sharp({ create: { width: 300, height: 300, channels: 3, background } })
      .jpeg()
      .toBuffer()
  bytes = await image("#123456")
  otherBytes = await image("#abcdef")
})

type Stored = { url: string; pathname: string; contentType: string; size: number }

function fixture(
  options: { putError?: unknown; stored?: Partial<Stored>; headError?: unknown; readBack?: Response } = {}
) {
  const blob = {
    put: vi.fn(async (path: string, _body: Buffer, putOptions: { contentType: string }) => {
      if (options.putError) throw options.putError
      return { url: `https://${blobHost}/${path}`, pathname: path, contentType: putOptions.contentType }
    }),
    head: vi.fn(async (path: string): Promise<Stored> => {
      if (options.headError) throw options.headError
      return {
        url: `https://${blobHost}/${path}`,
        pathname: path,
        contentType: "image/jpeg",
        size: bytes.byteLength,
        ...options.stored,
      }
    }),
  }
  const request = vi.fn(
    async () => options.readBack ?? new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg" } })
  )
  const signal = vi.fn((timeout: number) => AbortSignal.timeout(timeout))
  const upload = (input: { blobHost?: string; signal?: (timeout: number) => AbortSignal } = {}) =>
    putPublishedImage({
      pathname,
      bytes,
      contentType: "image/jpeg",
      blobHost: input.blobHost ?? blobHost,
      signal: input.signal ?? signal,
      blob,
      fetch: request,
    })
  return { blob, request, signal, upload }
}

function failure(code: PublishedImageError["code"], retryable: boolean) {
  return expect.objectContaining({ name: "PublishedImageError", code, retryable })
}

describe("immutable public image uploads", () => {
  it("uploads without overwriting and returns the exact public URL", async () => {
    const { blob, request, upload } = fixture()

    await expect(upload()).resolves.toBe(url)
    expect(blob.put).toHaveBeenCalledWith(
      pathname,
      bytes,
      expect.objectContaining({
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "image/jpeg",
      })
    )
    expect(blob.head).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it.each(["store.example", "teststore.private.blob.vercel-storage.com"])(
    "rejects the non-public storage host %s before uploading",
    async (host) => {
      const { blob, upload } = fixture()

      await expect(upload({ blobHost: host })).rejects.toEqual(failure("IMAGE_STORAGE_CONFIGURATION", false))
      expect(blob.put).not.toHaveBeenCalled()
    }
  )

  it("treats an upload response for another object as a configuration failure", async () => {
    const { blob, upload } = fixture()
    blob.put.mockResolvedValueOnce({ url: "https://store.example/elsewhere.jpg", pathname, contentType: "image/jpeg" })

    await expect(upload()).rejects.toEqual(failure("IMAGE_STORAGE_CONFIGURATION", false))
    expect(blob.head).not.toHaveBeenCalled()
  })

  it.each([
    ["access", new BlobAccessError()],
    ["suspended store", new BlobStoreSuspendedError()],
  ])("does not probe storage after a %s error", async (_name, error) => {
    const { blob, upload } = fixture({ putError: error })

    await expect(upload()).rejects.toEqual(failure("IMAGE_STORAGE_CONFIGURATION", false))
    expect(blob.head).not.toHaveBeenCalled()
  })

  it("recovers a lost upload response only after matching the stored bytes", async () => {
    const { blob, request, upload } = fixture({ putError: new Error("socket hang up") })

    await expect(upload()).resolves.toBe(url)
    expect(blob.head).toHaveBeenCalledWith(pathname, expect.objectContaining({ abortSignal: expect.any(AbortSignal) }))
    expect(request).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: "error" }))
  })

  it.each([
    ["URL", { url: "https://other.public.blob.vercel-storage.com/published-mockups/v1/sample.jpg" }],
    ["pathname", { pathname: "published-mockups/v1/other.jpg" }],
    ["content type", { contentType: "image/png" }],
    ["size", { size: 1 }],
  ])("reports a conflict when the recovered object has a different %s", async (_field, stored) => {
    const { request, upload } = fixture({ putError: new Error("socket hang up"), stored })

    await expect(upload()).rejects.toEqual(failure("IMAGE_STORAGE_CONFLICT", false))
    expect(request).not.toHaveBeenCalled()
  })

  it("reports a conflict when the recovered bytes differ", async () => {
    const { upload } = fixture({
      putError: new Error("socket hang up"),
      readBack: new Response(new Uint8Array(otherBytes), { headers: { "content-type": "image/jpeg" } }),
    })

    await expect(upload()).rejects.toEqual(failure("IMAGE_STORAGE_CONFLICT", false))
  })

  it("reports a conflict when the recovered object is not a valid image", async () => {
    const { upload } = fixture({
      putError: new Error("socket hang up"),
      readBack: new Response("not an image", { headers: { "content-type": "text/plain" } }),
    })

    await expect(upload()).rejects.toEqual(failure("IMAGE_STORAGE_CONFLICT", false))
  })

  it("keeps a temporarily unreadable recovered object retryable", async () => {
    const { upload } = fixture({ putError: new Error("socket hang up"), readBack: new Response(null, { status: 503 }) })

    await expect(upload()).rejects.toEqual(failure("IMAGE_STORAGE_UNAVAILABLE", true))
  })

  it.each([
    ["a missing object", new BlobNotFoundError(), "IMAGE_STORAGE_UNAVAILABLE", true],
    ["an unavailable store", new Error("timeout"), "IMAGE_STORAGE_UNAVAILABLE", true],
    ["a suspended store", new BlobStoreSuspendedError(), "IMAGE_STORAGE_CONFIGURATION", false],
  ] as const)("classifies %s during recovery", async (_name, headError, code, retryable) => {
    const { upload } = fixture({ putError: new Error("socket hang up"), headError })

    await expect(upload()).rejects.toEqual(failure(code, retryable))
  })

  it("lets a caller deadline stop recovery before the next storage request", async () => {
    const deadline = new Error("deadline reached")
    const { blob, upload } = fixture({ putError: new Error("socket hang up") })
    const signal = vi.fn((timeout: number) => {
      if (signal.mock.calls.length > 1) throw deadline
      return AbortSignal.timeout(timeout)
    })

    await expect(upload({ signal })).rejects.toBe(deadline)
    expect(blob.head).not.toHaveBeenCalled()
  })
})
