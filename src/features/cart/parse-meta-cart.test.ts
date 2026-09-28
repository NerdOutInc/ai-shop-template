import { describe, expect, it } from "vitest"

import { parseMetaCart } from "./parse-meta-cart"

const productId = "aaaaaaaaaaaaaaaaaaaaaaaa"
const item = `${productId}-1001`

describe("Meta cart URL parsing", () => {
  it("parses normal URL-encoded delimiters and combines repeated item lines without dropping quantity", () => {
    const url = new URL(
      `https://example.com/checkout/meta?products=${item}%3A2%2C${item}%3A3%2C${productId}-1003%3A1&coupon=`
    )
    expect(parseMetaCart(Object.fromEntries(url.searchParams))).toEqual({
      status: "ready",
      selection: [
        { productId, variantId: 1001, quantity: 5 },
        { productId, variantId: 1003, quantity: 1 },
      ],
    })
  })

  it.each([
    undefined,
    "",
    "unknown:1",
    `${productId}:1`,
    `${item}:0`,
    `${item}:-1`,
    `${item}:1.5`,
    `${item}:1e1`,
    `${item}:11`,
    `${item}:01`,
    `${item}:1\n`,
    `${item}:1,`,
    `${item}:1:2`,
    `${productId}-9007199254740992:1`,
    `${item}:6,${item}:5`,
    `${item}:10,${productId}-1003:10,${productId}-1004:1`,
    Array.from({ length: 21 }, () => `${item}:1`).join(","),
    "a".repeat(4097),
    [`${item}:1`, `${item}:2`],
  ])("rejects incomplete, malformed, ambiguous or over-limit selections", (products) => {
    expect(parseMetaCart({ products })).toEqual({ status: "error", reason: "invalid" })
  })

  it.each([
    `${item}:10,${productId}-1003:10`,
    Array.from({ length: 20 }, (_, index) => `${productId}-${index + 1}:1`).join(","),
  ])("accepts selections at the checkout quantity and line boundaries", (products) => {
    const result = parseMetaCart({ products })
    expect(result.status).toBe("ready")
    if (result.status === "ready")
      expect(result.selection.reduce((sum, selection) => sum + selection.quantity, 0)).toBe(20)
  })

  it("canonicalizes equivalent ordering for duplicate protection and ignores URL pricing claims", () => {
    const first = parseMetaCart({ products: `${item}:1,${productId}-1003:2`, price: "1", currency: "EUR" })
    expect(first).toEqual(parseMetaCart({ products: `${productId}-1003:2,${item}:1` }))
  })

  it("rejects coupon-bearing links and ambiguous repeated coupon parameters", () => {
    expect(parseMetaCart({ products: `${item}:1`, coupon: "SAVE10" })).toEqual({ status: "error", reason: "coupon" })
    expect(parseMetaCart({ products: `${item}:1`, coupon: ["", "SAVE10"] })).toEqual({
      status: "error",
      reason: "invalid",
    })
  })
})
