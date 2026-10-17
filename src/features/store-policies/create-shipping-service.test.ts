import "../../../test/configured-store"
import { afterEach, describe, expect, it, vi } from "vitest"

import { cartLimits } from "@/lib/cart-limits"
import * as shipping from "@/features/checkout/calculate-cart-shipping"
import { calculateCartShipping } from "@/features/checkout/calculate-cart-shipping"
import { shippingAddressSchema } from "@/features/checkout/shipping-address"
import { usShippingRegions } from "@/features/checkout/us-shipping-regions"

import { createShippingService } from "./create-shipping-service"
import { deliveryEstimates } from "./delivery-estimates"
import { getShippingPolicySummary } from "./get-shipping-policy-summary"

const originalRegions = [...usShippingRegions]
const originalExtendedRegions = [...deliveryEstimates.extendedRegions]

describe("createShippingService", () => {
  it.each([
    [0, cartLimits.maxTotalQuantity],
    [200, 1],
  ])("limits free-shipping structured data when additional items cost %s", (additional, maxValue) => {
    vi.spyOn(shipping, "calculateCartShipping").mockImplementation(([item]) => ((item?.quantity ?? 1) - 1) * additional)
    const conditions = createShippingService(new URL("https://example.com"))!.shippingConditions
    expect(
      conditions.every((condition) => condition.shippingRate.value === 0 && condition.numItems.maxValue === maxValue)
    ).toBe(true)
  })

  afterEach(() => {
    usShippingRegions.splice(0, usShippingRegions.length, ...originalRegions)
    deliveryEstimates.extendedRegions = [...originalExtendedRegions]
  })

  it.each([
    {
      name: "checkout no longer accepts Alaska or Hawaii",
      regions: ["CA", "MN"],
      extendedRegions: ["AK", "HI"],
      groups: [["CA", "MN"]],
      durations: [[2, 5]],
      wording: "Estimated delivery, including printing: 4–15 business days to CA and MN.",
    },
    {
      name: "only Hawaii is enabled",
      regions: ["HI"],
      extendedRegions: ["AK", "HI"],
      groups: [["HI"]],
      durations: [[9, 17]],
      wording: "Estimated delivery, including printing: 11–27 business days to Hawaii.",
    },
    {
      name: "Alaska moves to standard transit",
      regions: ["AK", "CA"],
      extendedRegions: [],
      groups: [["AK", "CA"]],
      durations: [[2, 5]],
      wording: "Estimated delivery, including printing: 4–15 business days to Alaska and CA.",
    },
    {
      name: "a different state gets extended transit",
      regions: ["CA", "HI"],
      extendedRegions: ["CA"],
      groups: [["HI"], ["CA"]],
      durations: [
        [2, 5],
        [9, 17],
      ],
      wording: "Estimated delivery, including printing: 4–15 business days to Hawaii; 11–27 business days to CA.",
    },
    {
      name: "no destinations are enabled",
      regions: [],
      extendedRegions: ["AK", "HI"],
      groups: [],
      durations: [],
      wording: "Shipping is currently unavailable.",
    },
  ])(
    "keeps public wording and structured data consistent when $name",
    ({ regions, extendedRegions, groups, durations, wording }) => {
      usShippingRegions.splice(0, usShippingRegions.length, ...regions)
      deliveryEstimates.extendedRegions = extendedRegions

      const service = createShippingService(new URL("https://example.com"))!

      expect(getShippingPolicySummary().delivery).toBe(wording)
      expect(service.description).toContain(wording)
      expect(service.shippingConditions.map((condition) => condition.shippingDestination.addressRegion)).toEqual(groups)
      expect(
        service.shippingConditions.map(({ transitTime }) => [
          transitTime.duration.minValue,
          transitTime.duration.maxValue,
        ])
      ).toEqual(durations)
    }
  )

  it("limits the checkout-derived shipping rate to one shirt in both delivery regions", () => {
    const service = createShippingService(new URL("https://example.com"))!
    const conditions = service.shippingConditions[0]!
    const extendedConditions = service.shippingConditions[1]!

    expect(service["@id"]).toBe("https://example.com/shipping#standard-shipping")
    expect(conditions.numItems).toEqual({ "@type": "QuantitativeValue", maxValue: 1 })
    expect(conditions.shippingRate).toEqual({ "@type": "MonetaryAmount", currency: "USD", value: 4.95 })
    expect(conditions.shippingRate.value).toBe(calculateCartShipping([{ quantity: 1 }]) / 100)
    expect(conditions.shippingRate.value).toBeLessThan(calculateCartShipping([{ quantity: 2 }]) / 100)
    expect(service.description).toContain("plus $2.40 for each additional shirt")
    expect(extendedConditions.shippingRate).toEqual(conditions.shippingRate)
    expect(extendedConditions.numItems).toEqual(conditions.numItems)
  })

  it("keeps the advertised amount and description aligned for a 435-cent checkout rate", () => {
    vi.spyOn(shipping, "calculateCartShipping").mockImplementation(([item]) => (item?.quantity === 1 ? 435 : 635))

    const service = createShippingService(new URL("https://example.com"))!

    expect(service.shippingConditions.every((condition) => condition.shippingRate.value === 4.35)).toBe(true)
    expect(service.description).toContain("$4.35 for the first shirt, plus $2.00 for each additional shirt")
  })

  it("advertises exactly the regions accepted at checkout, including Alaska, Hawaii, and DC", () => {
    const conditions = createShippingService(new URL("https://example.com"))!.shippingConditions
    const regions = conditions.flatMap((condition) => condition.shippingDestination.addressRegion)
    const regionSchema = shippingAddressSchema.shape.region

    expect(conditions.every((condition) => condition.shippingDestination.addressCountry === "US")).toBe(true)
    expect(regions).toHaveLength(51)
    expect(new Set(regions).size).toBe(51)
    expect(regions).toEqual(expect.arrayContaining(["AK", "HI", "DC"]))
    for (const region of regions) expect(regionSchema.safeParse(region).success).toBe(true)
    for (const region of ["PR", "GU", "VI", "AS", "MP", "UM", "AA", "AE", "AP"]) {
      expect(regions).not.toContain(region)
      expect(regionSchema.safeParse(region).success).toBe(false)
    }
  })

  it("counts printing separately and gives Alaska and Hawaii the longer transit estimate", () => {
    const service = createShippingService(new URL("https://example.com"))!
    const contiguous = service.shippingConditions[0]!
    const extended = service.shippingConditions[1]!

    expect(service.handlingTime).toEqual({
      "@type": "ServicePeriod",
      duration: { "@type": "QuantitativeValue", minValue: 2, maxValue: 10, unitCode: "DAY" },
      businessDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    })
    expect(contiguous.transitTime.duration).toMatchObject({ minValue: 2, maxValue: 5, unitCode: "DAY" })
    expect(contiguous.shippingDestination.addressRegion).not.toEqual(expect.arrayContaining(["AK", "HI"]))
    expect(extended.shippingDestination.addressRegion).toEqual(["AK", "HI"])
    expect(extended.transitTime.duration).toMatchObject({ minValue: 9, maxValue: 17, unitCode: "DAY" })
    for (const condition of service.shippingConditions) {
      expect(condition.transitTime.businessDays).toEqual(service.handlingTime.businessDays)
    }
    expect(service.description).toContain("4–15 business days in the contiguous US")
    expect(service.description).toContain("11–27 business days to Alaska and Hawaii")
  })
})
