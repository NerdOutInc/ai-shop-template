import "../../../test/configured-store"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as shipping from "@/features/checkout/calculate-cart-shipping"
import { usShippingRegions } from "@/features/checkout/us-shipping-regions"

import { getShippingPolicySummary } from "./get-shipping-policy-summary"

const originalRegions = [...usShippingRegions]

describe("getShippingPolicySummary", () => {
  it.each([
    [0, 0, "free"],
    [0, 200, "$0.00 for the first shirt, plus $2.00 for each additional shirt"],
  ])("describes zero rates without claiming paid additional items are free", (first, additional, rate) => {
    vi.spyOn(shipping, "calculateCartShipping").mockImplementation(
      ([item]) => first + ((item?.quantity ?? 1) - 1) * additional
    )
    expect(getShippingPolicySummary().rate).toBe(rate)
    expect(getShippingPolicySummary().free).toBe(first === 0 && additional === 0)
  })

  afterEach(() => {
    usShippingRegions.splice(0, usShippingRegions.length, ...originalRegions)
  })

  it("formats checkout rates without retaining today's hard-coded prices", () => {
    vi.spyOn(shipping, "calculateCartShipping").mockImplementation(([item]) => (item?.quantity === 1 ? 435 : 635))

    expect(getShippingPolicySummary().rate).toBe("$4.35 for the first shirt, plus $2.00 for each additional shirt")
  })

  it("describes the current checkout coverage in familiar terms", () => {
    expect(getShippingPolicySummary().destination).toBe("all 50 US states and Washington, DC")
  })

  it("names only the enabled destinations when checkout coverage narrows", () => {
    usShippingRegions.splice(0, usShippingRegions.length, "CA", "MN")

    expect(getShippingPolicySummary().destination).toBe("these US destinations: CA, MN")
  })

  it("does not mistake 51 different destinations for all 50 states and DC", () => {
    usShippingRegions[usShippingRegions.indexOf("CA")] = "PR"

    const { destination } = getShippingPolicySummary()

    expect(destination).not.toContain("all 50")
    expect(destination).toContain("PR")
    expect(destination).not.toContain("CA")
  })
})
