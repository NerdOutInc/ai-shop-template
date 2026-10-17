import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { put } from "@vercel/blob"
import sharp from "sharp"
import { readBoundedArtworkStream } from "@/features/design-library/read-bounded-artwork-stream.server"
import { env } from "@/lib/env"
import { getWeeklyHeroStore } from "./get-weekly-hero-store.server"
import { WeeklyHeroError } from "./weekly-hero-error"

export async function uploadHeroImage(request: Request, actor: string) {
  const kind = new URL(request.url).searchParams.get("kind")
  if ((kind !== "desktop" && kind !== "mobile") || !request.body)
    throw new WeeklyHeroError("Choose a desktop or mobile image.")
  if (!env.PRIVATE_BLOB_READ_WRITE_TOKEN) throw new Error("Private image storage is not configured")
  const store = getWeeklyHeroStore()
  let bytes: Buffer
  try {
    const length = Number(request.headers.get("x-hero-bytes"))
    if (!Number.isSafeInteger(length) || length < 1 || length > 3 * 1024 * 1024) throw new Error("size")
    bytes = await readBoundedArtworkStream(request.body, length)
  } catch {
    throw new WeeklyHeroError(
      "Use an image smaller than 3 MB. Export a high-quality WebP rather than shrinking its dimensions."
    )
  }
  const metadata = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "truncated" })
    .metadata()
    .catch(() => null)
  if (
    !metadata ||
    !["png", "jpeg", "webp"].includes(metadata.format!) ||
    (metadata.pages ?? 1) !== 1 ||
    !metadata.width ||
    !metadata.height
  )
    throw new WeeklyHeroError("Use a single PNG, JPEG or WebP image.")
  if (metadata.orientation && metadata.orientation !== 1)
    throw new WeeklyHeroError("Export the image with its rotation applied first.")
  const ratio = kind === "desktop" ? 3 : 4 / 7
  const minWidth = kind === "desktop" ? 1800 : 800
  if (metadata.width < minWidth || Math.abs(metadata.width / metadata.height - ratio) > 0.005)
    throw new WeeklyHeroError(
      kind === "desktop"
        ? "Use a 3:1 desktop panorama at least 1800 pixels wide."
        : "Use a separate 4:7 mobile composition at least 800 pixels wide."
    )
  try {
    await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "truncated" }).timeout({ seconds: 5 }).stats()
  } catch {
    throw new WeeklyHeroError("Use a single PNG, JPEG or WebP image.")
  }
  const id = randomUUID(),
    extension = metadata.format === "jpeg" ? "jpg" : metadata.format
  const pathname = `weekly-heroes/v1/${id}.${extension}`,
    contentType = `image/${metadata.format}`
  await put(pathname, bytes, {
    access: "private",
    token: env.PRIVATE_BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType,
  })
  const asset = {
    id,
    kind: kind as "desktop" | "mobile",
    width: metadata.width,
    height: metadata.height,
    pathname,
    contentType,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
  await store.addAsset(asset, actor)
  return { id, kind, width: asset.width, height: asset.height }
}
