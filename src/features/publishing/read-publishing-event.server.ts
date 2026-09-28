import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

import { z } from "zod"

import type { PublishingEvent } from "./publishing-event"

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/)
const publishDetailsSchema = z.object({
  title: z.boolean().optional(),
  description: z.boolean().optional(),
  images: z.boolean().optional(),
  variants: z.boolean().optional(),
  tags: z.boolean().optional(),
  key_features: z.boolean().optional(),
  shipping_template: z.boolean().optional(),
})
const envelopeSchema = z.object({
  id: identifier,
  type: z.literal("product:publish:started"),
  created_at: z
    .string()
    .max(64)
    .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/)
    .refine((value) => Number.isFinite(Date.parse(value))),
  resource: z.object({
    id: identifier,
    type: z.literal("product"),
    data: z.object({
      shop_id: z.union([z.string().regex(/^\d+$/), z.number().int().positive().safe()]).optional(),
      action: z.enum(["create", "update", "delete"]),
      publish_details: publishDetailsSchema.optional(),
    }),
  }),
})

export function readPublishingEvent(
  rawBody: string,
  signature: string | null,
  config: { secret: string; shopId: string }
): PublishingEvent {
  if (!config.secret || !/^\d+$/.test(config.shopId)) throw new Error("Publishing webhook is not configured")
  const digest = signature?.match(/^sha256=([a-fA-F0-9]{64})$/)?.[1]
  if (!digest) throw new Error("Invalid publishing webhook signature")
  const expected = createHmac("sha256", config.secret).update(rawBody, "utf8").digest()
  if (!timingSafeEqual(expected, Buffer.from(digest, "hex"))) throw new Error("Invalid publishing webhook signature")

  const parsed = envelopeSchema.safeParse(JSON.parse(rawBody) as unknown)
  if (!parsed.success) throw new Error("Invalid publishing webhook payload")
  const { id, created_at: createdAt, resource } = parsed.data
  const { shop_id: receivedShopId, action, publish_details: publishDetails } = resource.data
  if (receivedShopId !== undefined && String(receivedShopId) !== config.shopId) {
    throw new Error("Publishing webhook belongs to another shop")
  }
  // Printify's signed delete payload omits shop_id. Its dedicated webhook
  // secret binds that event to this configured shop, rather than payload data.
  if (action !== "delete" && (receivedShopId === undefined || publishDetails === undefined)) {
    throw new Error("Publishing webhook is missing publication details")
  }
  return {
    id,
    productId: resource.id,
    shopId: config.shopId,
    createdAt,
    action,
    publishDetails: action === "delete" ? {} : (publishDetails ?? {}),
  }
}
