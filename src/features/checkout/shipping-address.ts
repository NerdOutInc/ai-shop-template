import { z } from "zod"

import { usShippingRegions } from "./us-shipping-regions"

const addressText = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((text) => !/[\r\n\u0000-\u001f]/.test(text))
const states = new Set(usShippingRegions)

export const shippingAddressSchema = z
  .object({
    firstName: addressText,
    lastName: addressText,
    email: z.email().max(254),
    phone: z
      .string()
      .trim()
      .min(5)
      .max(30)
      .regex(/^[+\d(). -]+$/),
    country: z.literal("US"),
    region: z.string().refine((region) => states.has(region)),
    city: addressText,
    address1: addressText,
    address2: z
      .string()
      .trim()
      .max(100)
      .refine((text) => !/[\r\n\u0000-\u001f]/.test(text))
      .optional()
      .default(""),
    zip: z.string().regex(/^\d{5}(-\d{4})?$/),
  })
  .strict()

export type ShippingAddress = z.infer<typeof shippingAddressSchema>
