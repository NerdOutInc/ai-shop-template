import { execFileSync } from "node:child_process"

/** Request object IDs, never paths, and parse byte lengths so binary blobs remain intact. */
export function readIndexBlobs(root, objectIds) {
  const uniqueIds = [...new Set(objectIds)]
  if (!uniqueIds.length) return new Map()
  const output = execFileSync("git", ["cat-file", "--batch"], {
    cwd: root,
    input: `${uniqueIds.join("\n")}\n`,
    maxBuffer: 256 * 1024 * 1024,
  })
  const blobs = new Map()
  let offset = 0
  for (const objectId of uniqueIds) {
    const end = output.indexOf(10, offset)
    if (end < 0) throw new Error("Incomplete index blob header")
    const [returnedId, type, length] = output.subarray(offset, end).toString("ascii").split(" ")
    const size = Number(length)
    offset = end + 1
    if (
      returnedId !== objectId ||
      type !== "blob" ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      offset + size >= output.length ||
      output[offset + size] !== 10
    ) {
      throw new Error("Invalid index blob response")
    }
    blobs.set(objectId, output.subarray(offset, offset + size))
    offset += size + 1
  }
  if (offset !== output.length) throw new Error("Unexpected index blob response")
  return blobs
}
