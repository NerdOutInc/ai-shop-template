import { isAbsolute, resolve } from "node:path"

export const IMAGE_SIZES = ["auto", "1024x1024", "1536x1024", "1024x1536", "1792x1024", "1024x1792"]
export const IMAGE_QUALITIES = ["auto", "low", "medium", "high"]
export const IMAGE_BACKGROUNDS = ["opaque", "transparent"]
const baseName = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/i

/**
 * Validate one provider-neutral generation request. Providers translate this shape; the
 * caller never writes provider parameters, so a prompt file is portable across hosts.
 */
export function normalizeImageRequest(input, { cwd = process.cwd() } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("The input must be a JSON object")
  const problems = []
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : ""
  if (!prompt) problems.push("prompt must be a nonempty string")
  const size = input.size ?? "auto"
  if (!IMAGE_SIZES.includes(size)) problems.push(`size must be one of ${IMAGE_SIZES.join(", ")}`)
  const quality = input.quality ?? "auto"
  if (!IMAGE_QUALITIES.includes(quality)) problems.push(`quality must be one of ${IMAGE_QUALITIES.join(", ")}`)
  const background = input.background ?? "opaque"
  if (!IMAGE_BACKGROUNDS.includes(background))
    problems.push(`background must be one of ${IMAGE_BACKGROUNDS.join(", ")}`)
  const count = input.count ?? 1
  if (!Number.isInteger(count) || count < 1 || count > 10) problems.push("count must be an integer from 1 to 10")
  if (typeof input.outputDir !== "string" || !input.outputDir.trim()) problems.push("outputDir is required")
  if (typeof input.baseName !== "string" || !baseName.test(input.baseName))
    problems.push("baseName must use letters, digits, hyphens or underscores")
  const referenceImages = input.referenceImages ?? []
  if (!Array.isArray(referenceImages) || referenceImages.some((item) => typeof item !== "string" || !item.trim()))
    problems.push("referenceImages must be an array of file paths")
  else if (referenceImages.length > 16) problems.push("referenceImages supports at most 16 files")
  if (problems.length) throw new Error(`Invalid image request: ${problems.join("; ")}`)
  const absolute = (path) => (isAbsolute(path) ? path : resolve(cwd, path))
  return {
    prompt,
    size,
    quality,
    background,
    count,
    outputDir: absolute(input.outputDir),
    baseName: input.baseName,
    referenceImages: referenceImages.map(absolute),
  }
}

/** Pixel dimensions for a concrete size, or null for "auto". */
export function parseImageSize(size) {
  const match = /^(\d+)x(\d+)$/.exec(size)
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null
}
