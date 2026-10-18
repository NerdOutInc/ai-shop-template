import { z } from "zod"
import { galleryManifestSchema } from "./gallery-manifest-schema"
const color = galleryManifestSchema.shape.colors.element
const entry = z.discriminatedUnion("source", [
  color.shape.entries.element.options[0].omit({ publicUrl: true }),
  color.shape.entries.element.options[1].omit({ sha256: true, sourceRevision: true }),
])
const expected = { revision: z.uuid().nullable(), productRevision: z.string().regex(/^\d{1,20}$/) }
export const galleryMutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("save"),
      ...expected,
      manifest: z
        .object({
          coverColor: galleryManifestSchema.shape.coverColor,
          colors: z
            .array(
              color.omit({ reviewedBinding: true, entries: true }).extend({ entries: z.array(entry).min(1).max(12) })
            )
            .max(80),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("activate"),
      ...expected,
      confirmations: z.record(color.shape.colorKey, z.string().regex(/^[a-f0-9]{64}$/)),
    })
    .strict(),
  z.object({ action: z.literal("restore"), ...expected, fromRevision: z.uuid() }).strict(),
])
export type GalleryMutation = z.infer<typeof galleryMutationSchema>
export type GalleryActivation = Extract<GalleryMutation, { action: "activate" }>
