import { z } from "zod"

import { orderAttributionSchema } from "@/features/attribution/order-attribution-schema"

import { cartLimits } from "@/lib/cart-limits"

export const hostedCheckoutRequestSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            productId: z.string().regex(/^[a-f0-9]{24}$/),
            variantId: z.number().int().positive(),
            quantity: z.number().int().min(1).max(cartLimits.maxQuantityPerVariant),
            expectedUnitAmount: z.number().int().positive().max(cartLimits.maxUnitAmount),
          })
          .strict()
      )
      .min(1)
      .max(cartLimits.maxLines)
      .refine((items) => items.reduce((sum, item) => sum + item.quantity, 0) <= cartLimits.maxTotalQuantity),
    requestId: z.uuid(),
    expectedShippingAmount: z.number().int().nonnegative().max(100_000),
    // Marketing metadata is optional; a malformed tag must never prevent a purchase.
    attribution: orderAttributionSchema.optional().catch(undefined),
  })
  .strict()

export type HostedCheckoutRequest = z.infer<typeof hostedCheckoutRequestSchema>
