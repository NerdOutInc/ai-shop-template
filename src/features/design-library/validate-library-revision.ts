import type { LibraryRevisionInput } from "./library-types"

import { LibraryError } from "./library-error"
import { libraryRevisionSchema } from "./library-revision-schema"

/**
 * Checks a prepared revision before it joins an existing design.
 *
 * Preparation exists to give a design a transparent print master, so a revision that
 * claims one must actually carry validated alpha; the server never adds transparency and
 * the browsing sizes refuse to derive without it.
 */
export function validateLibraryRevision(input: unknown): LibraryRevisionInput {
  const result = libraryRevisionSchema.safeParse(input)
  if (!result.success)
    throw new LibraryError(
      "INVALID_INPUT",
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
    )
  const revision = result.data
  const kinds = revision.assets.map((asset) => asset.kind)
  if (new Set(kinds).size !== kinds.length)
    throw new LibraryError("INVALID_INPUT", "A revision holds at most one asset of each kind")
  if (revision.assets.some((asset) => asset.status !== "pending" || asset.pathname !== null))
    throw new LibraryError("INVALID_INPUT", "Prepared assets stay pending until their bytes are verified")
  const print = revision.assets.find((asset) => asset.kind === "print")
  if (!print) throw new LibraryError("INVALID_INPUT", "A prepared revision needs its print file")
  if (print.mimeType !== "image/png" || !print.hasAlpha || !print.hasTransparency)
    throw new LibraryError("INVALID_INPUT", "A prepared print file must be a transparent PNG")
  return revision
}
