import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { readCatalogStock } from "@/features/catalog-sync/read-catalog-stock.server"
import type { GarmentFeedProfile } from "@/features/garment-catalog/garment-feed-profile-schema"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import { listShownProducts } from "@/features/publishing/list-shown-products.server"
import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"
import { getMerchantProducts } from "./get-merchant-products.server"
import { createMerchantFeed } from "./create-merchant-feed"
vi.mock("server-only", () => ({}))
vi.mock("@/features/publishing/get-publishing-store.server", () => ({ getPublishingStore: vi.fn() }))
vi.mock("@/features/publishing/list-shown-products.server", () => ({ listShownProducts: vi.fn() }))
vi.mock("@/features/catalog-sync/read-catalog-stock.server", () => ({ readCatalogStock: vi.fn() }))
const testEnv = vi.hoisted(() => ({
  NEXT_PUBLIC_SITE_URL: "https://example.com",
  PRINTIFY_PUBLISHING_ENABLED: true,
  DATABASE_URL: "postgresql://local/store" as string | undefined,
  PRINTIFY_SHOP_ID: "123" as string | undefined,
}))
vi.mock("@/lib/env", () => ({ env: testEnv }))
const fetchMock = vi.fn()
const listFeedProfiles = vi.fn()
function fixture(id = "shirt") {
  return {
    id,
    shop_id: 123,
    title: "Published tee",
    description: "Published illustration story",
    visible: true,
    blueprint_id: 1317,
    print_provider_id: 99,
    print_areas: [
      {
        variant_ids: [1, 2, 3],
        placeholders: [{ position: "front", images: [{ id: "private-artwork", x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
      },
    ],
    variants: [
      { id: 1, price: 3000, is_enabled: true, is_available: false, options: [10, 20] },
      { id: 2, price: 3200, is_enabled: true, is_available: false, options: [10, 21] },
      { id: 3, price: 3400, is_enabled: false, is_available: false, options: [11, 20] },
    ],
    options: [
      {
        name: "Color",
        type: "color",
        values: [
          { id: 10, title: "Black" },
          { id: 11, title: "White" },
        ],
      },
      {
        name: "Size",
        type: "size",
        values: [
          { id: 20, title: "M" },
          { id: 21, title: "XL" },
        ],
      },
    ],
    images: [
      { src: "https://images-api.printify.com/mockup/black.png", variant_ids: [1, 2], is_default: true },
      { src: "https://images-api.printify.com/mockup/white.png", variant_ids: [3], is_default: false },
    ],
  }
}

function liveFixture(id = "shirt") {
  const live = fixture(id)
  live.variants.forEach((variant) => {
    variant.is_available = true
  })
  return live
}

function observe(...products: ReturnType<typeof fixture>[]) {
  vi.mocked(readCatalogStock).mockResolvedValue(
    Object.fromEntries(
      products.map((p) => [p.id, parsePrintifyProduct(p, { productId: p.id, shopId: "123" })!.variants])
    )
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  Object.assign(testEnv, {
    PRINTIFY_PUBLISHING_ENABLED: true,
    DATABASE_URL: "postgresql://local/store",
    PRINTIFY_SHOP_ID: "123",
  })
  vi.mocked(listShownProducts).mockResolvedValue([fixture()])
  listFeedProfiles.mockResolvedValue(
    new Map([[1317, { googleProductCategory: 212, ageGroup: "adult", gender: "unisex", sizeSystem: "US" }]])
  )
  vi.mocked(getPublishingStore).mockReturnValue({ garments: { listFeedProfiles } } as never)
  observe(liveFixture())
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})
afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})
it("uses published display fields and saved availability without provider credentials or requests", async () => {
  const live = liveFixture()
  live.title = "Private draft"
  live.variants.forEach((v) => {
    v.price = 9900
  })
  observe(live)
  const result = await getMerchantProducts()
  expect(result[0]?.product).toMatchObject({
    title: "Published tee",
    variants: [
      { id: 1, price: 3000, available: true },
      { id: 2, price: 3200, available: true },
    ],
  })
  expect(JSON.stringify(result)).not.toMatch(/Private draft|private-artwork|print_areas/)
})
it.each(["", ' id="size-guide"'])(
  "keeps table-only products in both feeds without restoring chart text to the storefront: table%s",
  async (marker) => {
    const published = fixture()
    published.title = 'Published tee & "friends"'
    published.description = `<table${marker}><tr><th></th><th>M</th><th>XL</th></tr><tr><td>Width, in</td><td>20.50</td><td>24.00</td></tr><tr><td>Length, in</td><td>29.00</td><td>31.00</td></tr></table>`
    vi.mocked(listShownProducts).mockResolvedValue([published, fixture("prose")])
    observe(liveFixture(), liveFixture("prose"))

    const products = await getMerchantProducts()
    expect(products[0]?.product).toMatchObject({
      description: "",
      descriptionBlocks: [],
      sizeGuide: {
        sizes: ["M", "XL"],
        measurements: [
          { label: "Width, in", values: ["20.50", "24.00"] },
          { label: "Length, in", values: ["29.00", "31.00"] },
        ],
      },
    })
    const expected = [
      'Published tee & "friends"',
      "Size guide",
      "Width, in: M: 20.50; XL: 24.00",
      "Length, in: M: 29.00; XL: 31.00",
    ].join("\n")
    for (const destination of ["google", "meta"] as const) {
      const xml = createMerchantFeed(products, new URL("https://example.com"), destination)
      const document = new DOMParser().parseFromString(xml, "application/xml")
      expect(document.querySelector("parsererror")).toBeNull()
      const descriptions = [...document.querySelectorAll("item")].map(
        (item) => item.getElementsByTagNameNS("http://base.google.com/ns/1.0", "description")[0]?.textContent
      )
      expect(descriptions).toEqual([expected, expected, "Published illustration story", "Published illustration story"])
    }
    expect(products[0]?.product.description).toBe("")
    expect(products[0]?.product.descriptionBlocks).toEqual([])
  }
)
it.each(["", " \t\n", "<p><br></p>"])(
  "still rejects a truly empty description without an extracted chart: %j",
  async (description) => {
    const published = fixture()
    published.description = description
    vi.mocked(listShownProducts).mockResolvedValue([published])
    await expect(getMerchantProducts()).rejects.toHaveProperty("code", "INVALID_DESCRIPTION")
    expect(readCatalogStock).not.toHaveBeenCalled()
  }
)
it.each(["out-of-stock", "disabled", "missing", "production-change"])(
  "pauses the affected offers for %s",
  async (change) => {
    const live = liveFixture()
    if (change === "out-of-stock") live.variants[0]!.is_available = false
    if (change === "disabled") live.variants[0]!.is_enabled = false
    if (change === "missing") live.variants = live.variants.filter((v) => v.id !== 1)
    if (change === "production-change") live.print_areas[0]!.placeholders[0]!.images[0]!.scale = 0.8
    observe(live)
    const result = await getMerchantProducts()
    expect(result[0]?.product.variants[0]?.available).toBe(false)
    expect(result[0]?.product.variants[1]?.available).toBe(change !== "production-change")
  }
)
it("rejects unavailable observations to preserve the previous feed", async () => {
  vi.mocked(readCatalogStock).mockResolvedValue(null)
  await expect(getMerchantProducts()).rejects.toHaveProperty("code", "STOCK_UNAVAILABLE")
})
it("reflects current publication membership without discovering provider drafts", async () => {
  observe(liveFixture("first"), liveFixture("second"))
  vi.mocked(listShownProducts)
    .mockResolvedValueOnce([fixture("first"), fixture("second")])
    .mockResolvedValueOnce([fixture("second")])
  expect((await getMerchantProducts()).map((p) => p.product.id)).toEqual(["first", "second"])
  expect((await getMerchantProducts()).map((p) => p.product.id)).toEqual(["second"])
})
it("returns an empty feed for an empty publication without needing stock", async () => {
  vi.mocked(listShownProducts).mockResolvedValue([])
  expect(await getMerchantProducts()).toEqual([])
  expect(readCatalogStock).not.toHaveBeenCalled()
  expect(listFeedProfiles).not.toHaveBeenCalled()
})

it("exports mixed garments using their saved profiles and reads edits on the next request", async () => {
  const profiles = new Map<number, GarmentFeedProfile>(
    (
      [
        [1317, "unisex"],
        [1312, "female"],
        [2679, "female"],
        [3076, "male"],
      ] as const
    ).map(([blueprint, gender]) => [
      blueprint,
      { googleProductCategory: 212, ageGroup: "adult", gender, sizeSystem: "US" },
    ])
  )
  const products = [...profiles.keys()].map((blueprint) => ({
    ...liveFixture(`garment-${blueprint}`),
    blueprint_id: blueprint,
  }))
  vi.mocked(listShownProducts).mockResolvedValue(products)
  listFeedProfiles.mockResolvedValue(profiles)
  observe(...products)
  for (const destination of ["google", "meta"] as const) {
    const result = await getMerchantProducts()
    const xml = createMerchantFeed(result, new URL("https://example.com"), destination)
    const document = new DOMParser().parseFromString(xml, "application/xml")
    expect(document.querySelector("parsererror")).toBeNull()
    expect([...document.getElementsByTagName("g:gender")].map((field) => field.textContent)).toEqual([
      "unisex",
      "unisex",
      "female",
      "female",
      "female",
      "female",
      "male",
      "male",
    ])
    expect(result).toHaveLength(4)
  }
  expect(listFeedProfiles).toHaveBeenCalledTimes(2)
  profiles.set(2679, { googleProductCategory: 1604, gender: "female", ageGroup: "adult", sizeSystem: "EU" })
  expect((await getMerchantProducts())[2]?.apparel).toEqual(profiles.get(2679))
})

it("fails the whole feed when one garment has no complete profile", async () => {
  vi.mocked(listShownProducts).mockResolvedValue([fixture(), { ...fixture("unconfigured"), blueprint_id: 2679 }])
  await expect(getMerchantProducts()).rejects.toMatchObject({
    code: "UNSUPPORTED_BLUEPRINT",
    productId: "unconfigured",
  })
  expect(readCatalogStock).not.toHaveBeenCalled()
})

it("reports profile storage failure without returning an empty feed or leaking connection details", async () => {
  listFeedProfiles.mockRejectedValue(new Error("postgres://private-password@localhost/database"))
  await expect(getMerchantProducts()).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" })
  expect(readCatalogStock).not.toHaveBeenCalled()
})
it.each(["disabled", "database", "shop"])("rejects invalid %s configuration", async (change) => {
  if (change === "disabled") testEnv.PRINTIFY_PUBLISHING_ENABLED = false
  if (change === "database") testEnv.DATABASE_URL = undefined
  if (change === "shop") testEnv.PRINTIFY_SHOP_ID = "123/other"
  await expect(getMerchantProducts()).rejects.toHaveProperty("code", "CONFIGURATION_INVALID")
  expect(listShownProducts).not.toHaveBeenCalled()
})
it.each([
  "database",
  "wrong-shop",
  "invalid-display",
  "invalid-production",
  "unsupported-blueprint",
  "hidden",
  "duplicate",
  "empty-description",
  "zero-published-price",
  "missing-color-photo",
])("rejects %s published snapshots before contacting the provider", async (change) => {
  const published = fixture()
  if (change === "database") vi.mocked(listShownProducts).mockRejectedValue(new Error("private-database-password"))
  else {
    if (change === "wrong-shop") published.shop_id = 456
    if (change === "invalid-display") published.title = ""
    if (change === "invalid-production") Object.assign(published.print_areas[0]!, { placeholders: "private-payload" })
    if (change === "unsupported-blueprint") published.blueprint_id = 999
    if (change === "hidden") published.visible = false
    if (change === "empty-description") published.description = ""
    if (change === "zero-published-price") published.variants[0]!.price = 0
    if (change === "missing-color-photo") published.images = [published.images[1]!]
    vi.mocked(listShownProducts).mockResolvedValue(change === "duplicate" ? [published, published] : [published])
  }
  await expect(getMerchantProducts()).rejects.toHaveProperty(
    "code",
    {
      database: "DATABASE_UNAVAILABLE",
      "wrong-shop": "SNAPSHOT_PRODUCTION_INVALID",
      "invalid-display": "SNAPSHOT_DISPLAY_INVALID",
      "invalid-production": "SNAPSHOT_PRODUCTION_INVALID",
      "unsupported-blueprint": "UNSUPPORTED_BLUEPRINT",
      hidden: "SNAPSHOT_HIDDEN",
      duplicate: "INVALID_PRODUCT_ID",
      "empty-description": "INVALID_DESCRIPTION",
      "zero-published-price": "INVALID_PRICE",
      "missing-color-photo": "INCOMPLETE_VARIANTS",
    }[change]
  )
  expect(fetchMock).not.toHaveBeenCalled()
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/private-/)
})

it("omits only products absent from a fresh observation while keeping the feed available", async () => {
  vi.mocked(listShownProducts).mockResolvedValue([fixture("shirt"), fixture("new")])
  expect((await getMerchantProducts()).map((p) => p.product.id)).toEqual(["shirt"])
})
