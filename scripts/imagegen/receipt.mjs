import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { readPngHeader } from "./png.mjs"

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }

export function imageFilePath(request, index, mimeType = "image/png") {
  return join(request.outputDir, `${request.baseName}-${index}.${extensions[mimeType] ?? "png"}`)
}

export function receiptFilePath(request) {
  return join(request.outputDir, `${request.baseName}.receipt.json`)
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

const requestFields = ["prompt", "size", "quality", "background", "count"]

/**
 * Look at the destination before any paid request. A complete receipt or a stray output file
 * means this baseName was already used: fail now, not after the provider has billed. An incomplete
 * receipt for the same request is resumable, so its saved images are kept and only the rest run.
 */
export async function prepareImageOutput(request, references) {
  await mkdir(request.outputDir, { recursive: true })
  const existing = await readFile(receiptFilePath(request), "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => null)
  if (existing) {
    if (existing.status !== "incomplete")
      throw new Error(
        `${receiptFilePath(request)} already records a complete generation; choose a new baseName instead of paying for it again`
      )
    const same =
      requestFields.every((field) => existing.request?.[field] === request[field]) &&
      JSON.stringify((existing.request?.referenceImages ?? []).map((item) => item.sha256)) ===
        JSON.stringify(references.map((item) => item.sha256))
    if (!same)
      throw new Error(
        `${receiptFilePath(request)} records an incomplete generation of a different request; choose a new baseName`
      )
    const images = Array.isArray(existing.images) ? existing.images : []
    for (const image of images) {
      const bytes = await readFile(image.path).catch(() => null)
      if (!bytes || sha256(bytes) !== image.sha256)
        throw new Error(`${image.path} is missing or changed since its incomplete receipt; choose a new baseName`)
    }
    return { images, resumed: true }
  }
  for (let index = 1; index <= request.count; index++) {
    const path = imageFilePath(request, index)
    if (
      await readFile(path).then(
        () => true,
        () => false
      )
    )
      throw new Error(`${path} already exists; choose a new baseName so reviewed output is never replaced`)
  }
  return { images: [], resumed: false }
}

/**
 * Write each generated image the moment it arrives and keep the receipt current, so a failure on
 * a later image leaves the earlier paid results on disk, recorded as an incomplete batch that the
 * same command can resume. Image files use exclusive writes; only this run's receipt is rewritten.
 */
export function createImageWriter({ request, provider, references, images = [] }) {
  const state = { requestId: provider.requestId ?? null, seed: provider.seed ?? null, notes: [] }
  const save = (status) =>
    writeFile(receiptFilePath(request), JSON.stringify(receipt(status), null, 2) + "\n").then(() => receipt(status))
  const receipt = (status) => ({
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    status,
    provider: provider.name,
    model: provider.model ?? null,
    requestId: state.requestId,
    seed: state.seed,
    requested: request.count,
    completed: images.length,
    request: {
      prompt: request.prompt,
      size: request.size,
      quality: request.quality,
      background: request.background,
      count: request.count,
      referenceImages: references,
    },
    images,
    notes: state.notes,
  })
  return {
    get completed() {
      return images.length
    },
    async add(image, { requestId = null, seed = null } = {}) {
      state.requestId ??= requestId
      state.seed ??= seed
      const path = imageFilePath(request, images.length + 1, image.mimeType)
      await writeFile(path, image.bytes, { flag: "wx" })
      images.push(describe(path, image.bytes, image.mimeType))
      await save("incomplete")
    },
    async finish({ notes = [] } = {}) {
      state.notes = notes
      const saved = await save(images.length >= request.count ? "complete" : "incomplete")
      return { ...saved, receiptPath: receiptFilePath(request) }
    },
  }
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
  await mkdir(request.outputDir, { recursive: true })
  const writer = createImageWriter({ request, provider, references, images })
  return writer.finish()
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
