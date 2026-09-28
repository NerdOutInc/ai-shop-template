import { describe, expect, it } from "vitest"

import { resolveProductWeek } from "./resolve-product-week"

describe("resolveProductWeek", () => {
  const entries = [
    { id: "a", productId: "tee-a", liveAt: "2026-10-26T09:00:00.000Z" },
    { id: "b", productId: "tee-b", liveAt: "2026-10-26T09:00:00.000Z" },
    { id: "c", productId: "tee-c", liveAt: "2026-11-02T09:00:00.000Z" },
  ]

  it("keeps every product in the same week and changes membership at the exact drop", () => {
    expect(resolveProductWeek(entries, Date.parse("2026-10-26T08:59:59Z"))).toBeNull()
    expect(resolveProductWeek(entries, Date.parse("2026-10-26T09:00:00Z"))?.productIds).toEqual(["tee-a", "tee-b"])
    expect(resolveProductWeek(entries, Date.parse("2026-11-02T09:00:00Z"))?.productIds).toEqual(["tee-c"])
  })

  it("expires an empty following week at the configured weekly cadence", () => {
    const currentOnly = entries.slice(0, 2)
    expect(resolveProductWeek(currentOnly, Date.parse("2026-11-02T08:59:59Z"))?.productIds).toEqual(["tee-a", "tee-b"])
    expect(resolveProductWeek(currentOnly, Date.parse("2026-11-02T09:00:00Z"))).toBeNull()
  })
})
