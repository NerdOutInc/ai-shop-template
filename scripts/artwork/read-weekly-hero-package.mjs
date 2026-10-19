import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import { z } from "zod"

const positive = z.number().finite().positive()
const coordinate = z.number().finite().nonnegative()
const image = z
  .object({
    path: z
      .string()
      .regex(/^(source|references|final)\/[a-zA-Z0-9_./-]+$/)
      .refine((value) => !value.split("/").includes("..")),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: positive.int(),
    height: positive.int(),
  })
  .passthrough()
const placement = z.object({
  left: coordinate,
  top: coordinate,
  width: positive,
  angle: z.number().finite().min(-180).max(180).default(0),
})
const composition = z
  .object({
    background: image,
    outputWidth: positive.int(),
    garments: z
      .array(placement.extend({ garment: z.string() }))
      .min(1)
      .max(6),
    overlays: z
      .array(
        placement.extend({
          source: image,
          shadow: z
            .object({
              rgb: z.tuple([z.number().min(0).max(255), z.number().min(0).max(255), z.number().min(0).max(255)]),
              blur: positive,
              x: z.number().finite(),
              y: z.number().finite(),
            })
            .optional(),
        })
      )
      .max(30)
      .default([]),
    webpOptions: z.object({
      quality: z.number().int().min(80).max(100),
      effort: z.number().int().min(0).max(6).default(6),
    }),
    master: image.optional(),
    upload: image.optional(),
  })
  .passthrough()
const schema = z
  .object({
    schemaVersion: z.literal(1),
    garments: z.record(
      z.string(),
      z
        .object({
          artwork: image,
          blank: image,
          photo: image,
          photoCutoutOrigin: z.object({ left: coordinate, top: coordinate }),
          photoInkMeasurement: z
            .object({ bounds: z.object({ left: coordinate, top: coordinate, width: positive, height: positive }) })
            .passthrough(),
        })
        .passthrough()
    ),
    compositions: z.object({ desktop: composition, mobile: composition }).strict(),
    renderer: z.record(z.string(), z.string()).optional(),
  })
  .passthrough()

/** Work only on a restored private package in ignored staging; never fetch remote assets. */
export async function readWeeklyHeroPackage(directory) {
  const root = fileURLToPath(new URL("../../", import.meta.url))
  const staging = path.join(root, ".tmp", "weekly-heroes")
  const source = path.resolve(directory)
  if (!source.startsWith(staging + path.sep))
    throw new Error("Restore the private package under .tmp/weekly-heroes/NAME")
  async function safePath(relative, missing = false) {
    const file = path.resolve(source, relative)
    if (!file.startsWith(source + path.sep)) throw new Error("Package path escapes staging")
    let current = root
    for (const segment of path.relative(root, file).split(path.sep)) {
      current = path.join(current, segment)
      const stat = await fs.lstat(current).catch((error) => {
        if (missing && error.code === "ENOENT") return null
        throw error
      })
      if (stat?.isSymbolicLink()) throw new Error("Private packages cannot contain symlinks")
    }
    return file
  }
  const relative = path.relative(root, source)
  if (execFileSync("git", ["ls-files", "--", relative], { cwd: root, encoding: "utf8" }).trim())
    throw new Error("Operational hero packages must not be tracked in Git")
  execFileSync("git", ["check-ignore", "-q", "--", relative], { cwd: root })
  const manifest = await safePath("composition.json")
  const plan = schema.parse(JSON.parse(await fs.readFile(manifest, "utf8")))
  async function input(record, final = false) {
    if (record.path.startsWith("final/") !== final)
      throw new Error("Keep original inputs in source/ or references/ and outputs in final/")
    const bytes = await fs.readFile(await safePath(record.path))
    if (createHash("sha256").update(bytes).digest("hex") !== record.sha256)
      throw new Error(`Source hash changed: ${record.path}`)
    const metadata = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "truncated" }).metadata()
    if (
      metadata.width !== record.width ||
      metadata.height !== record.height ||
      (metadata.pages ?? 1) !== 1 ||
      (metadata.orientation && metadata.orientation !== 1)
    )
      throw new Error(`Source dimensions or orientation changed: ${record.path}`)
    return bytes
  }
  return { source, plan, input, safePath }
}
