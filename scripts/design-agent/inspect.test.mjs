import assert from "node:assert/strict"
import { test } from "node:test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
const execute = promisify(execFile)
test("local inspection uses the same decoder and fingerprint contract as server verification without credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "design-inspect-")),
    file = join(directory, "print.png"),
    input = join(directory, "inspect.json")
  try {
    await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 100, g: 50, b: 25, alpha: 0.5 } } })
      .png()
      .toFile(file)
    await writeFile(input, JSON.stringify({ file, kind: "print", enlarged: false }))
    const result = await execute(
      process.execPath,
      ["--conditions=react-server", "--import", "tsx", "scripts/design-agent/run.mjs", "inspect", "--input", input],
      { env: { PATH: process.env.PATH } }
    )
    const asset = JSON.parse(result.stdout)
    assert.equal(asset.width, 4)
    assert.equal(asset.height, 4)
    assert.equal(asset.hasTransparency, true)
    assert.match(asset.pixelSha256, /^[a-f0-9]{64}$/)
    assert.match(asset.perceptualHash, /^[a-f0-9]{16}$/)
    assert.equal(asset.status, "pending")
    assert.equal(asset.pathname, null)
    assert.equal(asset.originalFilename, "print.png")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
