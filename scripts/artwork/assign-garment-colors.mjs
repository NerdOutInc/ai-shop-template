/**
 * Plan (and optionally apply) the five garment colors for every design in the library.
 *
 * Usage:
 *   node scripts/artwork/assign-garment-colors.mjs --library <designs.json> --artwork <dir> \
 *     [--products <printify-colors.json>] [--out <plan.json>] [--apply]
 *
 * `--library` is the `designs` array from `library.search`. `--artwork` holds one image per
 * design named `<displayNumber>.bin`, downloaded with `pnpm design-agent download`.
 * `--products` maps a Printify product ID to the colors that product actually offers; a
 * design bound to one of them takes those colors instead of a scored guess, because the
 * store already sells it that way.
 *
 * Applying sends the `design.colors` agent command and needs DESIGN_AGENT_URL and
 * DESIGN_AGENT_TOKEN_FILE, exactly like the other agent scripts.
 */
import { readFile, writeFile } from "node:fs/promises"

import sharp from "sharp"

import { GARMENT_COLORS } from "../../src/features/design-library/garment-colors.ts"

import { chooseGarmentColors, sampleInk } from "./choose-garment-colors.mjs"

function argument(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`)
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const libraryPath = argument("library")
const artworkDirectory = argument("artwork")
const productsPath = argument("products")
const outputPath = argument("out", "garment-color-plan.json")
const apply = process.argv.includes("--apply")

if (!libraryPath || !artworkDirectory) {
  console.error("Usage: --library <designs.json> --artwork <dir> [--products <file>] [--out <file>] [--apply]")
  process.exit(1)
}

const designs = JSON.parse(await readFile(libraryPath, "utf8"))
const productColors = productsPath ? JSON.parse(await readFile(productsPath, "utf8")) : {}
const plan = []

for (const design of designs) {
  const offered =
    design.products
      ?.map((product) => productColors[product.productId ?? ""])
      .find((colors) => Array.isArray(colors) && colors.length) ?? []
  let ink = []
  try {
    const { data, info } = await sharp(`${artworkDirectory}/${design.displayNumber}.bin`)
      .resize({ width: 512, height: 512, fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    ink = sampleInk({ data, width: info.width, height: info.height }, background(design))
  } catch (error) {
    console.error(`#${design.displayNumber}: artwork unreadable (${error.message})`)
  }
  const colors = chooseGarmentColors(GARMENT_COLORS, ink, design.background?.hex ?? null, {
    seed: offered.slice(0, 5),
  }).map((color) => color.name)
  plan.push({
    designId: design.id,
    displayNumber: design.displayNumber,
    title: design.title,
    // A design the store already sells keeps that product's colors; a draft that records
    // only one keeps it and has the rest scored.
    source: offered.length >= 5 ? "printify" : offered.length ? "printify-partial" : "assigned",
    colors,
  })
}

function background(design) {
  const hex = design.background?.hex
  return hex && /^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) : null
}

await writeFile(outputPath, JSON.stringify(plan, null, 1))
const counts = {}
for (const entry of plan) for (const color of entry.colors) counts[color] = (counts[color] ?? 0) + 1
console.log(`planned ${plan.length} designs (${plan.filter((entry) => entry.source === "printify").length} from Printify)`)
console.log(
  "palette use:",
  Object.entries(counts)
    .sort((first, second) => second[1] - first[1])
    .map(([name, total]) => `${name} ${total}`)
    .join(", ")
)
console.log(`wrote ${outputPath}`)

if (apply) {
  const { createDesignAgentClient } = await import("../design-agent/client.mjs")
  const client = await createDesignAgentClient()
  let done = 0
  for (const entry of plan) {
    await client.command({ command: "design.colors", designId: entry.designId, colors: entry.colors })
    if (++done % 25 === 0) console.log("applied", done, "of", plan.length)
  }
  console.log("applied", done)
}
