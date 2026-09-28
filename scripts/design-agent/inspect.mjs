import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import { randomUUID } from "node:crypto"
import { inspectLibraryImage } from "../../src/features/design-library/inspect-library-image.server.ts"

export async function inspectDesignAgentAsset(input) {
  if (
    !["original", "preview", "print"].includes(input.kind) ||
    typeof input.file !== "string" ||
    typeof input.enlarged !== "boolean"
  )
    throw new Error("Inspection requires file, kind (original/preview/print), and honest enlarged boolean")
  const id = input.id ?? randomUUID()
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Asset ID must be a UUID")
  const inspected = await inspectLibraryImage(await readFile(input.file))
  if (
    input.kind === "print" &&
    (inspected.mimeType !== "image/png" || !inspected.hasAlpha || !inspected.hasTransparency)
  )
    throw new Error("Print download must be a transparent PNG")
  return {
    id,
    url: `/api/admin/assets/${id}`,
    kind: input.kind,
    status: "pending",
    ...inspected,
    enlarged: input.enlarged,
    pathname: null,
    sourcePath: null,
    originalFilename: basename(input.file),
  }
}
