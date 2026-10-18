import "server-only"
import { createHash } from "node:crypto"
import { head, put } from "@vercel/blob"
import { isPublicBlobHost } from "@/lib/is-public-blob-host"
import { classifyImageStorageError } from "./classify-image-storage-error"
import { PublishedImageError } from "./published-image-error"
import { readPublishedImage } from "./read-published-image.server"

type Storage = {
  put: (
    pathname: string,
    bytes: Buffer,
    options: {
      access: "public"
      addRandomSuffix: false
      allowOverwrite: false
      cacheControlMaxAge: number
      contentType: string
      abortSignal: AbortSignal
    }
  ) => Promise<{ url: string; pathname: string; contentType: string }>
  head: (
    pathname: string,
    options: { abortSignal: AbortSignal }
  ) => Promise<{ url: string; pathname: string; contentType: string; size: number }>
}

/** Immutable upload; only an uncertain response permits head and byte-verified recovery. */
export async function putPublishedImage(input: {
  pathname: string
  bytes: Buffer
  contentType: string
  blobHost: string
  signal: (timeout: number) => AbortSignal
  blob?: Storage
  fetch?: typeof fetch
  timeouts?: { put: number; head: number; read: number }
}) {
  if (!isPublicBlobHost(input.blobHost)) throw new PublishedImageError("IMAGE_STORAGE_CONFIGURATION", false)
  const storage = input.blob ?? { put, head }
  const timeouts = input.timeouts ?? { put: 15000, head: 5000, read: 10000 }
  const valid = (object: { url: string; pathname: string; contentType: string }) =>
    object.url === `https://${input.blobHost}/${input.pathname}` &&
    object.pathname === input.pathname &&
    object.contentType === input.contentType
  const putSignal = input.signal(timeouts.put)
  try {
    const object = await storage.put(input.pathname, input.bytes, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 31536000,
      contentType: input.contentType,
      abortSignal: putSignal,
    })
    if (!valid(object)) throw new PublishedImageError("IMAGE_STORAGE_CONFIGURATION", false)
    return object.url
  } catch (error) {
    const classified = classifyImageStorageError(error)
    if (!classified.retryable) throw classified
  }
  const headSignal = input.signal(timeouts.head)
  let object: Awaited<ReturnType<Storage["head"]>>
  try {
    object = await storage.head(input.pathname, { abortSignal: headSignal })
  } catch (error) {
    throw classifyImageStorageError(error)
  }
  if (!valid(object) || object.size !== input.bytes.byteLength)
    throw new PublishedImageError("IMAGE_STORAGE_CONFLICT", false)
  const readSignal = input.signal(timeouts.read)
  let recovered: Awaited<ReturnType<typeof readPublishedImage>>
  try {
    recovered = await readPublishedImage(object.url, { fetch: input.fetch ?? fetch, signal: readSignal })
  } catch (error) {
    const invalid = error instanceof PublishedImageError && error.code === "IMAGE_CONTENT_INVALID"
    throw new PublishedImageError(invalid ? "IMAGE_STORAGE_CONFLICT" : "IMAGE_STORAGE_UNAVAILABLE", !invalid)
  }
  if (
    createHash("sha256").update(recovered.bytes).digest("hex") !==
    createHash("sha256").update(input.bytes).digest("hex")
  )
    throw new PublishedImageError("IMAGE_STORAGE_CONFLICT", false)
  return object.url
}
