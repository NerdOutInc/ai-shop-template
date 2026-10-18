import "../../../test/configured-store"
import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { readGallerySource } from "@/features/product-gallery/read-gallery-source.server"
import { resolveProductGallery } from "@/features/product-gallery/resolve-product-gallery.server"
import { readPublishedProduct } from "@/features/publishing/read-published-product.server"

import { galleryProductFixture } from "../../../test/gallery-product-fixture"

import { PrintifyClient } from "./printify-client.server"

import { hostedCheckoutRequestSchema } from "./hosted-checkout-request"
import { readCheckoutItems } from "./read-checkout-items.server"

vi.mock("server-only", () => ({}))
const publishingConfig = vi.hoisted(() => ({ PRINTIFY_PUBLISHING_ENABLED: true }))
vi.mock("@/features/publishing/read-published-product.server", () => ({ readPublishedProduct: vi.fn() }))
vi.mock("@/lib/env", () => ({ env: publishingConfig }))

beforeEach(() => {
  publishingConfig.PRINTIFY_PUBLISHING_ENABLED = true
  vi.mocked(readPublishedProduct).mockReset()
})

describe("readCheckoutItems", () => {
  const fixture = () => {
    const data = {
      productId: "111111000000000000000002",
      printify: new PrintifyClient({ apiToken: "test-secret-not-real", shopId: "1234" }),
    }
    const request = {
      items: [{ productId: data.productId, variantId: 101, quantity: 2, expectedUnitAmount: 3000 }],
      requestId: randomUUID(),
      expectedShippingAmount: 735,
    }
    const product = {
      id: data.productId,
      shop_id: 1234,
      title: "Toast",
      blueprint_id: 1317,
      print_provider_id: 99,
      images: [{ src: "https://images.printify.com/forest-front.jpg", variant_ids: [101], is_default: true }],
      print_areas: [
        {
          variant_ids: [101],
          placeholders: [
            {
              position: "front",
              images: [{ id: "private-art", imageId: "response-a", x: 0.5, y: 0.4, scale: 1, angle: 0 }],
            },
          ],
        },
      ],
      variants: [{ id: 101, price: 3000, is_enabled: true, is_available: true, options: [1] }],
      options: [{ name: "Size", values: [{ id: 1, title: "M" }] }],
    }
    vi.mocked(readPublishedProduct).mockImplementation(async (id) => (id === product.id ? product : null))
    return {
      ...data,
      request,
      product,
      reserve: vi.fn<(count: number) => Promise<void>>().mockResolvedValue(undefined),
    }
  }

  it("reads approved variants and live availability without quoting an address", async () => {
    const data = fixture()
    const request = vi.spyOn(data.printify, "request").mockResolvedValue(data.product)
    expect(await readCheckoutItems(data.printify, data.request, data.reserve)).toMatchObject([
      { quantity: 2, unitAmount: 3000, imageUrl: "https://images.printify.com/forest-front.jpg" },
    ])
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each(["price", "disabled", "unavailable", "other-shop", "other-product"])(
    "blocks a %s response before shipping or payment",
    async (change) => {
      const data = fixture()
      if (change === "price") data.product.variants[0]!.price = 3200
      if (change === "disabled") data.product.variants[0]!.is_enabled = false
      if (change === "unavailable") data.product.variants[0]!.is_available = false
      if (change === "other-shop") data.product.shop_id = 9876
      if (change === "other-product") data.product.id = "different-product"
      const request = vi.spyOn(data.printify, "request").mockResolvedValue(data.product)
      await expect(readCheckoutItems(data.printify, data.request, data.reserve)).rejects.toThrow()
      expect(request).toHaveBeenCalledTimes(change === "unavailable" ? 1 : 0)
    }
  )

  it.each([
    { change: "wrong-client-price", code: "PRICE_CHANGED" },
    { change: "disabled-variant", code: "PRODUCT_UNAVAILABLE" },
    { change: "unknown-variant", code: "PRODUCT_UNAVAILABLE" },
    { change: "zero-price", code: "PRODUCT_UNAVAILABLE" },
  ])("rejects $change from the published snapshot before live reads", async ({ change, code }) => {
    const data = fixture()
    const published = structuredClone(data.product)
    if (change === "wrong-client-price") data.request.items[0]!.expectedUnitAmount = 1
    if (change === "disabled-variant") published.variants[0]!.is_enabled = false
    if (change === "unknown-variant") data.request.items[0]!.variantId = 999
    if (change === "zero-price") published.variants[0]!.price = 0
    vi.mocked(readPublishedProduct).mockResolvedValue(published)
    const request = vi.spyOn(data.printify, "request").mockResolvedValue(data.product)
    await expect(readCheckoutItems(data.printify, data.request, data.reserve)).rejects.toMatchObject({ code })
    expect(request).not.toHaveBeenCalled()
    expect(data.reserve).not.toHaveBeenCalled()
  })

  it("validates every published cart line before starting any live product read", async () => {
    const data = fixture()
    const second = { ...structuredClone(data.product), id: "111111000000000000000003" }
    vi.mocked(readPublishedProduct).mockImplementation(async (id) => (id === second.id ? second : data.product))
    data.request.items.push({ ...data.request.items[0]!, productId: second.id, expectedUnitAmount: 1 })
    const request = vi.spyOn(data.printify, "request").mockResolvedValue(data.product)
    await expect(readCheckoutItems(data.printify, data.request, data.reserve)).rejects.toMatchObject({
      code: "PRICE_CHANGED",
    })
    expect(request).not.toHaveBeenCalled()
    expect(data.reserve).not.toHaveBeenCalled()
  })

  it("charges actual failed provider reads and reserves again on a later retry", async () => {
    const data = fixture()
    const provider = vi
      .spyOn(data.printify, "request")
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValue(data.product)
    await expect(readCheckoutItems(data.printify, data.request, data.reserve)).rejects.toThrow("provider unavailable")
    expect(data.reserve).toHaveBeenCalledExactlyOnceWith(1)
    expect(data.reserve.mock.invocationCallOrder[0]).toBeLessThan(provider.mock.invocationCallOrder[0]!)
    await readCheckoutItems(data.printify, data.request, data.reserve)
    expect(data.reserve).toHaveBeenCalledTimes(2)
  })

  it("rejects an exhausted expensive budget after validation but before any live read", async () => {
    const data = fixture()
    data.reserve.mockRejectedValueOnce({ code: "CHECKOUT_RATE_LIMITED" })
    const provider = vi.spyOn(data.printify, "request")
    await expect(readCheckoutItems(data.printify, data.request, data.reserve)).rejects.toMatchObject({
      code: "CHECKOUT_RATE_LIMITED",
    })
    expect(readPublishedProduct).toHaveBeenCalled()
    expect(provider).not.toHaveBeenCalled()
  })

  it("rejects a disabled store before provider reads or payment", async () => {
    const data = fixture()
    publishingConfig.PRINTIFY_PUBLISHING_ENABLED = false
    const request = vi.spyOn(data.printify, "request")
    await expect(readCheckoutItems(data.printify, data.request, data.reserve)).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    })
    expect(request).not.toHaveBeenCalled()
    expect(data.reserve).not.toHaveBeenCalled()
  })

  it("rejects unpublished products before contacting Printify", async () => {
    const data = fixture()
    data.request.items[0]!.productId = "000000000000000000000000"
    const request = vi.spyOn(data.printify, "request")
    await expect(readCheckoutItems(data.printify, data.request, data.reserve)).rejects.toMatchObject({
      code: "PRODUCT_UNAVAILABLE",
    })
    expect(request).not.toHaveBeenCalled()
    expect(data.reserve).not.toHaveBeenCalled()
  })

  it("uses published membership and listing values while keeping draft listing edits private", async () => {
    publishingConfig.PRINTIFY_PUBLISHING_ENABLED = true
    const data = fixture()
    data.product.id = "new-published-product"
    data.request.items[0]!.productId = data.product.id
    data.product.variants[0]!.is_available = false
    vi.mocked(readPublishedProduct).mockResolvedValue(structuredClone(data.product))
    data.product.title = "Unpublished rename"
    data.product.images[0]!.src = "https://images.printify.com/unpublished-photo.jpg"
    data.product.variants[0]!.price = 0
    data.product.variants[0]!.is_available = true
    data.product.options[0]!.values[0]!.title = "Unpublished size label"
    data.product.print_areas[0]!.placeholders[0]!.images[0]!.imageId = "response-b"
    const providerRead = vi.spyOn(data.printify, "request").mockResolvedValueOnce(data.product)
    const quote = await readCheckoutItems(data.printify, data.request, data.reserve)
    expect(quote).toMatchObject([
      {
        title: "Toast",
        variantLabel: "M",
        unitAmount: 3000,
        imageUrl: "https://images.printify.com/forest-front.jpg",
      },
    ])
    expect(readPublishedProduct).toHaveBeenCalledExactlyOnceWith("new-published-product")
    expect(providerRead).toHaveBeenCalledTimes(1)
  })

  it("does not fill a missing published photo with an unpublished draft photo", async () => {
    publishingConfig.PRINTIFY_PUBLISHING_ENABLED = true
    const data = fixture()
    vi.mocked(readPublishedProduct).mockResolvedValue({ ...data.product, images: [] })
    vi.spyOn(data.printify, "request").mockResolvedValueOnce(data.product)

    const quote = await readCheckoutItems(data.printify, data.request, data.reserve)

    expect(quote[0]).not.toHaveProperty("imageUrl")
  })

  it("uses the store photo in a new Stripe order and omits stale curated images without changing production eligibility", async () => {
    const snapshot = galleryProductFixture()
    const host = "galleryfixtures.public.blob.vercel-storage.com"
    const src = `https://${host}/published-product-photos/v1/${"b".repeat(64)}.jpg`
    const active = {
      version: 1,
      coverColor: "10",
      colors: [
        {
          colorKey: "10",
          reviewedBinding: readGallerySource(snapshot, "1").colors[0]!.binding,
          entries: [
            {
              source: "store",
              assetId: "e3a4e34c-cb28-442e-8741-bef56b70b97d",
              publicUrl: src,
              alt: "Black tee",
              role: "other",
            },
          ],
        },
      ],
    }
    const client = new PrintifyClient({ apiToken: "test-secret-not-real", shopId: "123" })
    vi.spyOn(client, "request").mockImplementation(async () => structuredClone(snapshot))
    const reserve = vi.fn<(count: number) => Promise<void>>().mockResolvedValue(undefined)
    const request = { items: [{ productId: "shirt", variantId: 101, expectedUnitAmount: 3300, quantity: 1 }] }
    vi.mocked(readPublishedProduct).mockResolvedValue(
      resolveProductGallery({ snapshot, active, revision: "1", blobHost: host }).snapshot
    )
    expect((await readCheckoutItems(client, request, reserve))[0]).toMatchObject({
      imageUrl: src,
      unitAmount: 3300,
      variantId: 101,
    })

    snapshot.print_areas[0]!.placeholders[0]!.images[0]!.y = 0.9
    vi.mocked(readPublishedProduct).mockResolvedValue(
      resolveProductGallery({ snapshot, active, revision: "2", blobHost: host }).snapshot
    )
    const [item] = await readCheckoutItems(client, request, reserve)
    expect(item).not.toHaveProperty("imageUrl")
    expect(item).toMatchObject({ unitAmount: 3300, variantId: 101 })
    expect(reserve.mock.calls).toEqual([[1], [1]])
  })

  it.each([
    { country: "Honduras", canvas: false },
    { country: "Nicaragua", canvas: true },
    { country: null, canvas: null },
    { country: 123, canvas: "unused" },
    { country: { origin: "Nicaragua" }, canvas: [] },
  ])("reads a published snapshot despite unrelated provider fields: %j", async (fields) => {
    publishingConfig.PRINTIFY_PUBLISHING_ENABLED = true
    const data = fixture()
    const published = structuredClone(data.product)
    vi.mocked(readPublishedProduct).mockResolvedValue(published)
    Object.assign(data.product.print_areas[0]!, fields)
    const request = vi.spyOn(data.printify, "request").mockResolvedValueOnce(data.product)

    expect(await readCheckoutItems(data.printify, data.request, data.reserve)).toMatchObject([
      { title: "Toast", variantLabel: "M", unitAmount: 3000, quantity: 2 },
    ])
    expect(request).toHaveBeenCalledTimes(1)
    expect(published.print_areas[0]).not.toHaveProperty("country")
    expect(published.print_areas[0]).not.toHaveProperty("canvas")
  })

  it("still blocks changed placement alongside ignored provider fields before quoting shipping", async () => {
    publishingConfig.PRINTIFY_PUBLISHING_ENABLED = true
    const data = fixture()
    vi.mocked(readPublishedProduct).mockResolvedValue(structuredClone(data.product))
    Object.assign(data.product.print_areas[0]!, { country: "Honduras", canvas: false })
    data.product.print_areas[0]!.placeholders[0]!.images[0]!.x = 0.6
    const request = vi.spyOn(data.printify, "request").mockResolvedValue(data.product)

    await expect(readCheckoutItems(data.printify, data.request, data.reserve)).rejects.toMatchObject({
      code: "PRODUCT_CHANGED",
    })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it("keeps an unchanged published size available after a sibling color is added to the draft", async () => {
    publishingConfig.PRINTIFY_PUBLISHING_ENABLED = true
    const data = fixture()
    vi.mocked(readPublishedProduct).mockResolvedValue(structuredClone(data.product))
    data.product.variants.push({ ...data.product.variants[0]!, id: 102, options: [2] })
    data.product.print_areas[0]!.variant_ids.unshift(102)
    const request = vi.spyOn(data.printify, "request").mockResolvedValueOnce(data.product)
    expect(await readCheckoutItems(data.printify, data.request, data.reserve)).toMatchObject([
      { unitAmount: 3000, quantity: 2 },
    ])
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each(["published-disabled", "published-price", "live-disabled", "live-stock", "live-artwork", "live-provider"])(
    "blocks %s changes before quoting shipping",
    async (change) => {
      publishingConfig.PRINTIFY_PUBLISHING_ENABLED = true
      const data = fixture()
      const published = structuredClone(data.product)
      if (change === "published-disabled") published.variants[0]!.is_enabled = false
      if (change === "published-price") published.variants[0]!.price = 3200
      if (change === "live-stock") data.product.variants[0]!.is_available = false
      if (change === "live-disabled") data.product.variants[0]!.is_enabled = false
      if (change === "live-artwork") data.product.print_areas[0]!.placeholders[0]!.images[0]!.id = "different-art"
      if (change === "live-provider") data.product.print_provider_id = 11
      vi.mocked(readPublishedProduct).mockResolvedValue(published)
      const request = vi.spyOn(data.printify, "request").mockResolvedValue(data.product)
      await expect(readCheckoutItems(data.printify, data.request, data.reserve)).rejects.toMatchObject({
        code:
          change === "published-price"
            ? "PRICE_CHANGED"
            : change === "live-artwork" || change === "live-provider"
              ? "PRODUCT_CHANGED"
              : "PRODUCT_UNAVAILABLE",
      })
      expect(request).toHaveBeenCalledTimes(change.startsWith("published-") ? 0 : 1)
    }
  )

  it.each([0, -1, 1.5, 11, 999])("rejects invalid quantity %s", (quantity) => {
    const data = fixture()
    data.request.items[0]!.quantity = quantity
    expect(hostedCheckoutRequestSchema.safeParse(data.request).success).toBe(false)
  })

  it("rejects client-added price and address fields", () => {
    const { request } = fixture()
    expect(hostedCheckoutRequestSchema.safeParse({ ...request, total: 1 }).success).toBe(false)
    expect(hostedCheckoutRequestSchema.safeParse({ ...request, shippingAddress: { country: "CA" } }).success).toBe(
      false
    )
  })
})
