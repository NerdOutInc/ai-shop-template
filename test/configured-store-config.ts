import { storeConfigSchema } from "@/lib/store-config-schema"
import { storeConfig } from "./store-config"

export const configuredStoreConfig = storeConfigSchema.parse({
  ...storeConfig,
  configured: true,
  commerce: {
    ...storeConfig.commerce,
    shippingConfirmed: true,
    firstItemShippingCents: 495,
    additionalItemShippingCents: 240,
  },
  policies: {
    published: true,
    shippingText: ["Fixture care notes: wash with similar colors and follow the garment care label."],
    returnsText: ["Fixture policy: contact support about a damaged or incorrect item."],
    privacyText: ["Fixture policy: order details are used to fulfill and support your purchase."],
  },
})
