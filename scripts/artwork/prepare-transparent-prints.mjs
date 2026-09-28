/**
 * Prepare transparent print masters for designs that only have artwork on a flat matte.
 *
 * Plan first, look at the contact sheets, then apply only the designs that survived that
 * look. No threshold can judge this: a dark illustration on a dark backdrop loses its
 * shading to the cutout and every colour metric reports a clean result, so the review is
 * the gate. The sheets render each cutout on a light and a dark garment, because damage
 * to light ink only shows on dark and damage to dark ink only shows on light.
 *
 * Usage (the --conditions flag matches `pnpm design-agent`; applying reaches server-only
 * inspection code through scripts/design-agent/inspect.mjs):
 *   node --conditions=react-server --import tsx scripts/artwork/prepare-transparent-prints.mjs \
 *     --library <designs.json> --artwork <dir> --out <dir>
 *   node --conditions=react-server --import tsx scripts/artwork/prepare-transparent-prints.mjs \
 *     --library <designs.json> --out <dir> --reviewed <numbers.json> --apply
 *
 * `--artwork` holds one source image per design named `<displayNumber>.bin`, downloaded
 * with `pnpm design-agent download`. `--reviewed` is a JSON array of the display numbers
 * whose sheets were actually inspected and accepted. Applying needs DESIGN_AGENT_URL and
 * DESIGN_AGENT_TOKEN_FILE.
 */
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"

import sharp from "sharp"

import { cutOutMatte } from "./cut-out-matte.mjs"

const PRINT_EDGE = 4800
const SHEET_TILE = 260
const SHEET_COLUMNS = 6
const LIGHT = "#f6fbfe"
const DARK = "#242529"

function argument(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`)
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const libraryPath = argument("library")
const artworkDirectory = argument("artwork")
const outputDirectory = argument("out", "prepared-prints")
const reviewedPath = argument("reviewed")
const apply = process.argv.includes("--apply")

if (!libraryPath || (!artworkDirectory && !apply)) {
  console.error("Usage: --library <designs.json> --artwork <dir> --out <dir> [--reviewed <file> --apply]")
  process.exit(1)
}

const designs = JSON.parse(await readFile(libraryPath, "utf8"))
const transparent = (design) =>
  ["print", "original", "preview"].some(
    (kind) => design.revision?.[kind]?.status === "ready" && design.revision[kind].hasTransparency === true
  )
const pending = designs.filter((design) => design.revision && !transparent(design))
await mkdir(outputDirectory, { recursive: true })

if (!apply) {
  const prepared = []
  const skipped = []
  // The download CLI writes whatever path it was given, so accept either convention.
  const sourcePath = async (displayNumber) => {
    for (const extension of ["png", "bin", "webp", "jpg"])
      try {
        const candidate = `${artworkDirectory}/${displayNumber}.${extension}`
        await stat(candidate)
        return candidate
      } catch {}
    return null
  }
  for (const design of pending) {
    const path = await sourcePath(design.displayNumber)
    if (!path) {
      skipped.push({ displayNumber: design.displayNumber, title: design.title, reason: "no local source" })
      continue
    }
    const source = sharp(path, { limitInputPixels: 40_000_000 })
    const { data, info } = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const image = { data, width: info.width, height: info.height }
    const result = cutOutMatte(image)
    if (!result) {
      skipped.push({ displayNumber: design.displayNumber, title: design.title, reason: "no flat matte to remove" })
      continue
    }
    const scale = PRINT_EDGE / Math.max(info.width, info.height)
    // libvips premultiplies alpha while resizing, so enlarging keeps edges clean. It adds
    // no detail the source never had, which the print notes say out loud.
    const bytes = await sharp(Buffer.from(data), { raw: { width: info.width, height: info.height, channels: 4 } })
      .resize({ width: Math.round(info.width * scale), height: Math.round(info.height * scale), kernel: "lanczos3" })
      .png({ compressionLevel: 9 })
      .toBuffer()
    await writeFile(`${outputDirectory}/${design.displayNumber}-print.png`, bytes)
    prepared.push({
      displayNumber: design.displayNumber,
      designId: design.id,
      title: design.title,
      matteHex: result.matteHex,
      removed: Number(result.removed.toFixed(3)),
      sourceSha256: createHash("sha256").update(await source.clone().toBuffer()).digest("hex"),
    })
    if (prepared.length % 25 === 0) console.log("prepared", prepared.length, "of", pending.length)
  }
  await writeFile(`${outputDirectory}/plan.json`, JSON.stringify({ prepared, skipped }, null, 1))

  for (const background of [LIGHT, DARK]) {
    const label = background === LIGHT ? "light" : "dark"
    for (let start = 0; start < prepared.length; start += SHEET_COLUMNS * 5) {
      const page = prepared.slice(start, start + SHEET_COLUMNS * 5)
      const tiles = await Promise.all(
        page.map((entry) =>
          sharp(`${outputDirectory}/${entry.displayNumber}-print.png`)
            .resize(SHEET_TILE, SHEET_TILE, { fit: "contain", background })
            .flatten({ background })
            .png()
            .toBuffer()
        )
      )
      const rows = Math.ceil(tiles.length / SHEET_COLUMNS)
      await sharp({
        create: { width: SHEET_COLUMNS * SHEET_TILE, height: rows * SHEET_TILE, channels: 3, background },
      })
        .composite(
          tiles.map((input, index) => ({
            input,
            left: (index % SHEET_COLUMNS) * SHEET_TILE,
            top: Math.floor(index / SHEET_COLUMNS) * SHEET_TILE,
          }))
        )
        .png()
        .toFile(`${outputDirectory}/sheet-${String(start).padStart(4, "0")}-${label}.png`)
    }
  }
  console.log(`prepared ${prepared.length}, skipped ${skipped.length}`)
  console.log(`Review every sheet in ${outputDirectory}, then apply with --reviewed <numbers.json> --apply`)
} else {
  if (!reviewedPath) {
    console.error("Applying needs --reviewed <file>: only designs whose contact sheet was inspected may be uploaded")
    process.exit(1)
  }
  const reviewed = new Set(JSON.parse(await readFile(reviewedPath, "utf8")))
  const { prepared } = JSON.parse(await readFile(`${outputDirectory}/plan.json`, "utf8"))
  const { createDesignAgentClient } = await import("../design-agent/client.mjs")
  const client = await createDesignAgentClient()
  let done = 0
  const { inspectDesignAgentAsset } = await import("../design-agent/inspect.mjs")
  const failures = []
  for (const entry of prepared) {
    if (!reviewed.has(entry.displayNumber)) continue
    const file = `${outputDirectory}/${entry.displayNumber}-print.png`
    const revisionId = randomUUID()
    try {
      // The same decoder and fingerprint contract the server verifies against. Computing
      // hashes here by hand produced metadata finalize could never match.
      const asset = await inspectDesignAgentAsset({ file, kind: "print", enlarged: true })
      await client.command({
        command: "revision.prepare",
        designId: entry.designId,
        revision: {
          id: revisionId,
          printReadiness: "unverified",
          printNotes:
            `Deterministic matte removal from the preserved original, reviewed on a light and a dark garment. ` +
            `Enlarged to a ${PRINT_EDGE}-pixel long edge; enlargement adds no source detail. ` +
            `Sampled matte ${entry.matteHex}. Original SHA-256: ${entry.sourceSha256}. ` +
            `Product size, garment contrast and a physical sample remain unverified.`,
          widthInches: null,
          heightInches: null,
          nativePpi: null,
          assets: [{ ...asset, originalFilename: `design-${entry.displayNumber}-print.png` }],
        },
      })
      await client.uploadRevisionAsset({ revisionId, assetId: asset.id, file })
      done++
      if (done % 10 === 0) console.log("uploaded", done)
    } catch (error) {
      // One bad design must not abandon the rest; every skip is named at the end.
      failures.push({ displayNumber: entry.displayNumber, reason: error.message })
      console.error(`#${entry.displayNumber}: ${error.message}`)
    }
  }
  if (failures.length) {
    console.error(`${failures.length} design(s) did not upload:`, failures)
    // A rollout step that chains off this must not read "uploaded 0" as success.
    process.exitCode = 1
  }
  console.log("uploaded", done, "prepared revisions")
}
