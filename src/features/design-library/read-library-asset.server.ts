import "server-only"

import { readFile, realpath } from "node:fs/promises"
import path from "node:path"

import type { LibraryStoredAsset } from "./library-types"

import { libraryIdentity } from "./library-identity"
import { inspectLibraryImage } from "./inspect-library-image.server"

function contained(base: string, target: string) {
  const relative = path.relative(base, target)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export async function readLibraryAsset(input: {
  rootDirectory: string
  sourcePath: string
  revisionId: string
  kind: LibraryStoredAsset["kind"]
  expectedSha256?: string
  enlarged?: boolean | null
}): Promise<LibraryStoredAsset> {
  const root = path.resolve(input.rootDirectory)
  const target = path.resolve(root, input.sourcePath)
  if (
    !input.sourcePath ||
    /^[a-z][a-z0-9+.-]*:/i.test(input.sourcePath) ||
    path.win32.isAbsolute(input.sourcePath) ||
    input.sourcePath.includes("\0") ||
    !contained(root, target)
  )
    throw new Error("Asset source escapes the archive")
  const resolved = await realpath(target)
  if (!contained(await realpath(root), resolved)) throw new Error("Asset symlink escapes the archive")
  const bytes = await readFile(resolved)
  const inspected = await inspectLibraryImage(bytes)
  const { sha256 } = inspected
  if (input.expectedSha256 && sha256 !== input.expectedSha256)
    throw new Error("Archived asset SHA-256 does not match its recorded bytes")
  const id = libraryIdentity("asset", input.revisionId, input.kind)
  return {
    id,
    url: `/api/admin/assets/${id}`,
    kind: input.kind,
    status: "pending",
    pathname: null,
    sourcePath: path.relative(root, target).split(path.sep).join("/"),
    originalFilename: path.basename(target),
    ...inspected,
    enlarged: input.enlarged ?? null,
  }
}
