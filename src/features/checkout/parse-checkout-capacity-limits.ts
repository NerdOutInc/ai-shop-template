import { z } from "zod"

const budget = (perMinute: number, burst: number, minimumBurst = 1) =>
  z
    .object({
      perMinute: z.number().int().min(1).max(60_000).default(perMinute),
      burst: z.number().int().min(minimumBurst).max(60_000).default(burst),
    })
    .strict()
    .prefault({})

const limitsSchema = z
  .object({
    ingress: budget(60, 30),
    status: budget(120, 20),
    stripeRead: budget(120, 10),
    providerRead: budget(120, 20, 20),
  })
  .strict()

export function parseCheckoutCapacityLimits(value?: string) {
  return limitsSchema.parse(value ? JSON.parse(value) : {})
}
