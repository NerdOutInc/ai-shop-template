import { afterEach, describe, expect, it, vi } from "vitest"

import { storeConfig as fixtureStore } from "../../../test/store-config"
import { storeConfigSchema } from "@/lib/store-config-schema"

afterEach(() => {
  vi.doUnmock("@/lib/store-config")
  vi.resetModules()
})

describe("the configured weekly feature cadence", () => {
  it.each([
    {
      id: "lake-studio",
      name: "Lake Studio",
      timeZone: "America/Chicago",
      weeklyFeature: { weekday: 5, hour: 17, minute: 30 },
      expectedSlots: ["2026-10-30T22:30:00.000Z", "2026-11-06T23:30:00.000Z"],
    },
    {
      id: "sunrise-press",
      name: "Sunrise Press",
      timeZone: "Asia/Tokyo",
      weeklyFeature: { weekday: 0, hour: 9, minute: 15 },
      expectedSlots: ["2026-10-25T00:15:00.000Z", "2026-11-01T00:15:00.000Z"],
    },
  ])("uses $name's local schedule for offers and expiry", async ({ expectedSlots, ...brand }) => {
    const storeConfig = storeConfigSchema.parse({
      ...fixtureStore,
      ...brand,
      configured: true,
      supportEmail: `support@${brand.id}.example`,
    })
    vi.resetModules()
    vi.doMock("@/lib/store-config", () => ({ storeConfig }))

    const { DOTW_CADENCE } = await import("./dotw-cadence")
    const { listCadenceSlots } = await import("./list-cadence-slots")
    const { resolveProductWeek } = await import("./resolve-product-week")

    expect(DOTW_CADENCE).toEqual({ ...brand.weeklyFeature, timeZone: brand.timeZone })
    const slots = listCadenceSlots({ from: new Date("2026-10-23T23:00:00.000Z"), count: 2 })
    expect(slots.map((slot) => slot.toISOString())).toEqual(expectedSlots)

    const entries = [{ id: "schedule-entry", productId: "featured-shirt", liveAt: expectedSlots[0]! }]
    const nextDrop = Date.parse(expectedSlots[1]!)
    expect(resolveProductWeek(entries, nextDrop - 1)?.productIds).toEqual(["featured-shirt"])
    expect(resolveProductWeek(entries, nextDrop)).toBeNull()
  })
})
