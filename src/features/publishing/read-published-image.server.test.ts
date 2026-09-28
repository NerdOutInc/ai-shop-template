// @vitest-environment node
import sharp from "sharp"
import { describe, expect, it, vi } from "vitest"

import { readPublishedImage } from "./read-published-image.server"

vi.mock("server-only", () => ({}))

const source = "https://images-api.printify.com/mockup/product/front.jpg"

async function image(format: "jpeg" | "png" | "webp" = "jpeg", size = 500) {
  return sharp({ create: { width: size, height: size, channels: 3, background: "#d2c1a4" } })
    .toFormat(format)
    .toBuffer()
}

function read(response: Response) {
  return readPublishedImage(source, {
    fetch: vi.fn().mockResolvedValue(response),
    signal: AbortSignal.timeout(1000),
  })
}

describe("published mockup downloads", () => {
  it.each(["jpeg", "png", "webp"] as const)("preserves the original %s bytes", async (format) => {
    const bytes = await image(format)
    const request = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(bytes), {
        headers: { "content-type": `image/${format}; charset=binary` },
      })
    )
    const result = await readPublishedImage(source, { fetch: request, signal: AbortSignal.timeout(1000) })
    expect(result).toEqual({ bytes, contentType: `image/${format}`, extension: format === "jpeg" ? "jpg" : format })
    expect(request).toHaveBeenCalledWith(
      source,
      expect.objectContaining({ redirect: "error", cache: "no-store", signal: expect.any(AbortSignal) })
    )
  })

  it.each([
    [302, false],
    [403, false],
    [404, false],
    [408, true],
    [429, true],
    [503, true],
  ])("classifies HTTP %s without retaining provider content", async (status, retryable) => {
    await expect(read(new Response("secret provider response", { status: Number(status) }))).rejects.toMatchObject({
      code: "IMAGE_SOURCE_UNAVAILABLE",
      message: "IMAGE_SOURCE_UNAVAILABLE",
      retryable,
    })
  })

  it("rejects mismatched content type and corrupted bytes", async () => {
    const bytes = await image("png")
    for (const response of [
      new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg" } }),
      new Response("not an image", { headers: { "content-type": "image/png" } }),
      new Response(new Uint8Array(bytes), { headers: { "content-type": "text/html" } }),
      new Response(new Uint8Array(bytes.subarray(0, bytes.length - 100)), {
        headers: { "content-type": "image/png" },
      }),
    ]) {
      await expect(read(response)).rejects.toMatchObject({ code: "IMAGE_CONTENT_INVALID", retryable: false })
    }
  })

  it("rejects images too small for apparel without rejecting the current 250px minimum", async () => {
    await expect(
      read(new Response(new Uint8Array(await image("jpeg", 249)), { headers: { "content-type": "image/jpeg" } }))
    ).rejects.toMatchObject({ code: "IMAGE_CONTENT_INVALID" })
    await expect(
      read(new Response(new Uint8Array(await image("jpeg", 250)), { headers: { "content-type": "image/jpeg" } }))
    ).resolves.toMatchObject({ contentType: "image/jpeg" })
  })

  it("rejects image dimensions above the worker's 25 megapixel limit", async () => {
    const bytes = await image("jpeg")
    const frame = bytes.indexOf(Buffer.from([0xff, 0xc0]))
    expect(frame).toBeGreaterThan(0)
    bytes.writeUInt16BE(5000, frame + 5)
    bytes.writeUInt16BE(5001, frame + 7)
    expect(await sharp(bytes, { limitInputPixels: false }).metadata()).toMatchObject({ width: 5001, height: 5000 })
    await expect(
      read(new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg" } }))
    ).rejects.toMatchObject({ code: "IMAGE_CONTENT_INVALID", retryable: false })
  })

  it("accepts nonfatal JPEG warnings while retaining the exact provider bytes", async () => {
    const bytes = await image("jpeg")
    const warning = Buffer.concat([bytes.subarray(0, 2), Buffer.from([1, 2, 3, 4, 5]), bytes.subarray(2)])
    await expect(sharp(warning, { failOn: "warning" }).stats()).rejects.toThrow()
    await expect(
      read(new Response(new Uint8Array(warning), { headers: { "content-type": "image/jpeg" } }))
    ).resolves.toMatchObject({ bytes: warning, contentType: "image/jpeg" })
  })

  it("continues to reject truncated JPEG image data", async () => {
    const bytes = await image("jpeg")
    const truncated = bytes.subarray(0, bytes.length - 80)
    await expect(
      read(new Response(new Uint8Array(truncated), { headers: { "content-type": "image/jpeg" } }))
    ).rejects.toMatchObject({ code: "IMAGE_CONTENT_INVALID", retryable: false })
  })

  it("does not start decoding after the download's deadline has expired", async () => {
    const bytes = await image("jpeg")
    await expect(
      readPublishedImage(source, {
        fetch: vi
          .fn()
          .mockResolvedValue(new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg" } })),
        signal: AbortSignal.abort(),
      })
    ).rejects.toMatchObject({ code: "IMAGE_SOURCE_UNAVAILABLE", retryable: true })
  })

  it("rejects excessive declared size before consuming the body", async () => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { "content-type": "image/jpeg", "content-length": "16000001" },
    })
    await expect(read(response)).rejects.toMatchObject({ code: "IMAGE_CONTENT_INVALID", retryable: false })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("bounds a streamed body even when Content-Length is absent or dishonest", async () => {
    const cancel = vi.fn()
    let chunks = 0
    const stream = new ReadableStream({
      pull(controller) {
        chunks++
        controller.enqueue(new Uint8Array(1_000_000))
      },
      cancel,
    })
    await expect(
      read(new Response(stream, { headers: { "content-type": "image/jpeg", "content-length": "1" } }))
    ).rejects.toMatchObject({ code: "IMAGE_CONTENT_INVALID", retryable: false })
    expect(cancel).toHaveBeenCalledOnce()
    expect(chunks).toBeLessThanOrEqual(18)
  })

  it("makes network and interrupted body failures retryable without exposing the error", async () => {
    await expect(
      readPublishedImage(source, {
        fetch: vi.fn().mockRejectedValue(new Error("secret internal host")),
        signal: AbortSignal.timeout(1000),
      })
    ).rejects.toMatchObject({ code: "IMAGE_SOURCE_UNAVAILABLE", retryable: true })
    await expect(
      read(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("secret stream detail"))
            },
          }),
          { headers: { "content-type": "image/jpeg" } }
        )
      )
    ).rejects.toMatchObject({ code: "IMAGE_SOURCE_UNAVAILABLE", retryable: true })
  })
})
