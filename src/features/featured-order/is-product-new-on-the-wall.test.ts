import { describe, expect, it } from "vitest"

import type { FeaturedOrderProduct } from "./featured-order-product"
import { isProductNewOnTheWall } from "./is-product-new-on-the-wall"

const now = Date.parse("2026-09-20T12:00:00.000Z")
const day = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(now - days * day).toISOString()

function product(changes: Partial<FeaturedOrderProduct>): FeaturedOrderProduct {
  return {
    id: "tee",
    title: "Sample first design",
    image: null,
    hiddenAt: null,
    revealAt: null,
    revealedAt: daysAgo(40),
    addedToShopAt: daysAgo(40),
    ...changes,
  }
}

describe("isProductNewOnTheWall", () => {
  it("badges a shown product the owner added three days ago", () => {
    expect(isProductNewOnTheWall(product({ addedToShopAt: daysAgo(3) }), now)).toBe(true)
  })

  it("does not badge a shown product that has been up longer than two weeks", () => {
    expect(isProductNewOnTheWall(product({}), now)).toBe(false)
  })

  // The badge tells the owner what shoppers see, and shoppers cannot see a hidden tee at all.
  it("does not badge the same product once it is hidden", () => {
    expect(isProductNewOnTheWall(product({ addedToShopAt: daysAgo(3), hiddenAt: daysAgo(1) }), now)).toBe(false)
  })

  // A timed reveal writes nothing, so the stamp is still the one from the product's previous visit.
  it("badges a product whose reveal arrived two days ago despite an old stamp", () => {
    const returned = product({ hiddenAt: daysAgo(20), revealAt: daysAgo(2), addedToShopAt: daysAgo(40) })
    expect(isProductNewOnTheWall(returned, now)).toBe(true)
  })

  it("does not badge a product whose reveal is still to come", () => {
    const waiting = product({
      hiddenAt: daysAgo(1),
      revealAt: new Date(now + 2 * day).toISOString(),
      addedToShopAt: daysAgo(40),
    })
    expect(isProductNewOnTheWall(waiting, now)).toBe(false)
  })
})
