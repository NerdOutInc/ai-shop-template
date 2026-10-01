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
])
