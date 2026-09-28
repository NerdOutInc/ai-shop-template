import { describe, expect, expectTypeOf, it } from "vitest"

import { buildMetaStandardEvent } from "./build-meta-standard-event"
import type { MetaCommerceItem, MetaStandardEvent, MetaStandardEventInput } from "./meta-standard-event"

const productId = "aaaaaaaaaaaaaaaaaaaaaaaa"
const item: MetaCommerceItem = { productId, variantId: 1001, quantity: 2, unitAmount: 2800 }
const secondItem: MetaCommerceItem = { ...item, variantId: 1002, quantity: 1, unitAmount: 3201 }
const receipt = "a".repeat(64)

describe("Meta standard event payloads", () => {
  it("uses the event name to narrow parameters and reject product-group commerce events", () => {
    const inputs: MetaStandardEventInput[] = [
      { name: "ViewContent", productId },
      { name: "AddToCart", items: [item] },
      { name: "InitiateCheckout", items: [item] },
      { name: "Purchase", purchase: { receipt, totalUsd: 56, items: [item] } },
    ]
    for (const input of inputs) {
      const event = buildMetaStandardEvent(input)
      expect(event).not.toBeNull()
      if (!event) throw new Error("Expected a valid baseline event")
      if (event.name === "ViewContent") {
        expectTypeOf(event.parameters.content_type).toEqualTypeOf<"product" | "product_group">()
      } else {
        expectTypeOf(event.parameters.content_type).toEqualTypeOf<"product">()
        expectTypeOf(event.parameters.currency).toEqualTypeOf<"USD">()
        expectTypeOf(event.parameters.value).toEqualTypeOf<number>()
      }
    }
    expectTypeOf<{
      name: "AddToCart" | "InitiateCheckout" | "Purchase"
      parameters: { content_type: "product_group"; content_ids: string[] }
    }>().not.toExtend<MetaStandardEvent>()
  })

  it("views the feed group without inventing a selected size or price", () => {
    const input: MetaStandardEventInput = { name: "ViewContent", productId }
    expect(buildMetaStandardEvent({ ...input, price: 28, email: "private@example.com" })).toEqual({
      name: "ViewContent",
      parameters: { content_type: "product_group", content_ids: [productId] },
    })
  })

  it("views an explicitly selected variant using its exact catalog ID and unit price", () => {
    const input: MetaStandardEventInput = {
      name: "ViewContent",
      productId,
      variant: { variantId: 1002, unitAmount: 3201 },
    }
    expect(buildMetaStandardEvent(input)).toEqual({
      name: "ViewContent",
      parameters: {
        content_type: "product",
        content_ids: [`${productId}-1002`],
        contents: [{ id: `${productId}-1002`, quantity: 1, item_price: 32.01 }],
        currency: "USD",
        value: 32.01,
        num_items: 1,
      },
    })
  })

  it.each(["AddToCart", "InitiateCheckout"] as const)(
    "%s preserves exact variants, quantities, and merchandise value",
    (name) => {
      const input: MetaStandardEventInput = { name, items: [item, secondItem] }
      expect(buildMetaStandardEvent(input)).toEqual({
        name,
        parameters: {
          content_type: "product",
          content_ids: [`${productId}-1001`, `${productId}-1002`],
          contents: [
            { id: `${productId}-1001`, quantity: 2, item_price: 28 },
            { id: `${productId}-1002`, quantity: 1, item_price: 32.01 },
          ],
          currency: "USD",
          value: 88.01,
          num_items: 3,
        },
      })
    }
  )

  it("combines repeated exact variants without merging different products or changing input", () => {
    const otherProduct = "bbbbbbbbbbbbbbbbbbbbbbbb"
    const input = Object.freeze([
      Object.freeze({ ...item, quantity: 1 }),
      Object.freeze({ ...item, productId: otherProduct }),
      Object.freeze(item),
    ])
    const result = buildMetaStandardEvent({ name: "AddToCart", items: input })
    expect(result?.parameters).toMatchObject({
      content_ids: [`${productId}-1001`, `${otherProduct}-1001`],
      contents: [
        { id: `${productId}-1001`, quantity: 3, item_price: 28 },
        { id: `${otherProduct}-1001`, quantity: 2, item_price: 28 },
      ],
      value: 140,
      num_items: 5,
    })
    expect(input.map((line) => line.quantity)).toEqual([1, 2, 2])
  })

  it("uses the confirmed purchase total including shipping and tax without transmitting private fields", () => {
    const result = buildMetaStandardEvent({
      name: "Purchase",
      sessionId: "cs_live_private",
      purchase: {
        receipt,
        totalUsd: 98.07,
        email: "private@example.com",
        shippingAddress: { address1: "Private street" },
        items: [{ ...item, title: "Private title", image: "https://private.test/mockup" }, secondItem],
      },
    })
    expect(result).toEqual({
      name: "Purchase",
      parameters: {
        content_type: "product",
        content_ids: [`${productId}-1001`, `${productId}-1002`],
        contents: [
          { id: `${productId}-1001`, quantity: 2, item_price: 28 },
          { id: `${productId}-1002`, quantity: 1, item_price: 32.01 },
        ],
        currency: "USD",
        value: 98.07,
        num_items: 3,
      },
    })
    expect(JSON.stringify(result)).not.toContain(receipt)
    expect(JSON.stringify(result)).not.toMatch(/private|sessionId|shippingAddress|email|receipt/i)
  })

  it.each([
    { input: { name: "ViewContent", productId }, accepted: true },
    ...[
      null,
      {},
      [],
      { name: "purchase", items: [item] },
      { name: "ViewContent", productId: `${productId}\n` },
      { name: "ViewContent", productId: productId.toUpperCase() },
      { name: "ViewContent", productId, variant: null },
      { name: "ViewContent", productId, variant: { variantId: 1 } },
      { name: "Purchase", paymentStatus: "paid", items: [item], totalUsd: 56 },
    ].map((input) => ({ input, accepted: false })),
  ])("validates event shape without attempting an approximate interpretation: %j", ({ input, accepted }) => {
    expect(buildMetaStandardEvent(input) !== null).toBe(accepted)
  })

  it.each([
    { patch: {}, accepted: true },
    ...[
      { productId: "unknown" },
      { productId: `${productId}\n` },
      { productId: productId.toUpperCase() },
      { variantId: "1001" },
      { variantId: 0 },
      { variantId: -1 },
      { variantId: 1.5 },
      { variantId: Number.MAX_SAFE_INTEGER + 1 },
      { quantity: "2" },
      { quantity: 0 },
      { quantity: -1 },
      { quantity: 1.5 },
      { quantity: 11 },
      { unitAmount: "2800" },
      { unitAmount: 0 },
      { unitAmount: -1 },
      { unitAmount: 2800.5 },
      { unitAmount: 100_001 },
      { unitAmount: Number.NaN },
      { unitAmount: Number.POSITIVE_INFINITY },
    ].map((patch) => ({ patch, accepted: false })),
  ])("validates item fields for every cart or purchase event: %j", ({ patch, accepted }) => {
    const items = [{ ...item, ...patch }]
    for (const name of ["AddToCart", "InitiateCheckout"])
      expect(buildMetaStandardEvent({ name, items }) !== null).toBe(accepted)
    expect(buildMetaStandardEvent({ name: "Purchase", purchase: { receipt, totalUsd: 100, items } }) !== null).toBe(
      accepted
    )
  })

  it.each([
    { items: [item], accepted: true },
    ...[
      [],
      null,
      [null],
      Array.from({ length: 21 }, (_, index) => ({ ...item, variantId: index + 1, quantity: 1 })),
      [
        { ...item, quantity: 10 },
        { ...item, quantity: 1 },
      ],
      [
        { ...item, quantity: 10 },
        { ...secondItem, quantity: 10 },
        { ...item, variantId: 1003, quantity: 1 },
      ],
      [item, { ...item, unitAmount: 2801 }],
    ].map((items) => ({ items, accepted: false })),
  ])("validates cart completeness, limits, and consistent prices: %j", ({ items, accepted }) => {
    expect(buildMetaStandardEvent({ name: "InitiateCheckout", items }) !== null).toBe(accepted)
  })

  it("accepts the cart quantity and unit-price limits without truncating valid lines", () => {
    const items = [item, secondItem].map((line) => ({ ...line, quantity: 10, unitAmount: 100_000 }))
    expect(buildMetaStandardEvent({ name: "InitiateCheckout", items })?.parameters).toMatchObject({
      value: 20_000,
      num_items: 20,
      contents: [
        { id: `${productId}-1001`, quantity: 10, item_price: 1000 },
        { id: `${productId}-1002`, quantity: 10, item_price: 1000 },
      ],
    })
  })

  it.each([
    { patch: {}, accepted: true },
    ...[
      { receipt: "cs_live_private" },
      { receipt: `${receipt}\n` },
      { totalUsd: "56" },
      { totalUsd: 55.99 },
      { totalUsd: -56 },
      { totalUsd: 56.001 },
      { totalUsd: Number.NaN },
      { totalUsd: Number.POSITIVE_INFINITY },
      { totalUsd: Number.MAX_SAFE_INTEGER },
    ].map((patch) => ({ patch, accepted: false })),
  ])("validates receipt shape and totals against the purchase lines: %j", ({ patch, accepted }) => {
    expect(
      buildMetaStandardEvent({ name: "Purchase", purchase: { receipt, totalUsd: 56, items: [item], ...patch } }) !==
        null
    ).toBe(accepted)
  })

  it("accepts cent-denominated totals despite binary floating-point multiplication", () => {
    const input: MetaStandardEventInput = {
      name: "Purchase",
      purchase: { receipt, totalUsd: 56.07, items: [item] },
    }
    expect(buildMetaStandardEvent(input)?.parameters).toMatchObject({ value: 56.07 })
  })
})
