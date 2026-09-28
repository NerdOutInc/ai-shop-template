import "server-only"

import sharp from "sharp"

import { PublishedImageError } from "./published-image-error"

const maxBytes = 16_000_000
const maxPixels = 25_000_000
const formats = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as const

export async function readPublishedImage(
  url: string,
  options: { fetch: typeof fetch; signal: AbortSignal }
): Promise<{ bytes: Buffer; contentType: string; extension: string }> {
  let response: Response
  try {
    response = await options.fetch(url, {
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "image/jpeg, image/png, image/webp" },
      signal: options.signal,
    })
  } catch {
    throw new PublishedImageError("IMAGE_SOURCE_UNAVAILABLE", true)
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined)
    throw new PublishedImageError(
      "IMAGE_SOURCE_UNAVAILABLE",
      response.status === 408 || response.status === 429 || response.status >= 500
    )
  }
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()
  const length = response.headers.get("content-length")
  if (
    !response.body ||
    !contentType ||
    !Object.values(formats).some((value) => value === contentType) ||
    (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes))
  ) {
    void response.body?.cancel().catch(() => undefined)
    throw new PublishedImageError("IMAGE_CONTENT_INVALID", false)
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      byteLength += chunk.value.byteLength
      if (byteLength > maxBytes) throw new PublishedImageError("IMAGE_CONTENT_INVALID", false)
      chunks.push(chunk.value)
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined)
    if (error instanceof PublishedImageError) throw error
    throw new PublishedImageError("IMAGE_SOURCE_UNAVAILABLE", true)
  } finally {
    reader.releaseLock()
  }
  const bytes = Buffer.concat(chunks, byteLength)
  try {
    if (options.signal.aborted) throw new PublishedImageError("IMAGE_SOURCE_UNAVAILABLE", true)
    // Inspect the original bytes without resizing, recompressing, or stripping provenance metadata.
    const metadata = await sharp(bytes, { limitInputPixels: maxPixels, failOn: "truncated" }).metadata()
    if (
      !metadata.format ||
      !(metadata.format in formats) ||
      formats[metadata.format as keyof typeof formats] !== contentType ||
      !metadata.width ||
      !metadata.height ||
      metadata.width < 250 ||
      metadata.height < 250 ||
      metadata.width * metadata.height > maxPixels ||
      (metadata.pages ?? 1) !== 1
    ) {
      throw new PublishedImageError("IMAGE_CONTENT_INVALID", false)
    }
    if (options.signal.aborted) throw new PublishedImageError("IMAGE_SOURCE_UNAVAILABLE", true)
    // Decoding catches truncated or corrupt files whose headers alone report plausible dimensions.
    await sharp(bytes, { limitInputPixels: maxPixels, failOn: "truncated" }).timeout({ seconds: 5 }).stats()
    return { bytes, contentType, extension: metadata.format === "jpeg" ? "jpg" : metadata.format }
  } catch (error) {
    if (error instanceof PublishedImageError) throw error
    throw new PublishedImageError("IMAGE_CONTENT_INVALID", false)
  }
}
