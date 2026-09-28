import { createHash } from "node:crypto"

/** Stable asset IDs survive interrupted inspection and upload without changing identity. */
export function libraryIdentity(...parts: string[]): string {
  if (parts.some((part) => !part || part !== part.trim()))
    throw new Error("Identity components must be nonempty exact strings")
  const digest = createHash("sha256")
    .update(JSON.stringify(["design-library-v1", ...parts]))
    .digest("hex")
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`
}
