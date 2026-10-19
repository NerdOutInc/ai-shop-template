import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import sharp from "sharp"
import { readWeeklyHeroPackage } from "./read-weekly-hero-package.mjs"
import { renderWeeklyHero } from "./render-weekly-hero.mjs"

const [directory, ...extra] = process.argv.slice(2)
if (!directory || extra.length)
  throw new Error("Usage: node scripts/artwork/export-weekly-hero-upload-packs.mjs .tmp/weekly-heroes/NAME")
const { plan, input, safePath } = await readWeeklyHeroPackage(directory)
const outputs = []
for (const [mode, composition] of Object.entries(plan.compositions)) {
  const minimum = mode === "desktop" ? 6144 : 2100
  const ratio = mode === "desktop" ? 3 : 4 / 7
  if (
    composition.outputWidth < minimum ||
    Math.abs(composition.background.width / composition.background.height - ratio) > 0.005
  )
    throw new Error(`${mode}: use the required aspect ratio and at least ${minimum}px width`)
  const { png, webp, width, height } = await renderWeeklyHero(plan, composition, input)
  if (webp.length > 3 * 1024 * 1024)
    throw new Error(`${mode}: WebP exceeds 3 MiB; adjust encoding without shrinking the canvas`)
  for (const [key, bytes, extension] of [
    ["master", png, "png"],
    ["upload", webp, "webp"],
  ]) {
    const relative = `final/${mode}.${extension}`
    composition[key] = { path: relative, width, height, sha256: createHash("sha256").update(bytes).digest("hex") }
    outputs.push({ file: await safePath(relative, true), bytes })
  }
  console.log(`${mode}: ${width} × ${height}, ${webp.length} WebP bytes`)
}
// Validate both compositions and all destination paths before replacing any final.
for (const { file, bytes } of outputs) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, bytes, { mode: 0o600 })
}
plan.renderer = { ...sharp.versions, geometry: "edges-floor-plus-half-v1", resampling: "lanczos3" }
await fs.writeFile(await safePath("composition.json"), JSON.stringify(plan, null, 2) + "\n", { mode: 0o600 })
