import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import sharp from "sharp"

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url))
const iconSizes = [16, 32, 48]
const outputPaths = [
  "src/app/icon.svg",
  "src/app/favicon.ico",
  "public/apple-touch-icon.png",
  "public/icons/icon-192.png",
  "public/icons/icon-512.png",
  "public/icons/maskable-512.png",
]

function createIco(images) {
  const directory = Buffer.alloc(6 + images.length * 16)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(images.length, 4)
  let offset = directory.length
  for (const [index, image] of images.entries()) {
    const entry = 6 + index * 16
    directory.writeUInt8(iconSizes[index], entry)
    directory.writeUInt8(iconSizes[index], entry + 1)
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(image.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += image.length
  }
  return Buffer.concat([directory, ...images])
}

export async function generateIcons({ sourcePath, background, outputRoot = repositoryRoot }) {
  if (typeof sourcePath !== "string" || !sourcePath.trim())
    throw new Error("Provide --source with the path to an approved square SVG, PNG, or WebP mark.")
  if (typeof background !== "string" || !/^#[\da-f]{6}$/i.test(background))
    throw new Error("Provide --background as an opaque six-digit hex color, such as '#25364d'.")

  const source = await readFile(sourcePath)
  const metadata = await sharp(source).metadata()
  if (!["svg", "png", "webp"].includes(metadata.format) || (metadata.pages ?? 1) !== 1)
    throw new Error("The source must be a single-frame SVG, PNG, or WebP mark.")
  if (!metadata.width || metadata.width !== metadata.height)
    throw new Error("The source must be square. Use an approved square mark instead of stretching a wordmark.")
  if (metadata.format !== "svg" && metadata.width < 512)
    throw new Error("Raster source marks must be at least 512 × 512 pixels; use SVG for smaller vector sources.")

  const density = metadata.format === "svg" ? Math.max(72, (512 / metadata.width) * 72) : 72
  const render = (size) =>
    sharp(source, { density }).rotate().resize(size, size).toColourspace("srgb").ensureAlpha().png()
  const fullSize = await render(512).toBuffer()
  const stats = await sharp(fullSize).ensureAlpha().stats()
  if (stats.channels[3].max === 0) throw new Error("The source mark is fully transparent.")

  // Fit every corner of the square source inside the manifest's 40%-radius safe circle.
  // https://www.w3.org/TR/appmanifest/#icon-masks
  const markSize = Math.floor((512 * 0.8) / Math.SQRT2 / 2) * 2
  const inset = (512 - markSize) / 2
  const maskableMark = await render(markSize).toBuffer()
  const maskable = await sharp({ create: { width: 512, height: 512, channels: 4, background } })
    .composite([{ input: maskableMark, top: inset, left: inset }])
    .flatten({ background })
    .png()
    .toBuffer()
  const svg =
    metadata.format === "svg"
      ? source
      : Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><image width="512" height="512" href="data:image/png;base64,${fullSize.toString("base64")}"/></svg>\n`
        )
  const images = [
    svg,
    createIco(await Promise.all(iconSizes.map((size) => render(size).toBuffer()))),
    await render(180).flatten({ background }).toBuffer(),
    await render(192).toBuffer(),
    fullSize,
    maskable,
  ]

  // Render everything before touching existing assets so invalid input leaves them intact.
  for (const [index, relativePath] of outputPaths.entries()) {
    const destination = path.resolve(outputRoot, relativePath)
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, images[index])
  }
  return outputPaths
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        source: { type: "string" },
        background: { type: "string" },
        "output-root": { type: "string" },
        help: { type: "boolean" },
      },
    })
    if (values.help) {
      console.log(
        "Usage: node scripts/branding/generate-icons.mjs --source <approved-square-mark.svg|png|webp> --background '#RRGGBB' [--output-root <directory>]"
      )
    } else {
      const paths = await generateIcons({
        sourcePath: values.source,
        background: values.background,
        outputRoot: values["output-root"],
      })
      console.log(`Generated ${paths.length} website icons:\n${paths.join("\n")}`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
