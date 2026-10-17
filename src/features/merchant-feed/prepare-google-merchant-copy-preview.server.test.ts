// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import { escapeMerchantXml } from "./escape-merchant-xml"
import { createMerchantFeed } from "./create-merchant-feed"
import { googleMerchantCopyReviewDigest } from "./google-merchant-copy-review-digest"
import { prepareMerchantProduct } from "./prepare-merchant-product.server"
import type { GoogleCopyEditorRead } from "./read-google-merchant-copy-editor.server"
import { validateGoogleCopyApproval } from "./validate-google-copy-approval"
import { prepareGoogleMerchantCopyPreview } from "./prepare-google-merchant-copy-preview.server"

vi.mock("server-only", () => ({}))
const profile = { googleProductCategory: 212, gender: "unisex", ageGroup: "adult", sizeSystem: "US" } as const
let read: GoogleCopyEditorRead
const input = {
  expectedRevision: "7",
  content: "Reviewed factual wording.",
  origin: "generated",
  variantIds: [11, 12],
} as const
function proposal(variantIds = [11, 12], content: string = input.content, origin: "generated" | "human" = "generated") {
  return prepareGoogleMerchantCopyPreview(read, { ...input, content, origin, variantIds }).preview!
}
function items(xml: string) {
  return new Map(
    [...xml.matchAll(/<item>(.*?)<\/item>/gs)].map((match) => [match[1]!.match(/<g:id>(.*?)<\/g:id>/)![1], match[1]])
  )
}
beforeEach(() => {
  read = {
    shopId: "123",
    productId: "tee",
    revision: "7",
    active: true,
    blocked: false,
    provenance: "unknown",
    profiles: new Map([[1317, profile]]),
    snapshot: {
      id: "tee",
      shop_id: 123,
      title: "Graphic tee",
      description: "Published storefront story.",
      visible: true,
      blueprint_id: 1317,
      print_provider_id: 99,
      variants: [
        { id: 11, price: 2000, options: [1, 3], is_enabled: true, is_available: true },
        { id: 12, price: 2200, options: [1, 4], is_enabled: true, is_available: true },
        { id: 13, price: 2200, options: [2, 3], is_enabled: true, is_available: false },
        { id: 14, price: 2200, options: [2, 4], is_enabled: true, is_available: true },
      ],
      options: [
        {
          name: "Colors",
          type: "color",
          values: [
            { id: 1, title: "Navy" },
            { id: 2, title: "Blue" },
          ],
        },
        {
          name: "Sizes",
          type: "size",
          values: [
            { id: 3, title: "M" },
            { id: 4, title: "L" },
          ],
        },
      ],
      images: [{ src: "https://images.example/tee.jpg", variant_ids: [11, 12, 13, 14], is_default: true }],
      print_areas: [
        {
          variant_ids: [11, 12, 13, 14],
          placeholders: [{ position: "front", images: [{ id: "art", x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
        },
      ],
      custom: { retained: true },
    },
  }
})

describe("Google copy preparation", () => {
  it("starts blank and unchecked, with no generated or storefront seed", () => {
    expect(prepareGoogleMerchantCopyPreview(read).state).toMatchObject({ content: "", origin: null, savedCopy: null })
    expect(prepareGoogleMerchantCopyPreview(read).state.variants.every((v) => !v.selected)).toBe(true)
  })
  it("retains stale approved wording but only preselects exactly resolved identities", () => {
    const copy = proposal().copy
    read.snapshot!.google_merchant_copy = copy
    expect(
      prepareGoogleMerchantCopyPreview(read)
        .state.variants.filter((v) => v.selected)
        .map((v) => v.id)
    ).toEqual([11, 12])
    read.snapshot!.title = "Changed shared facts"
    const state = prepareGoogleMerchantCopyPreview(read).state
    expect(state.content).toBe(copy.content)
    expect(state.variants.every((v) => !v.selected)).toBe(true)
    expect(state.issues).toContainEqual({ code: "SHARED_FACTS_CHANGED" })
  })
  it("leaves changed, disabled, new and removed identities unchecked with reasons", () => {
    const copy = proposal().copy
    read.snapshot!.google_merchant_copy = copy
    const variants = read.snapshot!.variants as { id: number; is_enabled: boolean; options: number[] }[]
    variants[0]!.options = [2, 3]
    variants[1]!.is_enabled = false
    const state = prepareGoogleMerchantCopyPreview(read).state
    expect(state.variants.map((v) => [v.id, v.selected, v.reason])).toEqual([
      [11, false, "VARIANT_CHANGED"],
      [12, false, "DISABLED_VARIANT"],
      [13, false, "UNCOVERED_VARIANT"],
      [14, false, "UNCOVERED_VARIANT"],
    ])
    variants.splice(1, 1)
    expect(prepareGoogleMerchantCopyPreview(read).state.variants).toContainEqual(
      expect.objectContaining({ id: 12, selectable: false, reason: "REMOVED_VARIANT" })
    )
  })
  it("disables identities lacking usable color or size", () => {
    ;(read.snapshot!.options as { type: string }[])[0]!.type = "other"
    ;(read.snapshot!.options as { name: string }[])[0]!.name = "Other"
    expect(prepareGoogleMerchantCopyPreview(read).state.variants.every((v) => !v.selectable)).toBe(true)
    expect(() => proposal()).toThrow("GOOGLE_COPY_INVALID_SELECTION")
  })
  it.each([{ origin: "generated", unknown: "metadata" }, null, { version: 999 }])(
    "blocks malformed saved records without overwriting unknown metadata",
    (raw) => {
      read.snapshot!.google_merchant_copy = raw
      expect(prepareGoogleMerchantCopyPreview(read).state.blocked).toBe("GOOGLE_COPY_INVALID_RECORD")
      expect(() => proposal()).toThrow("GOOGLE_COPY_INVALID_RECORD")
      expect(read.snapshot!.google_merchant_copy).toBe(raw)
    }
  )
  it.each(["inactive", "pending", "missing", "profile", "snapshot"])("refuses unusable %s state", (kind) => {
    if (kind === "inactive") read.active = false
    if (kind === "pending") read.blocked = true
    if (kind === "missing") read.snapshot = null
    if (kind === "profile") read.profiles = new Map([[1317, { ...profile, gender: "invalid" } as never]])
    if (kind === "snapshot") read.snapshot!.shop_id = 999
    expect(prepareGoogleMerchantCopyPreview(read).state.blocked).not.toBeNull()
    expect(() => proposal()).toThrow(/^GOOGLE_COPY_/)
  })
  it("rejects stale revisions, empty coverage, duplicates and unknown variants", () => {
    expect(() => prepareGoogleMerchantCopyPreview(read, { ...input, variantIds: [11], expectedRevision: "6" })).toThrow(
      "GOOGLE_COPY_REVISION_CHANGED"
    )
    for (const ids of [[], [11, 11], [99]]) expect(() => proposal(ids)).toThrow("GOOGLE_COPY_INVALID_SELECTION")
  })
  it("locks raw and historical generated origins, including clear history", () => {
    read.provenance = "generated"
    expect(() => proposal([11], input.content, "human")).toThrow("GOOGLE_COPY_ORIGIN_DOWNGRADE")
    expect(prepareGoogleMerchantCopyPreview(read).state.originLocked).toBe(true)
    read.provenance = "unknown"
    read.snapshot!.google_merchant_copy = proposal().copy
    expect(() => proposal([11], "Human edit" as typeof input.content, "human")).toThrow("GOOGLE_COPY_ORIGIN_DOWNGRADE")
    expect(proposal([11], "Human edit" as typeof input.content).copy.origin).toBe("generated")
  })
  it("rejects human relabeling from incomplete history without inventing origin", () => {
    read.provenance = "incomplete"
    expect(prepareGoogleMerchantCopyPreview(read).state.origin).toBeNull()
    expect(() => proposal([11], input.content, "human")).toThrow("GOOGLE_COPY_PROVENANCE_INCOMPLETE")
    expect(proposal([11]).copy.origin).toBe("generated")
  })
  it("preserves optional metadata values and presence and blocks loss of material colors", () => {
    read.snapshot!.google_merchant_copy = {
      ...proposal([11, 13]).copy,
      pattern: "Graphic",
      materials: { Navy: "Verified cotton", Blue: "Verified blend" },
    }
    const copy = proposal([11, 13]).copy
    expect(copy).toMatchObject({ pattern: "Graphic", materials: { Navy: "Verified cotton", Blue: "Verified blend" } })
    expect(() => proposal([11])).toThrow("GOOGLE_COPY_METADATA_CONFLICT")
    expect(() =>
      prepareGoogleMerchantCopyPreview(read, { expectedRevision: "7", copy: { ...copy, pattern: "Tampered" } })
    ).toThrow("GOOGLE_COPY_METADATA_CONFLICT")
    const omitted = { ...copy }
    delete omitted.materials
    expect(() => prepareGoogleMerchantCopyPreview(read, { expectedRevision: "7", copy: omitted })).toThrow(
      "GOOGLE_COPY_METADATA_CONFLICT"
    )
    read.snapshot!.google_merchant_copy = { ...proposal([11, 13]).copy, materials: {} }
    expect(Object.hasOwn(proposal().copy, "materials")).toBe(true)
  })
  it.each(["", "\u0000", "\ud800", "x".repeat(5000), "😀".repeat(5000)])(
    "rejects invalid XML/Unicode/final length without truncation",
    (content) => {
      expect(() => proposal([11], content as typeof input.content)).toThrow("GOOGLE_COPY_INVALID_APPROVAL")
    }
  )
  it("accepts Unicode points within the final description limit and human wording with complete unknown history", () => {
    expect(proposal([11], "😀".repeat(4900) as typeof input.content, "human").descriptions[0]!.origin).toBe("human")
  })
  it("binds the canonical digest to shop, product, revision and every full copy field", () => {
    const copy = proposal().copy
    const digest = googleMerchantCopyReviewDigest("123", "tee", "7", copy)
    expect(googleMerchantCopyReviewDigest("123", "tee", "7", { ...copy })).toBe(digest)
    for (const args of [
      ["124", "tee", "7", copy],
      ["123", "other", "7", copy],
      ["123", "tee", "8", copy],
      ["123", "tee", "7", { ...copy, content: "changed" }],
    ] as const)
      expect(googleMerchantCopyReviewDigest(args[0], args[1], args[2], args[3])).not.toBe(digest)
    expect(googleMerchantCopyReviewDigest("123", "tee", "7", { ...copy, materials: {} })).not.toBe(digest)
  })
  it("previews the exact table-only published-description fallback", () => {
    read.snapshot!.description =
      '<table id="size-guide"><tr><td></td><td>S</td><td>M</td></tr><tr><td>Width, in</td><td>19.00</td><td>20.50</td></tr></table>'
    const preview = proposal([11])
    const fallback = preview.descriptions.find((d) => d.id === 14)!
    expect(fallback.content).toBe("Graphic tee\nSize guide\nWidth, in: S: 19.00; M: 20.50")
    const site = new URL("https://shop.example")
    const { merchantProduct } = prepareMerchantProduct(
      { ...read.snapshot!, google_merchant_copy: preview.copy },
      "123",
      site,
      read.profiles
    )
    expect(items(createMerchantFeed([merchantProduct], site)).get("tee-14")).toContain(
      escapeMerchantXml(fallback.content)
    )
  })
  it("matches the unchanged writer validator and emitted descriptions for a complete frozen group, preserving Meta, siblings, IDs/counts and storefront", () => {
    const baselineCopy = proposal([11, 12]).copy
    read.snapshot!.google_merchant_copy = baselineCopy
    const snapshot = structuredClone(read.snapshot!)
    const preview = proposal([12, 13], "Changed reviewed wording." as typeof input.content)
    const validated = validateGoogleCopyApproval(preview.copy, snapshot, "123", profile, "unknown")
    expect(validated.copy).toEqual(preview.copy)
    const site = new URL("https://shop.example")
    const before = prepareMerchantProduct(snapshot, "123", site, read.profiles).merchantProduct
    const updated = { ...snapshot, google_merchant_copy: preview.copy }
    const after = prepareMerchantProduct(updated, "123", site, read.profiles).merchantProduct
    const sibling = { ...before, product: { ...before.product, id: "sibling" } }
    const baselineXml = createMerchantFeed([before, sibling], site)
    const proposedXml = createMerchantFeed([after, sibling], site)
    expect(createMerchantFeed([before, sibling], site, "meta")).toBe(createMerchantFeed([after, sibling], site, "meta"))
    const oldItems = items(baselineXml),
      newItems = items(proposedXml)
    expect([...newItems.keys()]).toEqual([...oldItems.keys()])
    expect(newItems.size).toBe(8)
    expect(newItems.get("tee-14")).toBe(oldItems.get("tee-14"))
    for (const [id, item] of oldItems) {
      if (id?.startsWith("sibling-")) expect(newItems.get(id)).toBe(item)
    }
    for (const description of preview.descriptions) {
      expect(newItems.get(`tee-${description.id}`)).toContain(escapeMerchantXml(description.content))
      const omitCopy = (item: string) =>
        item.replace(/<g:(structured_description|description|pattern|material)>.*?<\/g:\1>/gs, "")
      expect(omitCopy(newItems.get(`tee-${description.id}`)!)).toBe(omitCopy(oldItems.get(`tee-${description.id}`)!))
    }
    expect(preview.descriptions.map((d) => [d.id, d.effect])).toEqual([
      [11, "removed"],
      [12, "retained"],
      [13, "added"],
      [14, "fallback"],
    ])
    expect(preview.descriptions[0]!.content).toBe("Published storefront story.")
    expect(normalizeCatalogProduct(updated)).toEqual(normalizeCatalogProduct(snapshot))
    expect(read.snapshot).toEqual(snapshot)
    const { google_merchant_copy: ignored, ...original } = snapshot
    const { google_merchant_copy: ignoredAfter, ...rest } = updated
    expect(ignored).toBeDefined()
    expect(ignoredAfter).toBeDefined()
    expect(rest).toEqual(original)
  })
})
