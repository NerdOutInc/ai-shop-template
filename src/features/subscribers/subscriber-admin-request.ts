import { z } from "zod"

import { normalizeEmail } from "@/features/drop-signup/normalize-email"

export const subscriberAdminRequest = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("lookup"),
      email: z.string().trim().pipe(z.email().max(254)).transform(normalizeEmail),
    })
    .strict(),
  z.object({ action: z.literal("unsubscribe"), id: z.uuid() }).strict(),
  z.object({ action: z.literal("preview"), id: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("erase"),
      email: z.string().trim().pipe(z.email().max(254)).transform(normalizeEmail),
      preview: z
        .object({
          id: z.uuid(),
          updatedAt: z.string().min(1).max(64),
          deliveries: z.number().int().nonnegative().max(2147483647),
          confirmations: z.number().int().nonnegative().max(2147483647),
        })
        .strict(),
    })
    .strict(),
])
