import { z } from "zod"
import { galleryPhotoRoleSchema } from "./gallery-photo-role-schema"

const binding = z
  .object({
    version: z.string().min(1).max(40),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRevision: z.string().regex(/^\d{1,20}$/),
  })
  .strict()
const metadata = {
  alt: z.string().trim().min(1).max(300),
  role: galleryPhotoRoleSchema,
  viewKey: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/)
    .optional(),
}
const entry = z.discriminatedUnion("source", [
  z
    .object({ source: z.literal("store"), assetId: z.uuid(), publicUrl: z.string().max(1000).optional(), ...metadata })
    .strict(),
  z
    .object({
      source: z.literal("provider"),
      src: z.string().max(1000),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      sourceRevision: z.string().regex(/^\d{1,20}$/),
      ...metadata,
    })
    .strict(),
])

export const galleryManifestSchema = z
  .object({
    version: z.literal(1),
    coverColor: z
      .string()
      .regex(/^(none|\d+)$/)
      .nullable(),
    colors: z
      .array(
        z
          .object({
            colorKey: z.string().regex(/^(none|\d+)$/),
            entries: z.array(entry).min(1).max(12),
            reviewedBinding: binding.nullable(),
          })
          .strict()
      )
      .max(80),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (
      new Set(manifest.colors.map((c) => c.colorKey)).size !== manifest.colors.length ||
      manifest.colors.reduce((n, c) => n + c.entries.length, 0) > 120
    )
      ctx.addIssue({ code: "custom", message: "Use distinct colors and at most 120 photos." })
    for (const color of manifest.colors) {
      const ids = color.entries.map((e) => (e.source === "store" ? e.assetId : e.src))
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({ code: "custom", message: "Each photo may appear once per color." })
    }
  })
export type GalleryManifest = z.infer<typeof galleryManifestSchema>
export type GalleryColor = GalleryManifest["colors"][number]
export type GalleryEntry = GalleryColor["entries"][number]
export type GalleryBinding = NonNullable<GalleryColor["reviewedBinding"]>
