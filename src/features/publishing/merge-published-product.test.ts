import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import type { PublishingEvent } from "./publishing-event"

import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import { mergePublishedProduct } from "./merge-published-product"
import { publishingSourceFingerprint } from "./publishing-source-fingerprint"

vi.mock("server-only", () => ({}))

describe("published revisions", () => {
  it("retains app-owned Google copy across partial publication and excludes provider-supplied overrides", () => {
    const { event, product } = publishingFixture()
    const copy = { version: 1, content: "Approved", origin: "generated" }
    const previous = { ...mergePublishedProduct(event, product, null), google_merchant_copy: copy }
    for (const publishDetails of [{ title: true }, { description: true }, { images: true }, { variants: true }]) {
      expect(
        mergePublishedProduct(
          { ...event, publishDetails },
          { ...product, google_merchant_copy: { content: "Draft override" } },
          previous
        ).google_merchant_copy
      ).toEqual(copy)
    }
    expect(
      mergePublishedProduct(event, { ...product, google_merchant_copy: copy }, null).google_merchant_copy
    ).toBeUndefined()
  })

  it("pins artwork through metadata publication but clears it before publishing another production design", () => {
    const { event, product } = publishingFixture()
    const artwork = {
      src: `https://catalog.public.blob.vercel-storage.com/published-artwork/v1/${"a".repeat(64)}.webp`,
      revisionId: "34d7df72-f329-45f9-acd5-faa4a0c10e25",
      productionFingerprint: `artwork-v1:${"b".repeat(64)}`,
      width: 960,
      height: 1200,
    }
    const previous = {
      ...mergePublishedProduct(event, product, null),
      storefront_artwork_enabled: true,
      storefront_artwork: artwork,
    }
    const metadata = mergePublishedProduct(
      { ...event, publishDetails: { title: true } },
      { ...product, title: "New title" },
      previous
    )
    expect(metadata.storefront_artwork).toEqual(artwork)
    const changed = structuredClone(product)
    changed.print_areas[0]!.placeholders[0]!.images[0]!.id = "draft-B"
    const next = mergePublishedProduct({ ...event, publishDetails: { images: true } }, changed, previous)
    expect(next.storefront_artwork).toBeUndefined()
    expect(next.storefront_artwork_enabled).toBe(false)
    expect(previous.storefront_artwork).toEqual(artwork)
  })

  it("publishes the Primary mockup and its matching default color together", () => {
    const { event, product } = publishingFixture()
    const before = mergePublishedProduct(event, product, null)
    expect(normalizeCatalogProduct(before)).toMatchObject({
      defaultColor: "Forest",
      image: { src: product.images[1]!.src },
    })
    const live = structuredClone(product)
    live.images[0]!.is_default = true
    live.images[1]!.is_default = false
    const after = mergePublishedProduct({ ...event, action: "update", publishDetails: { images: true } }, live, before)
    expect(normalizeCatalogProduct(after)).toMatchObject({
      defaultColor: "Grey",
      image: { src: product.images[0]!.src },
    })
    expect(normalizeCatalogProduct(before).defaultColor).toBe("Forest")
  })

  it("applies only selected fields while preserving the old listing and price", () => {
    const { event, product } = publishingFixture()
    const before = mergePublishedProduct(event, product, null)
    const live = structuredClone(product)
    live.title = "Unpublished title"
    live.description = "Published description"
    live.variants[0]!.price = 9999
    live.images.reverse()
    const after = mergePublishedProduct(
      { ...event, action: "update", publishDetails: { description: true } },
      live,
      before
    )
    expect(after).toMatchObject({
      title: "Toast",
      description: "Published description",
      variants: [{ price: 3000 }, { price: 3200 }],
      images: product.images,
    })
  })

  it.each([
    { country: "Honduras", canvas: false },
    { country: "Nicaragua", canvas: true },
    { country: null, canvas: null },
    { country: 123, canvas: "unused" },
    { country: { origin: "Nicaragua" }, canvas: [] },
  ])("publishes metadata while ignoring non-production provider fields: %j", (fields) => {
    const { event, product } = publishingFixture()
    const before = { ...mergePublishedProduct(event, product, null), storefront_artwork_enabled: true }
    const live = structuredClone(product)
    Object.assign(live.print_areas[0]!, fields)
    expect(publishingSourceFingerprint(live, event)).toBe(publishingSourceFingerprint(product, event))
    live.description = "Updated description with the complete size chart"

    const after = mergePublishedProduct(
      { ...event, action: "update", publishDetails: { description: true } },
      live,
      before
    )

    expect(after).toEqual({ ...before, description: live.description, print_areas: live.print_areas })
    expect(before).toHaveProperty("print_areas", product.print_areas)
  })

  it("still requires matching images for changed artwork alongside ignored provider fields", () => {
    const { event, product } = publishingFixture()
    const before = { ...mergePublishedProduct(event, product, null), storefront_artwork_enabled: true }
    const live = structuredClone(product)
    Object.assign(live.print_areas[0]!, { country: "Honduras", canvas: false })
    live.print_areas[0]!.placeholders[0]!.images[0]!.id = "changed-artwork"
    live.description = "Updated description"

    expect(() =>
      mergePublishedProduct({ ...event, action: "update", publishDetails: { description: true } }, live, before)
    ).toThrow("DESIGN_CHANGE_REQUIRES_IMAGES")
    expect(before.storefront_artwork_enabled).toBe(true)
  })

  it("requires images when the printable design changes", () => {
    const { event, product } = publishingFixture()
    const before = mergePublishedProduct(event, product, null)
    const live = structuredClone(product)
    live.print_areas[0]!.placeholders[0]!.images[0]!.id = "art-v2"
    expect(() => mergePublishedProduct({ ...event, publishDetails: { title: true } }, live, before)).toThrow(
      "DESIGN_CHANGE_REQUIRES_IMAGES"
    )
    expect(() => mergePublishedProduct({ ...event, publishDetails: { images: true } }, live, before)).not.toThrow()
  })

  it("hides and restores only visibility, even when the saved design draft is unpublishable", () => {
    const { event, product } = publishingFixture()
    const before = {
      ...mergePublishedProduct(event, product, null),
      storefront_artwork_enabled: true,
      google_merchant_copy: { origin: "generated", content: "Approved" },
    }
    const visibilityEvent: PublishingEvent = {
      ...event,
      action: "update",
      publishDetails: { title: false, description: false, images: false, variants: false },
    }
    const draft = {
      ...product,
      title: "PRIVATE DRAFT",
      print_areas: [{ unsupported_design_control: "private" }],
      variants: undefined,
      images: [],
      visible: false,
    }
    const hidden = mergePublishedProduct(visibilityEvent, draft, before)
    expect(hidden).toEqual({ ...before, visible: false })
    const shown = mergePublishedProduct(visibilityEvent, { ...draft, visible: true }, hidden)
    expect(shown).toEqual(before)
    expect(() => mergePublishedProduct(visibilityEvent, draft, null)).toThrow("FIRST_PUBLISH_FIELDS_REQUIRED")
    expect(() => mergePublishedProduct(event, draft, before)).toThrow("INVALID_PRODUCT")
  })

  it.each([undefined, null, "false", 0])("requires an explicit boolean for a visibility-only update: %s", (visible) => {
    const { event, product } = publishingFixture()
    const before = mergePublishedProduct(event, product, null)
    expect(() =>
      mergePublishedProduct({ ...event, action: "update", publishDetails: {} }, { ...product, visible }, before)
    ).toThrow()
  })

  it("rejects malformed provider visibility while handling an omitted visibility flag", () => {
    const { event, product } = publishingFixture()
    expect(mergePublishedProduct(event, product, null).visible).toBe(true)
    expect(mergePublishedProduct(event, { ...product, visible: undefined }, null).visible).toBe(true)
    expect(mergePublishedProduct(event, { ...product, visible: false }, null).visible).toBe(false)
    for (const visible of [null, "false", 0]) {
      expect(() => mergePublishedProduct(event, { ...product, visible }, null)).toThrow("INVALID_VISIBILITY")
      expect(() => publishingSourceFingerprint({ ...product, visible }, event)).toThrow("INVALID_VISIBILITY")
    }
  })

  it("fingerprints visibility independently from an invalid draft, while binding identity, state, and timestamp", () => {
    const { event, product } = publishingFixture()
    const raw = { ...product, visible: false, updated_at: "2026-09-09T12:00:00Z", variants: undefined }
    const hash = publishingSourceFingerprint(raw, event, true)
    expect(hash).toMatch(/^visibility-v1:[a-f0-9]{64}$/)
    expect(publishingSourceFingerprint({ ...raw, title: "New draft" }, event, true)).toBe(hash)
    expect(publishingSourceFingerprint(raw, { productId: event.productId, shopId: event.shopId }, true)).toBe(hash)
    expect(publishingSourceFingerprint({ ...raw, visible: true }, event, true)).not.toBe(hash)
    expect(publishingSourceFingerprint({ ...raw, updated_at: "2026-09-09T12:00:01Z" }, event, true)).not.toBe(hash)
    expect(() => publishingSourceFingerprint(raw, event)).toThrow("INVALID_PRODUCT")
    expect(() => publishingSourceFingerprint({ ...raw, id: "other-product" }, event, true)).toThrow("INVALID_PRODUCT")
    expect(() => publishingSourceFingerprint({ ...raw, shop_id: 456 }, event, true)).toThrow("INVALID_PRODUCT")
    expect(() => publishingSourceFingerprint({ ...raw, visible: undefined }, event, true)).toThrow("INVALID_PRODUCT")
    expect(publishingSourceFingerprint({ ...product, visible: true }, event)).not.toBe(
      publishingSourceFingerprint({ ...product, visible: false }, event)
    )
  })

  it("publishes a same-art sibling variant without requiring images or disabling approved local artwork", () => {
    const { event, product } = publishingFixture()
    product.variants[1]!.is_enabled = false
    product.print_areas[0]!.variant_ids = [101]
    const before = { ...mergePublishedProduct(event, product, null), storefront_artwork_enabled: true }
    const live = structuredClone(product)
    live.variants[1]!.is_enabled = true
    live.print_areas[0]!.variant_ids = [102, 101]
    const after = mergePublishedProduct(
      { ...event, action: "update", publishDetails: { variants: true } },
      live,
      before
    )
    expect(after.storefront_artwork_enabled).toBe(true)
    expect(normalizeCatalogProduct(after).variants).toHaveLength(2)
  })

  it("requires matching mockups and disables old local artwork for a newly enabled variant with different artwork", () => {
    const { event, product } = publishingFixture()
    product.variants[1]!.is_enabled = false
    product.print_areas[0]!.variant_ids = [101]
    const before = { ...mergePublishedProduct(event, product, null), storefront_artwork_enabled: true }
    const live = structuredClone(product)
    live.variants[1]!.is_enabled = true
    const newArea = structuredClone(live.print_areas[0]!)
    newArea.variant_ids = [102]
    newArea.placeholders[0]!.images[0]!.id = "new-color-specific-artwork"
    live.print_areas.push(newArea)
    expect(() => mergePublishedProduct({ ...event, publishDetails: { variants: true } }, live, before)).toThrow(
      "DESIGN_CHANGE_REQUIRES_IMAGES"
    )
    expect(
      mergePublishedProduct({ ...event, publishDetails: { variants: true, images: true } }, live, before)
        .storefront_artwork_enabled
    ).toBe(false)
  })

  it("does not restore old local artwork after an unpublish and new publication", () => {
    const { event, product } = publishingFixture()
    expect(mergePublishedProduct(event, product, null).storefront_artwork_enabled).toBe(false)
    const previous = { ...product, storefront_artwork_enabled: false }
    expect(mergePublishedProduct(event, product, previous).storefront_artwork_enabled).toBe(false)
  })

  it("requires the variant update when the provider changes variant identifiers", () => {
    const { event, product } = publishingFixture()
    const before = mergePublishedProduct(event, product, null)
    const live = structuredClone(product)
    live.variants[0]!.sku = "different"
    expect(() => mergePublishedProduct({ ...event, publishDetails: { images: true } }, live, before)).toThrow(
      "PUBLISH_VARIANTS_REQUIRED"
    )
  })

  it("requires initial listing fields and a usable enabled mockup", () => {
    const { event, product } = publishingFixture()
    expect(() => mergePublishedProduct({ ...event, publishDetails: { title: true } }, product, null)).toThrow(
      "FIRST_PUBLISH_FIELDS_REQUIRED"
    )
    expect(() => mergePublishedProduct(event, { ...product, images: [] }, null)).toThrow("NO_USABLE_MOCKUP")
  })

  it("excludes deselected mockups and rejects an entirely deselected gallery", () => {
    const { event, product } = publishingFixture()
    const candidate = {
      ...product,
      images: product.images.map((image, index) => ({ ...image, is_selected_for_publishing: index === 0 })),
    }
    expect(normalizeCatalogProduct(mergePublishedProduct(event, candidate, null))).toMatchObject({
      defaultColor: "Grey",
      images: [{ src: product.images[0]!.src }],
    })
    candidate.images[0]!.is_selected_for_publishing = false
    expect(() => mergePublishedProduct(event, candidate, null)).toThrow("NO_USABLE_MOCKUP")
  })

  it("guards callback generation while ignoring transient IDs and live stock", () => {
    const { event, product } = publishingFixture()
    const hash = publishingSourceFingerprint(product, event)
    const live = structuredClone(product)
    live.print_areas[0]!.placeholders[0]!.images[0]!.imageId = "volatile-b"
    live.variants[0]!.is_available = false
    expect(publishingSourceFingerprint(live, event)).toBe(hash)
    live.images[0]!.is_default = true
    expect(publishingSourceFingerprint(live, event)).not.toBe(hash)
  })
})

function publishingFixture() {
  const productId = randomUUID()
  const event: PublishingEvent = {
    id: randomUUID(),
    productId,
    shopId: "123",
    createdAt: new Date().toISOString(),
    action: "create",
    publishDetails: { title: true, description: true, images: true, variants: true },
  }
  const product = {
    id: productId,
    shop_id: 123,
    title: "Toast",
    description: "Good company",
    is_locked: true,
    visible: true,
    blueprint_id: 1317,
    print_provider_id: 99,
    created_at: "2026-09-01T12:00:00Z",
    print_areas: [
      {
        variant_ids: [101, 102],
        placeholders: [
          { position: "front", images: [{ id: "art-v1", imageId: "volatile-a", x: 0.5, y: 0.5, scale: 1, angle: 0 }] },
        ],
      },
    ],
    variants: [
      { id: 101, sku: "green-m", price: 3000, is_enabled: true, is_available: true, options: [1, 3] },
      { id: 102, sku: "grey-m", price: 3200, is_enabled: true, is_available: true, options: [2, 3] },
    ],
    options: [
      {
        name: "Colors",
        type: "color",
        values: [
          { id: 1, title: "Forest", colors: ["#254b41"] },
          { id: 2, title: "Grey", colors: ["#888888"] },
        ],
      },
      { name: "Sizes", type: "size", values: [{ id: 3, title: "M" }] },
    ],
    images: [
      { src: "https://images.printify.com/grey.png", variant_ids: [102], is_default: false },
      { src: "https://images.printify.com/forest.png", variant_ids: [101], is_default: true },
    ],
  }
  return { event, product }
}
