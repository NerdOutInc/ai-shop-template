import { describe, expect, it } from "vitest"

import { hostedCheckoutRequestSchema } from "./hosted-checkout-request"

const request = {
  requestId: "dff5c7c9-3637-4d90-95c4-1eed416f24bd",
  expectedShippingAmount: 495,
  items: [{ productId: "111111000000000000000002", variantId: 101, quantity: 1, expectedUnitAmount: 3000 }],
}

describe("hosted checkout request", () => {
  it("accepts a cart without collecting delivery or contact information", () => {
    expect(hostedCheckoutRequestSchema.parse(request)).toEqual(request)
  })

  it.each([{ source: "https://instagram.com/private?email=person@example.com" }, "not-an-attribution-record", null])(
    "ignores malformed optional attribution without blocking checkout",
    (attribution) => {
      expect(hostedCheckoutRequestSchema.parse({ ...request, attribution })).toEqual({
        ...request,
        attribution: undefined,
      })
    }
  )

  it.each([
    {
      items: [
        { ...request.items[0]!, quantity: 10, expectedUnitAmount: 100_000 },
        { ...request.items[0]!, variantId: 102, quantity: 10 },
      ],
    },
    { items: Array.from({ length: 20 }, (_, index) => ({ ...request.items[0]!, variantId: index + 1 })) },
  ])("accepts carts at the quantity, line and unit-price boundaries", ({ items }) => {
    expect(hostedCheckoutRequestSchema.parse({ ...request, items })).toEqual({ ...request, items })
  })

  it.each([
    { ...request, total: 1 },
    { ...request, shippingAddress: { country: "US" } },
    { ...request, expectedShippingAmount: -1 },
    { ...request, requestId: "not-a-uuid" },
    { ...request, items: [] },
    { ...request, items: [{ ...request.items[0]!, quantity: 11 }] },
    { ...request, items: [{ ...request.items[0]!, expectedUnitAmount: 100_001 }] },
    {
      ...request,
      items: Array.from({ length: 21 }, (_, index) => ({ ...request.items[0]!, variantId: index + 1 })),
    },
    {
      ...request,
      items: [
        { ...request.items[0]!, quantity: 10 },
        { ...request.items[0]!, variantId: 102, quantity: 10 },
        { ...request.items[0]!, variantId: 103, quantity: 1 },
      ],
    },
  ])("rejects client-controlled payment data and invalid quantities: %j", (invalid) => {
    expect(hostedCheckoutRequestSchema.safeParse(invalid).success).toBe(false)
  })
})
