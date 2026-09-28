// @vitest-environment node
import { createHash } from "node:crypto"
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import sharp from "sharp"
import { afterEach, describe, expect, it, vi } from "vitest"

import { libraryIdentity } from "./library-identity"
import { readLibraryAsset } from "./read-library-asset.server"

vi.mock("server-only", () => ({}))
const directories: string[] = []
async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "library-asset-"))
  directories.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
const revisionId = libraryIdentity("test", "revision")

describe("private archive asset inspection", () => {
  it("distinguishes actual alpha, native dimensions, exact bytes and decoded duplicate pixels", async () => {
    const root = await setup()
    const pixels = Buffer.from([255, 0, 0, 255, 0, 0, 0, 0])
    const a = await sharp(pixels, { raw: { width: 2, height: 1, channels: 4 } })
      .png({ compressionLevel: 0 })
      .toBuffer()
    const b = await sharp(pixels, { raw: { width: 2, height: 1, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toBuffer()
    await writeFile(path.join(root, "a.png"), a)
    await writeFile(path.join(root, "b.png"), b)
    const first = await readLibraryAsset({ rootDirectory: root, sourcePath: "a.png", revisionId, kind: "original" })
    const second = await readLibraryAsset({ rootDirectory: root, sourcePath: "b.png", revisionId, kind: "original" })
    expect(first).toMatchObject({
      status: "pending",
      pathname: null,
      width: 2,
      height: 1,
      hasAlpha: true,
      hasTransparency: true,
      enlarged: null,
    })
    expect(first.sha256).toBe(createHash("sha256").update(a).digest("hex"))
    expect(first.sha256).not.toBe(second.sha256)
    expect(first.pixelSha256).toBe(second.pixelSha256)
    await expect(
      readLibraryAsset({
        rootDirectory: root,
        sourcePath: "a.png",
        revisionId,
        kind: "original",
        expectedSha256: "0".repeat(64),
      })
    ).rejects.toThrow("SHA-256")
  })
  it("rejects lexical, URI, Windows and symlink escapes but accepts an internal normalized path", async () => {
    const root = await setup(),
      outside = await setup()
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } })
      .png()
      .toBuffer()
    await writeFile(path.join(root, "a.png"), bytes)
    await writeFile(path.join(outside, "b.png"), bytes)
    await symlink(path.join(outside, "b.png"), path.join(root, "escape.png"))
    for (const sourcePath of ["../b.png", "https://example.com/a.png", "C:\\a.png", "escape.png"])
      await expect(readLibraryAsset({ rootDirectory: root, sourcePath, revisionId, kind: "original" })).rejects.toThrow(
        "escapes"
      )
    const result = await readLibraryAsset({
      rootDirectory: root,
      sourcePath: "internal/../a.png",
      revisionId,
      kind: "original",
    })
    expect(result.hasTransparency).toBe(false)
  })
})
