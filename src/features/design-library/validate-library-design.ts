import { z } from "zod"

import type { LibraryDesignInput } from "./library-types"

import { LibraryError } from "./library-error"
import { libraryRevisionSchema } from "./library-revision-schema"

const text = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), "Surrounding whitespace is not allowed")
const schema = z
  .object({
    id: z.uuid(),
    displayNumber: z.number().int().positive().optional(),
    title: text,
    family: z.string(),
    summary: z.string(),
    mechanism: z.string(),
    prompt: z.string(),
    background: z.object({ name: z.string(), hex: z.string().regex(/^#[a-f0-9]{6}$/i) }).nullable(),
    state: z.enum(["active", "archived", "rejected"]),
    collectionIds: z.array(text).min(1),
    revision: libraryRevisionSchema,
  })
  .strict()

export function validateLibraryDesign(input: unknown): LibraryDesignInput {
  const result = schema.safeParse(input)
  if (!result.success)
    throw new LibraryError(
      "INVALID_INPUT",
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
    )
  const design = result.data
  const kinds = design.revision.assets.map((value) => value.kind)
  if (!kinds.includes("original") || new Set(kinds).size !== kinds.length)
    throw new LibraryError("INVALID_INPUT", "A revision needs exactly one original and at most one asset of each kind")
  for (const value of design.revision.assets) {
    if (value.url !== `/api/admin/assets/${value.id}`)
      throw new LibraryError("INVALID_INPUT", "Asset URLs must use their protected asset ID")
    if (
      value.status !== "unavailable" &&
      (!value.width || !value.height || !value.bytes || !value.sha256 || !value.pixelSha256)
    )
      throw new LibraryError("INVALID_INPUT", "Available assets require verified dimensions and hashes")
    if (value.status === "ready" && !value.pathname)
      throw new LibraryError("INVALID_INPUT", "Ready assets require a private storage pathname")
    const extension = value.mimeType === "image/jpeg" ? "jpg" : value.mimeType === "image/webp" ? "webp" : "png"
    if (value.pathname && value.pathname !== `concepts/${value.id}/${value.sha256}.${extension}`)
      throw new LibraryError("INVALID_INPUT", "Private asset pathname must match its immutable ID and hash")
    if (
      value.pathname &&
      (/^[a-z][a-z0-9+.-]*:/i.test(value.pathname) ||
        value.pathname.startsWith("/") ||
        value.pathname.split("/").some((part) => part === "..") ||
        value.pathname.includes("\\"))
    )
      throw new LibraryError("INVALID_INPUT", "Expected a private relative Blob pathname")
  }
  const print = design.revision.assets.find((value) => value.kind === "print")
  if (
    design.revision.printReadiness === "ready" &&
    (!print?.hasTransparency ||
      !print.hasAlpha ||
      print.status !== "ready" ||
      !design.revision.widthInches ||
      !design.revision.heightInches)
  )
    throw new LibraryError(
      "INVALID_INPUT",
      "Print readiness requires a stored transparent print file and assessed print size"
    )
  return design
}
