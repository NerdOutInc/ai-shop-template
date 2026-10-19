import assert from "node:assert/strict"
import { test } from "node:test"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import sharp from "sharp"
import { readWeeklyHeroPackage } from "./read-weekly-hero-package.mjs"
import { renderWeeklyHero } from "./render-weekly-hero.mjs"

const root = fileURLToPath(new URL("../../", import.meta.url))
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
async function fixture(t) {
  const staging = path.join(root, ".tmp/weekly-heroes")
  await fs.mkdir(staging, { recursive: true })
  const directory = await fs.mkdtemp(path.join(staging, "synthetic-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  await fs.mkdir(path.join(directory, "source"))
  const record = async (name, width, height, background) => {
    const bytes = await sharp({ create: { width, height, channels: 4, background } })
      .png()
      .toBuffer()
    const relative = `source/${name}.png`
    await fs.writeFile(path.join(directory, relative), bytes)
    return { path: relative, width, height, sha256: digest(bytes) }
  }
  const artwork = await record("ink", 401, 202, "#ff0000")
  const blank = await record("blank", 1000, 1000, "#ffffff")
  const photo = await record("reference", 1000, 1000, "#0000ff")
  const desktop = await record("desktop", 1200, 400, "#334455")
  const mobile = await record("mobile", 400, 700, "#334455")
  const make = (background, outputWidth) => ({
    background,
    outputWidth,
    garments: [{ garment: "first", left: 20, top: 20, width: 250 }],
    overlays: [],
    webpOptions: { quality: 94, effort: 0 },
  })
  const plan = {
    schemaVersion: 1,
    sourceLimitations: ["Synthetic test artwork only"],
    garments: {
      first: {
        artwork,
        blank,
        photo,
        photoCutoutOrigin: { left: 0, top: 0 },
        photoInkMeasurement: { bounds: { left: 101, top: 100, width: 401, height: 202 } },
      },
    },
    compositions: { desktop: make(desktop, 6144), mobile: make(mobile, 2100) },
  }
  const save = () => fs.writeFile(path.join(directory, "composition.json"), JSON.stringify(plan))
  await save()
  const run = (script) =>
    spawnSync(process.execPath, [path.join(root, "scripts/artwork", script), directory], {
      cwd: root,
      encoding: "utf8",
    })
  return { directory, plan, save, run }
}

test("exports both Retina compositions and replays originals without changing receipts", async (t) => {
  const f = await fixture(t)
  await fs.writeFile(path.join(f.directory, "release.json"), "private receipt")
  let result = f.run("export-weekly-hero-upload-packs.mjs")
  assert.equal(result.status, 0, result.stderr)
  const manifest = await fs.readFile(path.join(f.directory, "composition.json"))
  const plan = JSON.parse(manifest)
  for (const [mode, width] of [
    ["desktop", 6144],
    ["mobile", 2100],
  ]) {
    assert.equal(plan.compositions[mode].upload.width, width)
    const bytes = await fs.readFile(path.join(f.directory, plan.compositions[mode].upload.path))
    assert.ok(bytes.length <= 3 * 1024 * 1024)
  }
  result = f.run("verify-final-weekly-hero.mjs")
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(await fs.readFile(path.join(f.directory, "composition.json")), manifest)
  assert.equal(await fs.readFile(path.join(f.directory, "release.json"), "utf8"), "private receipt")
  plan.compositions.desktop.garments[0].left += 1
  await fs.writeFile(path.join(f.directory, "composition.json"), JSON.stringify(plan))
  assert.notEqual(f.run("verify-final-weekly-hero.mjs").status, 0)
})

test("quantizes transformed ink edges together and samples original ink, not the provider photo", async (t) => {
  const f = await fixture(t)
  const pkg = await readWeeklyHeroPackage(f.directory)
  const composition = {
    ...pkg.plan.compositions.desktop,
    outputWidth: 1200,
    garments: [{ garment: "first", left: 0, top: 0, width: 500 }],
  }
  // Use a sufficiently tall canvas for the synthetic square garment.
  composition.background = pkg.plan.garments.first.blank
  composition.outputWidth = 1000
  const { png } = await renderWeeklyHero(pkg.plan, composition, pkg.input)
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const pixel = (x) => [
    ...data.subarray((60 * info.width + x) * info.channels, (60 * info.width + x) * info.channels + 3),
  ]
  assert.deepEqual(pixel(50), [255, 255, 255])
  assert.deepEqual(pixel(51), [255, 0, 0])
  assert.deepEqual(pixel(250), [255, 0, 0])
  assert.deepEqual(pixel(251), [255, 255, 255])
})

test("rejects undersized pairs before replacing either existing final", async (t) => {
  const f = await fixture(t)
  await fs.mkdir(path.join(f.directory, "final"))
  await fs.writeFile(path.join(f.directory, "final/desktop.webp"), "unchanged")
  f.plan.compositions.mobile.outputWidth = 800
  await f.save()
  const result = f.run("export-weekly-hero-upload-packs.mjs")
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /2100px/)
  assert.equal(await fs.readFile(path.join(f.directory, "final/desktop.webp"), "utf8"), "unchanged")
})

test("rejects changed hashes, dimensions, path escapes and symlink destinations", async (t) => {
  const f = await fixture(t)
  let pkg = await readWeeklyHeroPackage(f.directory)
  const ink = pkg.plan.garments.first.artwork
  await assert.rejects(pkg.input({ ...ink, sha256: "0".repeat(64) }), /hash changed/)
  await assert.rejects(pkg.input({ ...ink, width: 400 }), /dimensions/)
  f.plan.garments.first.artwork.path = "source/../../elsewhere.png"
  await f.save()
  await assert.rejects(readWeeklyHeroPackage(f.directory))
  await assert.rejects(readWeeklyHeroPackage(path.join(root, "public")), /staging|Restore/)
  f.plan.garments.first.artwork.path = "source/ink.png"
  await f.save()
  await fs.symlink(path.join(f.directory, "source"), path.join(f.directory, "final"))
  const result = f.run("export-weekly-hero-upload-packs.mjs")
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /symlinks/)
  await fs.symlink(path.join(f.directory, "source/ink.png"), path.join(f.directory, "source/linked.png"))
  pkg = await readWeeklyHeroPackage(f.directory)
  await assert.rejects(pkg.input({ ...ink, path: "source/linked.png" }), /symlinks/)
})
