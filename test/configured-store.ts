import { afterEach, beforeEach } from "vitest"
import { storeConfig } from "@/lib/store-config"

// Explicit configured-store fixture for commerce regression tests, never a new store's business defaults.
const original = structuredClone(storeConfig)
beforeEach(() => {
  storeConfig.configured = true
  storeConfig.policies.published = true
  storeConfig.commerce.shippingConfirmed = true
  storeConfig.commerce.firstItemShippingCents = 495
  storeConfig.commerce.additionalItemShippingCents = 240
})
afterEach(() => {
  Object.assign(storeConfig, structuredClone(original))
})
