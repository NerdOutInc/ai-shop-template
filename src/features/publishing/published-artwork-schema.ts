import { z } from "zod"

import { readPublicArtworkLocation } from "@/lib/read-public-artwork-location"

export const publishedArtworkSchema = z
  .object({
    src: z.string(),
    revisionId: z.uuid(),
    productionFingerprint: z.string().regex(/^artwork-v1:[a-f0-9]{64}$/),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().positive().max(1200),
    height: z.number().int().positive().max(1200),
  })
  .strict()
  .refine((value) => readPublicArtworkLocation(value.src)?.sha256 === value.sha256)

export type PublishedArtwork = z.infer<typeof publishedArtworkSchema>
