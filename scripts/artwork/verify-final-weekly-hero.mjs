import sharp from "sharp"
import { readWeeklyHeroPackage } from "./read-weekly-hero-package.mjs"
import { renderWeeklyHero } from "./render-weekly-hero.mjs"

const [directory, ...extra] = process.argv.slice(2)
if (!directory || extra.length)
  throw new Error("Usage: node scripts/artwork/verify-final-weekly-hero.mjs .tmp/weekly-heroes/NAME")
const { plan, input } = await readWeeklyHeroPackage(directory)
if (
  JSON.stringify(plan.renderer) !==
  JSON.stringify({ ...sharp.versions, geometry: "edges-floor-plus-half-v1", resampling: "lanczos3" })
)
  throw new Error("Replay requires the recorded renderer/library versions")
for (const [mode, composition] of Object.entries(plan.compositions)) {
  if (!composition.master || !composition.upload) throw new Error(`${mode}: missing final receipts`)
  const { png, webp } = await renderWeeklyHero(plan, composition, input)
  const actual = await sharp(png).ensureAlpha().raw().toBuffer()
  const expected = await sharp(await input(composition.master, true))
    .ensureAlpha()
    .raw()
    .toBuffer()
  if (!actual.equals(expected) || !webp.equals(await input(composition.upload, true)))
    throw new Error(`${mode}: rebuilt pixels or upload bytes differ from the retained final`)
  console.log(`${mode}: PNG pixels and WebP bytes match exactly`)
}
