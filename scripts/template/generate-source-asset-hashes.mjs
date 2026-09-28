import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { extname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const imageExtensions = [
  ".apng",
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".jxl",
  ".png",
  ".svg",
  ".tif",
  ".tiff",
  ".webp",
]

async function hashBlobs(sourceCheckout, objectIds) {
  if (!objectIds.length) return []
  const child = spawn("git", ["-C", sourceCheckout, "cat-file", "--batch"], {
    stdio: ["pipe", "pipe", "ignore"],
  })
  const exited = new Promise((done) => {
    child.once("error", () => done(-1))
    child.once("close", done)
  })
  child.stdin.on("error", () => {})
  child.stdin.end(`${objectIds.join("\n")}\n`)
  const hashes = []
  let pending = Buffer.alloc(0)
  let remaining = null
  let hash
  try {
    for await (const chunk of child.stdout) {
      pending = Buffer.concat([pending, chunk])
      while (pending.length) {
        if (remaining === null) {
          const newline = pending.indexOf(10)
          if (newline === -1) break
          const [objectId, type, size] = pending.subarray(0, newline).toString("utf8").split(" ")
          if (objectId !== objectIds[hashes.length] || type !== "blob" || !/^\d+$/.test(size))
            throw new Error("Unexpected Git blob response")
          remaining = Number(size)
          if (!Number.isSafeInteger(remaining)) throw new Error("Invalid Git blob size")
          hash = createHash("sha256")
          pending = pending.subarray(newline + 1)
        }
        if (remaining > 0) {
          const length = Math.min(remaining, pending.length)
          hash.update(pending.subarray(0, length))
          pending = pending.subarray(length)
          remaining -= length
        }
        if (remaining === 0) {
          if (!pending.length) break
          if (pending[0] !== 10) throw new Error("Unexpected Git blob separator")
          hashes.push(hash.digest("hex"))
          pending = pending.subarray(1)
          remaining = null
        }
      }
    }
    if ((await exited) !== 0 || remaining !== null || pending.length || hashes.length !== objectIds.length)
      throw new Error("Incomplete Git blob response")
    return [...new Set(hashes)].sort()
  } catch (error) {
    child.kill()
    await exited
    throw error
  }
}

/** Hash regular image blobs from one Git snapshot, without reading the worktree or source history. */
export async function generateSourceAssetHashes(sourceCheckout, ref) {
  const git = (args) =>
    execFileSync("git", ["-C", sourceCheckout, ...args], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
  const commit = git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).trim()
  const tree = git(["rev-parse", "--verify", `${commit}^{tree}`]).trim()
  const objects = new Set()
  const pathCountsByExtension = {}
  for (const entry of git(["ls-tree", "--full-tree", "-r", "-z", commit]).split("\0")) {
    if (!entry) continue
    const tab = entry.indexOf("\t")
    const [mode, type, objectId] = entry.slice(0, tab).split(" ")
    const extension = extname(entry.slice(tab + 1)).toLowerCase()
    // Do not dereference source symlinks or inspect non-image files, including credentials.
    if (!mode.startsWith("100") || type !== "blob" || !imageExtensions.includes(extension)) continue
    objects.add(objectId)
    pathCountsByExtension[extension] = (pathCountsByExtension[extension] ?? 0) + 1
  }
  const forbiddenAssetSha256 = await hashBlobs(sourceCheckout, [...objects].sort())
  return {
    sourceAssetSnapshot: {
      commit,
      tree,
      imageExtensions,
      imagePathCount: Object.values(pathCountsByExtension).reduce((total, count) => total + count, 0),
      uniqueBlobCount: objects.size,
      uniqueSha256Count: forbiddenAssetSha256.length,
      pathCountsByExtension: Object.fromEntries(Object.entries(pathCountsByExtension).sort()),
    },
    forbiddenAssetSha256,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) {
    console.error("Usage: node scripts/template/generate-source-asset-hashes.mjs <local-source-checkout> <ref>")
    process.exitCode = 1
  } else {
    try {
      console.log(JSON.stringify(await generateSourceAssetHashes(process.argv[2], process.argv[3]), null, 2))
    } catch {
      console.error("Source image hashing failed. Check the local repository, ref, and available Git objects.")
      process.exitCode = 1
    }
  }
}
