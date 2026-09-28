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
    shippingText: [
      "Fixture policy: standard shipping is $4.95 for the first item and $2.40 for each additional item. Delivery times are estimates.",
    ],
    returnsText: ["Fixture policy: contact support about a damaged or incorrect item."],
    privacyText: ["Fixture policy: order details are used to fulfill and support your purchase."],
  },
})
