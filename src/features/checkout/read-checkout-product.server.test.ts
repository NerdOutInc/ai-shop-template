import { describe, expect, it, vi } from "vitest"

import { PrintifyClient } from "./printify-client.server"
import { readCheckoutProduct } from "./read-checkout-product.server"

vi.mock("server-only", () => ({}))
const config = vi.hoisted(() => ({ PRINTIFY_PUBLISHING_ENABLED: false }))
vi.mock("@/lib/env", () => ({ env: config }))

const product = {
  id: "shirt",
  shop_id: 1234,
  title: "Toast",
  blueprint_id: 1317,
  print_provider_id: 99,
  print_areas: [
    {
      variant_ids: [101],
      placeholders: [{ position: "front", images: [{ id: "artwork", x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
    },
  ],
  variants: [{ id: 101, price: 3000, is_enabled: true, is_available: true, options: [1] }],
  options: [{ name: "Size", values: [{ id: 1, title: "M" }] }],
}

describe.each([false, true])("fresh checkout product with publishing enabled=%s", (publishingEnabled) => {
  it("returns the current production fingerprint", async () => {
    config.PRINTIFY_PUBLISHING_ENABLED = publishingEnabled
    const client = new PrintifyClient({ apiToken: "fake-token", shopId: "1234" })
    vi.spyOn(client, "request").mockResolvedValue(product)
    expect((await readCheckoutProduct(client, product.id)).variants[0]).toMatchObject({
      available: true,
      fingerprint: expect.stringMatching(/^v2:[a-f0-9]{64}$/),
    })
  })

  it("ignores extra response attributes without changing the checked production identity", async () => {
    config.PRINTIFY_PUBLISHING_ENABLED = publishingEnabled
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const raw = { ...structuredClone(product), print_details: { print_on_side: "mirror" } }
    const area = raw.print_areas[0]!
    const placeholder = area.placeholders[0]!
    const image = placeholder.images[0]!
    const pattern = { spacing_x: 0.1, spacing_y: 0.2, angle: 30, offset: 0.5 }
    Object.assign(image, { pattern })
    const client = new PrintifyClient({ apiToken: "fake-token", shopId: "1234" })
    vi.spyOn(client, "request").mockResolvedValue(raw)
    const before = (await readCheckoutProduct(client, product.id)).variants[0]!

    Object.assign(area, { country: null, canvas: true, response_version: 2 })
    Object.assign(placeholder, { response_version: 2 })
    Object.assign(image, { src: null, name: [], imageId: {}, response_version: 2 })
    Object.assign(pattern, { response_version: 2 })
    Object.assign(raw.print_details, { response_version: 2 })
    Object.assign(raw.options[0]!, { name: null })
    const after = (await readCheckoutProduct(client, product.id)).variants[0]!

    expect(after).toMatchObject({ available: true, fingerprint: before.fingerprint })
    expect(log).not.toHaveBeenCalled()
  })

  it("signals malformed production geometry while keeping checkout closed", async () => {
    config.PRINTIFY_PUBLISHING_ENABLED = publishingEnabled
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const raw = structuredClone(product)
    Object.assign(raw.print_areas[0]!.placeholders[0]!.images[0]!, {
      scale: "private invalid placement",
      response_version: 2,
    })
    const client = new PrintifyClient({ apiToken: "fake-token", shopId: "1234" })
    vi.spyOn(client, "request").mockResolvedValue(raw)
    await expect(readCheckoutProduct(client, product.id)).rejects.toMatchObject({
      code: "PRODUCT_UNAVAILABLE",
      status: 409,
    })
    expect(log).toHaveBeenCalledExactlyOnceWith("Printify production schema changed", {
      code: "PRODUCT_SCHEMA_DRIFT",
      productId: product.id,
      shopId: "1234",
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain("private")
  })

  it.each(["disabled", "out-of-stock", "zero-draft-price"])("checks %s conservatively", async (change) => {
    config.PRINTIFY_PUBLISHING_ENABLED = publishingEnabled
    const raw = structuredClone(product)
    if (change === "disabled") raw.variants[0]!.is_enabled = false
    if (change === "out-of-stock") raw.variants[0]!.is_available = false
    if (change === "zero-draft-price") raw.variants[0]!.price = 0
    const client = new PrintifyClient({ apiToken: "fake-token", shopId: "1234" })
    vi.spyOn(client, "request").mockResolvedValue(raw)
    expect((await readCheckoutProduct(client, product.id)).variants[0]!.available).toBe(change === "zero-draft-price")
  })
})
