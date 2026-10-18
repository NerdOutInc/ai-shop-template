// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { galleryProductFixture } from "../../../test/gallery-product-fixture"
import { readGallerySource } from "./read-gallery-source.server"
import { resolveProductGallery } from "./resolve-product-gallery.server"
import type { GalleryManifest } from "./gallery-manifest-schema"
import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"
vi.mock("server-only", () => ({}))
const host = "galleryfixtures.public.blob.vercel-storage.com",
  photo = `https://${host}/published-product-photos/v1/${"b".repeat(64)}.jpg`
function fixture() {
  const snapshot = galleryProductFixture()
  const manifest: GalleryManifest = {
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
            publicUrl: photo,
            alt: "A model wears the black tee",
            role: "female-lifestyle",
            viewKey: "front",
          },
        ],
      },
    ],
  }
  return { snapshot, active: manifest, revision: "1", blobHost: host }
}
describe("approved product photo resolution", () => {
  it("preserves an untouched provider color's Primary even when it is not the first photo", () => {
    const input = fixture()
    input.snapshot.images.unshift({
      ...input.snapshot.images[0]!,
      src: `https://${host}/published-mockups/v1/${"c".repeat(64)}.jpg`,
      is_default: false,
    })
    const primary = input.snapshot.images[1]!.src
    for (const active of [
      { version: 1 as const, coverColor: null, colors: [] },
      {
        ...input.active,
        coverColor: null,
        colors: [
          {
            ...input.active.colors[0]!,
            colorKey: "20",
            reviewedBinding: readGallerySource(input.snapshot, "1").colors[1]!.binding,
          },
        ],
      },
    ]) {
      const result = resolveProductGallery({ ...input, active })
      expect(normalizeCatalogProduct(result.snapshot).image?.src).toBe(primary)
      expect(
        parsePrintifyProduct(result.snapshot, { shopId: "123", productId: "shirt" })?.variants.find((v) => v.id === 101)
          ?.imageUrl
      ).toBe(primary)
    }
  })
  it("retains an untouched color's primary when a shared primary becomes another color's curated cover", () => {
    const input = fixture()
    const primary = input.snapshot.images[0]!.src
    input.snapshot.images.unshift({
      ...input.snapshot.images[0]!,
      src: `https://${host}/published-mockups/v1/${"c".repeat(64)}.jpg`,
      variant_ids: [201],
      is_default: false,
    })
    const result = resolveProductGallery(input)
    expect(
      normalizeCatalogProduct(result.snapshot).images.filter((image) => image.variantIds.includes(201))[0]?.src
    ).toBe(primary)
    expect(
      parsePrintifyProduct(result.snapshot, { shopId: "123", productId: "shirt" })?.variants.find(
        (variant) => variant.id === 201
      )?.imageUrl
    ).toBe(primary)
  })
  it("keeps shared provider photos out of curated colors and preserves the cover, alt and print identity", () => {
    const input = fixture(),
      result = resolveProductGallery(input),
      catalog = normalizeCatalogProduct(result.snapshot)
    expect(catalog.images.map((i) => ({ src: i.src, ids: i.variantIds }))).toEqual([
      { src: photo, ids: [101] },
      { src: input.snapshot.images[0]!.src, ids: [201] },
    ])
    expect(catalog.image).toMatchObject({ src: photo, viewKey: "front" })
    expect((result.snapshot.images as Record<string, unknown>[]).find((image) => image.src === photo)).toEqual({
      src: photo,
      variant_ids: [101],
      is_default: true,
      alt: "A model wears the black tee",
      view_key: "front",
      origin: "store",
    })
    expect((result.snapshot.images as { is_default: boolean }[]).filter((i) => i.is_default)).toHaveLength(1)
    expect(parsePrintifyProduct(result.snapshot, { shopId: "123", productId: "shirt" })?.variants[0]?.fingerprint).toBe(
      parsePrintifyProduct(input.snapshot, { shopId: "123", productId: "shirt" })?.variants[0]?.fingerprint
    )
  })
  it("withholds changed designs without reviving the shared mockup", () => {
    const input = fixture()
    input.snapshot.print_areas[0]!.placeholders[0]!.images[0]!.y = 0.8
    const result = resolveProductGallery(input)
    expect(result.staleColors).toEqual(["10"])
    expect(normalizeCatalogProduct(result.snapshot).images.flatMap((i) => i.variantIds)).toEqual([201])
    expect(result.withheldVariantIds).toEqual([101])
  })
  it("contains an unavailable entry to its curated color without reviving removed provider photos", () => {
    const input = fixture()
    Object.assign(input.active.colors[0]!.entries[0]!, {
      publicUrl:
        "https://previous.public.blob.vercel-storage.com/published-product-photos/v1/" + "b".repeat(64) + ".jpg",
    })
    const result = resolveProductGallery(input)
    expect(result.invalidColors).toEqual(["10"])
    expect(result.withheldVariantIds).toEqual([101])
    expect(result.diagnostic).toContain("unavailable photos")
    expect(normalizeCatalogProduct(result.snapshot).images).toEqual([
      expect.objectContaining({ src: input.snapshot.images[0]!.src, variantIds: [201] }),
    ])
  })
  it("keeps price changes and added sizes with the same print current", () => {
    const input = fixture()
    input.snapshot.variants[0]!.price = 3500
    input.snapshot.variants.push({ ...input.snapshot.variants[0]!, id: 102, options: [10, 102] })
    input.snapshot.print_areas[0]!.variant_ids.push(102)
    expect(resolveProductGallery(input).staleColors).toEqual([])
    expect(normalizeCatalogProduct(resolveProductGallery(input).snapshot).images[0]?.variantIds).toEqual([101, 102])
  })
  it("recomputes historical evidence after a fingerprint algorithm upgrade, never trusting the old digest", () => {
    const input = fixture(),
      historical = structuredClone(input.snapshot)
    input.active.colors[0]!.reviewedBinding = { version: "gallery-v1/old", digest: "f".repeat(64), sourceRevision: "1" }
    expect(resolveProductGallery({ ...input, history: { "1": historical } }).staleColors).toEqual([])
    input.snapshot.print_areas[0]!.placeholders[0]!.images[0]!.scale = 0.5
    expect(resolveProductGallery({ ...input, history: { "1": historical } }).staleColors).toEqual(["10"])
    expect(resolveProductGallery(input).staleColors).toEqual(["10"])
  })
  it("fails closed for malformed active galleries, but a draft-only row remains provider-driven", () => {
    const input = fixture()
    expect(
      normalizeCatalogProduct(resolveProductGallery({ ...input, active: { broken: true } }).snapshot).images
    ).toEqual([])
    expect(resolveProductGallery({ ...input, active: null }).snapshot.images).toEqual(input.snapshot.images)
    const forged = { ...input.snapshot, storefront_gallery_withheld_variants: [101, 201] }
    expect(resolveProductGallery({ ...input, snapshot: forged, active: null }).snapshot).not.toHaveProperty(
      "storefront_gallery_withheld_variants"
    )
  })
})
