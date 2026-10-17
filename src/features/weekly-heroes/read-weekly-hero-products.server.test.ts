import { beforeEach, expect, it, vi } from "vitest"
import { readWeeklyHeroProducts } from "./read-weekly-hero-products.server"

const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/features/catalog/read-storefront-product.server", () => ({ readStorefrontProduct: mocks.read }))

beforeEach(() => mocks.read.mockReset())

it("uses the published front photo for the pictured color, including temporarily sold-out colors", async () => {
  mocks.read.mockResolvedValue({
    id: "sample-crop",
    shop_id: 123,
    title: "Sample Collection - Festival Crop Top",
    variants: [
      { id: 1, price: 2500, is_enabled: true, options: [10] },
      { id: 2, price: 2500, is_enabled: true, is_available: false, options: [20] },
    ],
    options: [
      {
        name: "Colors",
        type: "color",
        values: [
          { id: 10, title: "Green" },
          { id: 20, title: "Black" },
        ],
      },
    ],
    images: [
      { src: "https://cdn.example/green.webp", variant_ids: [1], is_default: true, view_key: "front" },
      { src: "https://cdn.example/black-person.webp", variant_ids: [2], view_key: "person-front" },
      { src: "https://cdn.example/black-front.webp", variant_ids: [2], view_key: "front" },
    ],
  })
  const [product] = await readWeeklyHeroProducts([{ productId: "sample-crop", color: "Black" }])
  expect(product).toMatchObject({
    title: "Sample Collection - Festival Crop Top",
    color: "Black",
    href: "/shop/sample-crop?color=Black",
    image: { src: "https://cdn.example/black-front.webp", alt: "Sample Collection - Festival Crop Top in Black" },
  })
  expect((await readWeeklyHeroProducts([{ productId: "sample-crop", color: "Pink" }]))[0]?.image).toBeNull()
})

it("does not expose draft, hidden, future or unreadable product data when the public reader withholds it", async () => {
  mocks.read.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("unavailable"))
  expect(await readWeeklyHeroProducts([{ productId: "hidden" }, { productId: "unreadable" }])).toEqual([])
})
