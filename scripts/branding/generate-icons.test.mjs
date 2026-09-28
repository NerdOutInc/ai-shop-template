import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import sharp from "sharp"
import { generateIcons } from "./generate-icons.mjs"

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url))
const run = promisify(execFile)
const sourceSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect x="1" y="1" width="510" height="510" rx="80" fill="#ff0000"/></svg>`

async function fixture(t, content = sourceSvg) {
  const root = await mkdtemp(path.join(os.tmpdir(), "store-icons-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sourcePath = path.join(root, "approved-mark.svg")
  await writeFile(sourcePath, content)
  return { root, sourcePath, outputRoot: path.join(root, "generated"), background: "#123456" }
}

async function opaquePixels(filename) {
  const { data, info } = await sharp(filename).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let nonOpaque = 0
  for (let index = 3; index < data.length; index += 4) if (data[index] !== 255) nonOpaque++
  assert.equal(nonOpaque, 0, `${filename} has transparent pixels`)
  return { data, info }
}

test("the shipped maskable icon has no transparent corner holes", async () => {
  const { data, info } = await opaquePixels(path.join(repositoryRoot, "public/icons/maskable-512.png"))
  assert.equal(info.width, 512)
  assert.equal(info.height, 512)
  assert.deepEqual(data.subarray((100 * 512 + 100) * 4, (100 * 512 + 100) * 4 + 4), data.subarray(0, 4))
})

test("generates all dimensions, preserves approved SVG, and writes a valid multi-size ICO", async (t) => {
  const options = await fixture(t)
  const outputs = await generateIcons(options)
  assert.equal(outputs.length, 6)
  assert.equal(await readFile(options.sourcePath, "utf8"), sourceSvg)
  assert.equal(await readFile(path.join(options.outputRoot, "src/app/icon.svg"), "utf8"), sourceSvg)
  for (const [relativePath, size] of [
    ["public/apple-touch-icon.png", 180],
    ["public/icons/icon-192.png", 192],
    ["public/icons/icon-512.png", 512],
    ["public/icons/maskable-512.png", 512],
  ]) {
    const metadata = await sharp(path.join(options.outputRoot, relativePath)).metadata()
    assert.equal(metadata.width, size)
    assert.equal(metadata.height, size)
    assert.equal(metadata.format, "png")
  }
  await opaquePixels(path.join(options.outputRoot, "public/apple-touch-icon.png"))
  const ico = await readFile(path.join(options.outputRoot, "src/app/favicon.ico"))
  assert.equal(ico.readUInt16LE(0), 0)
  assert.equal(ico.readUInt16LE(2), 1)
  assert.equal(ico.readUInt16LE(4), 3)
  let nextOffset = 6 + 3 * 16
  for (const [index, size] of [16, 32, 48].entries()) {
    const entry = 6 + index * 16
    assert.equal(ico.readUInt8(entry), size)
    assert.equal(ico.readUInt8(entry + 1), size)
    assert.equal(ico.readUInt16LE(entry + 4), 1)
    assert.equal(ico.readUInt16LE(entry + 6), 32)
    assert.equal(ico.readUInt32LE(entry + 12), nextOffset)
    const length = ico.readUInt32LE(entry + 8)
    const image = await sharp(ico.subarray(nextOffset, nextOffset + length)).metadata()
    assert.equal(image.format, "png")
    assert.equal(image.width, size)
    assert.equal(image.height, size)
    nextOffset += length
  }
  assert.equal(nextOffset, ico.length)
})

test("maskable composites transparent corners and keeps all mark pixels inside the safe circle", async (t) => {
  const options = await fixture(t)
  await generateIcons(options)
  const { data, info } = await opaquePixels(path.join(options.outputRoot, "public/icons/maskable-512.png"))
  const background = [18, 52, 86]
  let markPixels = 0
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * 4
      if (background.every((channel, index) => data[offset + index] === channel)) continue
      markPixels++
      assert.ok(Math.hypot(x + 0.5 - 256, y + 0.5 - 256) <= 204.8, `mark outside safe circle at ${x},${y}`)
    }
  }
  assert.ok(markPixels > 0, "the mark must survive compositing")
})

test("regeneration is deterministic", async (t) => {
  const options = await fixture(t)
  const outputs = await generateIcons(options)
  const before = await Promise.all(outputs.map((file) => readFile(path.join(options.outputRoot, file))))
  await generateIcons(options)
  for (const [index, file] of outputs.entries())
    assert.deepEqual(await readFile(path.join(options.outputRoot, file)), before[index])
})

test("accepts approved raster sources and embeds a self-contained PNG in the SVG icon", async (t) => {
  const options = await fixture(t)
  for (const format of ["png", "webp"]) {
    const raster = path.join(options.root, `approved-mark.${format}`)
    await sharp(Buffer.from(sourceSvg)).toFormat(format).toFile(raster)
    await generateIcons({ ...options, sourcePath: raster })
    const svg = await readFile(path.join(options.outputRoot, "src/app/icon.svg"), "utf8")
    assert.match(svg, /href="data:image\/png;base64,/)
    const embedded = Buffer.from(svg.match(/base64,([^"]+)/)[1], "base64")
    assert.equal((await sharp(embedded).metadata()).width, 512)
    await opaquePixels(path.join(options.outputRoot, "public/icons/maskable-512.png"))
  }
  const grayscale = path.join(options.root, "grayscale-mark.png")
  await sharp(Buffer.from(sourceSvg)).grayscale().png().toFile(grayscale)
  await generateIcons({ ...options, sourcePath: grayscale })
  await opaquePixels(path.join(options.outputRoot, "public/icons/maskable-512.png"))
})

test("invalid inputs fail before replacing existing assets", async (t) => {
  const options = await fixture(t)
  const outputs = await generateIcons(options)
  const before = await Promise.all(outputs.map((file) => readFile(path.join(options.outputRoot, file))))
  for (const background of [undefined, "red", "#fff", "#12345600", "transparent"])
    await assert.rejects(generateIcons({ ...options, background }), /six-digit hex/)
  await assert.rejects(generateIcons({ ...options, sourcePath: undefined }), /approved square/)
  await assert.rejects(generateIcons({ ...options, sourcePath: path.join(options.root, "missing.svg") }), /ENOENT/)
  for (const [content, message] of [
    [sourceSvg.replace('height="512"', 'height="256"'), /must be square/],
    [sourceSvg.replace('fill="#ff0000"', 'fill="none"'), /fully transparent/],
    ["not an image", /unsupported image format/],
  ]) {
    await writeFile(options.sourcePath, content)
    await assert.rejects(generateIcons(options), message)
  }
  const smallRaster = path.join(options.root, "small.png")
  await sharp(Buffer.from(sourceSvg)).resize(128).png().toFile(smallRaster)
  await assert.rejects(generateIcons({ ...options, sourcePath: smallRaster }), /at least 512/)
  const unsupported = path.join(options.root, "mark.jpg")
  await sharp(Buffer.from(sourceSvg)).jpeg().toFile(unsupported)
  await assert.rejects(generateIcons({ ...options, sourcePath: unsupported }), /single-frame SVG, PNG, or WebP/)
  for (const [index, file] of outputs.entries())
    assert.deepEqual(await readFile(path.join(options.outputRoot, file)), before[index])
})

test("CLI requires explicit source and opaque background and supports an isolated output directory", async (t) => {
  const options = await fixture(t)
  const script = fileURLToPath(new URL("./generate-icons.mjs", import.meta.url))
  await assert.rejects(run(process.execPath, [script]), (error) => error.code === 1 && /--source/.test(error.stderr))
  await assert.rejects(
    run(process.execPath, [script, "--source", options.sourcePath]),
    (error) => error.code === 1 && /--background/.test(error.stderr)
  )
  const result = await run(process.execPath, [
    script,
    "--source",
    options.sourcePath,
    "--background",
    options.background,
    "--output-root",
    options.outputRoot,
  ])
  assert.match(result.stdout, /Generated 6 website icons/)
  assert.deepEqual((await readdir(path.join(options.outputRoot, "public/icons"))).sort(), [
    "icon-192.png",
    "icon-512.png",
    "maskable-512.png",
  ])
})
