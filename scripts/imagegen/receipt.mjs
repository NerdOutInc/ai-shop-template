import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { readPngHeader } from "./png.mjs"

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }

export function imageFilePath(request, index, mimeType = "image/png") {
  return join(request.outputDir, `${request.baseName}-${index}.${extensions[mimeType] ?? "png"}`)
}

function describe(path, bytes, mimeType) {
  const header = mimeType === "image/png" ? readPngHeader(bytes) : null
  return {
    path,
    bytes: bytes.length,
    sha256: sha256(bytes),
    mimeType,
    width: header?.width ?? null,
    height: header?.height ?? null,
    alphaChannel: header?.alphaChannel ?? null,
  }
}

/**
 * Write generated images and the receipt that later feeds slot.register / asset.upload provenance.
 * Files are never overwritten: a second run with the same baseName must choose a new name, so an
 * earlier generation stays exactly as it was reviewed.
 */
export async function writeImageReceipt({ request, provider, images, references = [] }) {
  await mkdir(request.outputDir, { recursive: true })
  const written = []
  for (const [index, image] of images.entries()) {
    const path = imageFilePath(request, index + 1, image.mimeType)
    await writeFile(path, image.bytes, { flag: "wx" })
    written.push(describe(path, image.bytes, image.mimeType))
  }
  return saveReceipt(request, provider, written, references)
}

/** Hash files a host tool produced at the expected paths, producing the same receipt shape. */
export async function completeHostReceipt({ request, provider, references = [] }) {
  const images = []
  for (let index = 1; index <= request.count; index++) {
    const path = imageFilePath(request, index)
    const bytes = await readFile(path).catch(() => null)
    if (!bytes) throw new Error(`Expected host output is missing: ${path}`)
    images.push(describe(path, bytes, "image/png"))
  }
  return saveReceipt(request, provider, images, references)
}

export async function hashReferenceImages(paths) {
  const references = []
  for (const path of paths) {
    const bytes = await readFile(path).catch(() => null)
    if (!bytes) throw new Error(`Reference image is missing or unreadable: ${path}`)
    references.push({ path, data: bytes, bytes: bytes.length, sha256: sha256(bytes), mimeType: detectMimeType(bytes) })
  }
  return references
}

export function detectMimeType(bytes) {
  if (readPngHeader(bytes)) return "image/png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg"
  if (bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp"
  throw new Error("Reference images must be PNG, JPEG or WebP")
}

async function saveReceipt(request, provider, images, references) {
  const receipt = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    provider: provider.name,
    model: provider.model ?? null,
    requestId: provider.requestId ?? null,
    seed: provider.seed ?? null,
    request: {
      prompt: request.prompt,
      size: request.size,
      quality: request.quality,
      background: request.background,
      count: request.count,
      referenceImages: references,
    },
    images,
  }
  const path = join(request.outputDir, `${request.baseName}.receipt.json`)
  await writeFile(path, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" })
  return { ...receipt, receiptPath: path }
}
