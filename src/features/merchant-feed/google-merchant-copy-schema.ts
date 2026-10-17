import { z } from "zod"

export const googleMerchantCopySchema = z
  .object({
    version: z.literal(1),
    content: z.string(),
    origin: z.enum(["generated", "human"]),
    shared_facts_hash: z.string().regex(/^[a-f0-9]{64}$/),
    reviewed_variants: z
      .array(
        z
          .object({
            id: z.number().int().safe().nonnegative(),
            fingerprint: z.string().min(1).max(200),
            label: z.string().max(1000),
            color: z.string().min(1).max(100),
            size: z.string().min(1).max(100),
          })
          .strict()
      )
      .min(1)
      .max(10000),
    pattern: z.string().optional(),
    materials: z.record(z.string().min(1).max(100), z.string()).optional(),
  })
  .strict()
  .refine((value) => new Set(value.reviewed_variants.map((v) => v.id)).size === value.reviewed_variants.length)

export type GoogleMerchantCopy = z.infer<typeof googleMerchantCopySchema>
