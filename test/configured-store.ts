import { afterEach, beforeEach } from "vitest"
import { configuredStoreConfig } from "./configured-store-config"
import { storeConfig } from "@/lib/store-config"

// Explicit configured-store fixture for commerce regression tests, never a new store's business defaults.
const original = structuredClone(storeConfig)
beforeEach(() => {
  Object.assign(storeConfig, structuredClone(configuredStoreConfig))
})
afterEach(() => {
  Object.assign(storeConfig, structuredClone(original))
})
