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
const exists = (path) =>
  readFile(path).then(
    () => true,
    () => false
  )

/** The same request, references, provider and model: the identity a receipt may be continued under. */
function sameGeneration(existing, request, references, provider) {
  return (
    existing.provider === provider.name &&
    (existing.model ?? null) === (provider.model ?? null) &&
    requestFields.every((field) => existing.request?.[field] === request[field]) &&
    JSON.stringify((existing.request?.referenceImages ?? []).map((item) => item.sha256)) ===
      JSON.stringify(references.map((item) => item.sha256))
  )
}

async function readReceipt(request) {
  return readFile(receiptFilePath(request), "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => null)
}

async function verifyRecordedImages(images) {
  for (const image of images) {
    const bytes = await readFile(image.path).catch(() => null)
    if (!bytes || sha256(bytes) !== image.sha256) return false
  }
  return true
}

/**
 * Look at the destination before any paid request. A complete receipt or a stray output file
 * means this baseName was already used: fail now, not after the provider has billed. An incomplete
 * receipt for the same request, provider and model is resumable, so its saved images are kept and
 * only the rest run; a different provider or model would mislabel the saved images' provenance.
 */
export async function prepareImageOutput(request, references, provider) {
  await mkdir(request.outputDir, { recursive: true })
  const existing = await readReceipt(request)
  let images = []
  if (existing) {
    if (existing.status !== "incomplete")
      throw new Error(
        `${receiptFilePath(request)} already records a complete generation; choose a new baseName instead of paying for it again`
      )
    if (!sameGeneration(existing, request, references, provider))
      throw new Error(
        `${receiptFilePath(request)} records an incomplete ${existing.provider}/${existing.model ?? "unknown"} generation of a different request; choose a new baseName rather than mixing provenance`
      )
    images = Array.isArray(existing.images) ? existing.images : []
    if (!(await verifyRecordedImages(images)))
      throw new Error(`An image recorded in ${receiptFilePath(request)} is missing or changed; choose a new baseName`)
  }
  for (let index = images.length + 1; index <= request.count; index++) {
    const path = imageFilePath(request, index)
    if (await exists(path))
      throw new Error(
        existing
          ? `${path} exists but is not recorded in the incomplete receipt (an interrupted run left it behind); inspect it, move it aside or choose a new baseName before resuming`
          : `${path} already exists; choose a new baseName so reviewed output is never replaced`
      )
  }
  return { images, resumed: Boolean(existing) }
}

/**
 * Write each generated image the moment it arrives and keep the receipt current, so a failure on
 * a later image leaves the earlier paid results on disk, recorded as an incomplete batch that the
 * same command can resume. Image files use exclusive writes; only a receipt this run created, or a
 * validated incomplete one it resumed, is ever rewritten.
 */
export function createImageWriter({ request, provider, references, images = [], resumed = false }) {
  const state = { requestId: provider.requestId ?? null, seed: provider.seed ?? null, notes: [] }
  let owned = resumed
  const save = async (status) => {
    await writeFile(receiptFilePath(request), JSON.stringify(receipt(status), null, 2) + "\n", {
      flag: owned ? "w" : "wx",
    })
    owned = true
    return receipt(status)
  }
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

/**
 * Hash files a host tool produced at the expected paths, producing the same receipt shape. A
 * completed receipt is immutable: the identical completion is returned as it is, anything else
 * (a changed prompt, a receipt from a paid provider) is refused rather than relabelled.
 */
export async function completeHostReceipt({ request, provider, references = [] }) {
  const images = []
  for (let index = 1; index <= request.count; index++) {
    const path = imageFilePath(request, index)
    const bytes = await readFile(path).catch(() => null)
    if (!bytes) throw new Error(`Expected host output is missing: ${path}`)
    images.push(describe(path, bytes, "image/png"))
  }
  await mkdir(request.outputDir, { recursive: true })
  const existing = await readReceipt(request)
  if (existing) {
    const identical =
      existing.status === "complete" &&
      sameGeneration(existing, request, references, provider) &&
      JSON.stringify((existing.images ?? []).map((image) => image.sha256)) ===
        JSON.stringify(images.map((image) => image.sha256))
    if (identical) return { ...existing, receiptPath: receiptFilePath(request) }
    throw new Error(
      `${receiptFilePath(request)} already exists for a different ${existing.provider ?? "unknown"} generation; receipts are immutable, so choose a new baseName`
    )
  }
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
