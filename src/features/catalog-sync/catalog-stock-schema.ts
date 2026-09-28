import { z } from "zod"

export const catalogStockSchema = z.object({
  fingerprintVersion: z.string(),
  products: z.record(
    z.string(),
    z.array(
      z.object({
        id: z.number().int(),
        enabled: z.boolean(),
        inStock: z.boolean(),
        fingerprint: z.string(),
      })
    )
  ),
})

export type CatalogStock = z.infer<typeof catalogStockSchema>
