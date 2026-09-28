import { z } from "zod"

const text = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), "Surrounding whitespace is not allowed")
const hash = z.string().regex(/^[a-f0-9]{64}$/)

/** One artwork revision and its assets, shared by design registration and preparation. */
export const libraryRevisionSchema = z.object({
  id: z.uuid(),
  assets: z
    .array(
      z.object({
        id: z.uuid(),
        url: z.string(),
        kind: z.enum(["original", "print", "preview"]),
        status: z.enum(["pending", "ready", "unavailable"]),
        mimeType: z.enum(["image/png", "image/webp", "image/jpeg"]),
        width: z.number().int().positive().nullable(),
        height: z.number().int().positive().nullable(),
        bytes: z.number().int().positive().nullable(),
        sha256: hash.nullable(),
        pixelSha256: hash.nullable(),
        perceptualHash: z
          .string()
          .regex(/^[a-f0-9]{16}$/)
          .nullable(),
        hasAlpha: z.boolean().nullable(),
        hasTransparency: z.boolean().nullable(),
        enlarged: z.boolean().nullable(),
        pathname: text.nullable(),
        sourcePath: text.nullable(),
        originalFilename: text.refine((value) => !/[/\\\r\n\0]/.test(value), "Expected a filename"),
      })
    )
    .min(1),
  printReadiness: z.enum(["unverified", "needs-preparation", "ready"]),
  printNotes: z.string().nullable(),
  widthInches: z.number().positive().nullable(),
  heightInches: z.number().positive().nullable(),
  nativePpi: z.number().positive().nullable(),
})
