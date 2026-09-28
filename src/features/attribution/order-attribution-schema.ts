import { z } from "zod"

const campaignLabel = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/)
const hostname = z
  .string()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)
const landingPath = z
  .string()
  .regex(/^\/(?:shop(?:\/[A-Za-z0-9_-]{1,120})?|cart|design-of-the-week|shipping|returns|privacy|checkout\/meta)?$/)

export const orderAttributionSchema = z
  .object({
    version: z.literal(1),
    capturedAt: z.iso.datetime(),
    channel: z.enum(["organic_search", "paid", "social", "email", "referral", "direct"]),
    source: z.union([campaignLabel, hostname]).nullable(),
    referrerHost: hostname.nullable(),
    utmSource: campaignLabel.nullable(),
    utmMedium: campaignLabel.nullable(),
    utmCampaign: campaignLabel.nullable(),
    landingPath,
    method: z.enum(["campaign", "referrer", "direct", "meta_checkout"]),
  })
  .strict()

export type OrderAttribution = z.infer<typeof orderAttributionSchema>
