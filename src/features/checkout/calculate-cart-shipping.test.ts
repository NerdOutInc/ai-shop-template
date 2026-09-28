import "../../../test/configured-store"
import { describe, expect, it } from "vitest"

import { calculateCartShipping } from "./calculate-cart-shipping"

describe("US cart shipping", () => {
  it("charges $4.95 for the first shirt and $2.40 for each additional shirt", () => {
    expect(calculateCartShipping([])).toBe(0)
    expect(calculateCartShipping([{ quantity: 1 }])).toBe(495)
    expect(calculateCartShipping([{ quantity: 2 }])).toBe(735)
    expect(calculateCartShipping([{ quantity: 10 }, { quantity: 10 }])).toBe(5055)
  })

  it("counts shirts across designs and variants as one bag", () => {
    expect(calculateCartShipping([{ quantity: 1 }, { quantity: 2 }])).toBe(975)
    expect(calculateCartShipping([{ quantity: 3 }])).toBe(975)
  })
})
