import { expect, it } from "vitest"
import { weeklyHeroSchema } from "./weekly-hero-schema"

const destination = (index: number) => ({
  productId: `product-${index}`,
  color: "",
  label: `Shop product ${index}`,
  desktop: { x: 26 + index * 8, y: 10, width: 7, height: 70 },
  mobile: { x: 1, y: 1 + index * 16, width: 98, height: 15 },
})
const manifest = {
  title: "Sample collection",
  alt: "A collection of apparel on a neutral background",
  offer: "",
  desktopAssetId: "11111111-1111-4111-8111-111111111111",
  mobileAssetId: "22222222-2222-4222-8222-222222222222",
  links: [destination(0)],
}
it("accepts one through six destinations without requiring a price claim or particular garment", () => {
  for (let count = 1; count <= 6; count++)
    expect(
      weeklyHeroSchema.safeParse({ ...manifest, links: Array.from({ length: count }, (_, i) => destination(i)) })
        .success
    ).toBe(true)
})
it("rejects duplicate, overlapping, out-of-frame or desktop-cropped destinations", () => {
  for (const links of [
    [],
    [destination(0), destination(0)],
    [destination(0), { ...destination(1), mobile: destination(0).mobile }],
    [{ ...destination(0), desktop: { x: 20, y: 10, width: 7, height: 70 } }],
    [{ ...destination(0), mobile: { x: 80, y: 10, width: 40, height: 70 } }],
  ])
    expect(weeklyHeroSchema.safeParse({ ...manifest, links }).success).toBe(false)
})

it("canonicalizes UUID casing before persistence and hydration", () => {
  const id = "ABCDEF12-ABCD-4ABC-8ABC-ABCDEF123456"
  const result = weeklyHeroSchema.parse({ ...manifest, desktopAssetId: id, mobileAssetId: id })
  expect(result.desktopAssetId).toBe(id.toLowerCase())
  expect(result.mobileAssetId).toBe(id.toLowerCase())
})
