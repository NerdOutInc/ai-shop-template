import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { readCatalogStock } from "@/features/catalog-sync/read-catalog-stock.server"
import type { GarmentFeedProfile } from "@/features/garment-catalog/garment-feed-profile-schema"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import { listShownProducts } from "@/features/publishing/list-shown-products.server"
import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"
import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import { googleCopySharedFactsHash } from "./google-copy-shared-facts-hash"
import type { GoogleMerchantCopy } from "./google-merchant-copy-schema"
import { resolveGoogleMerchantCopy } from "./resolve-google-merchant-copy"
import { validateGoogleCopyApproval } from "./validate-google-copy-approval"
import { resolveProductGallery } from "@/features/product-gallery/resolve-product-gallery.server"
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
function feed(snapshots: Record<string, unknown>[]) {
  return snapshots.map((snapshot) => resolveProductGallery({ snapshot, active: null, revision: "1" }))
}

beforeEach(() => {
  vi.resetAllMocks()
  Object.assign(testEnv, {
    PRINTIFY_PUBLISHING_ENABLED: true,
    DATABASE_URL: "postgresql://local/store",
    PRINTIFY_SHOP_ID: "123",
  })
  vi.mocked(listShownProducts).mockResolvedValue(feed([fixture()]))
  listFeedProfiles.mockResolvedValue(
    new Map([[1317, { googleProductCategory: 212, ageGroup: "adult", gender: "unisex", sizeSystem: "US" }]])
  )
  vi.mocked(getPublishingStore).mockReturnValue({ garments: { listFeedProfiles } } as never)
  observe(liveFixture())
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "error").mockImplementation(() => undefined)
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
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
    vi.mocked(listShownProducts).mockResolvedValue(feed([published, fixture("prose")]))
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
    vi.mocked(listShownProducts).mockResolvedValue(feed([published]))
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
    .mockResolvedValueOnce(feed([fixture("first"), fixture("second")]))
    .mockResolvedValueOnce(feed([fixture("second")]))
  expect((await getMerchantProducts()).map((p) => p.product.id)).toEqual(["first", "second"])
  expect((await getMerchantProducts()).map((p) => p.product.id)).toEqual(["second"])
})
it("returns an empty feed for an empty publication without needing stock", async () => {
  vi.mocked(listShownProducts).mockResolvedValue(feed([]))
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
  vi.mocked(listShownProducts).mockResolvedValue(feed(products))
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
  vi.mocked(listShownProducts).mockResolvedValue(feed([fixture(), { ...fixture("unconfigured"), blueprint_id: 2679 }]))
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
    vi.mocked(listShownProducts).mockResolvedValue(feed(change === "duplicate" ? [published, published] : [published]))
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
  vi.mocked(listShownProducts).mockResolvedValue(feed([fixture("shirt"), fixture("new")]))
  expect((await getMerchantProducts()).map((p) => p.product.id)).toEqual(["shirt"])
})

const copyProfile = { googleProductCategory: 212, ageGroup: "adult", gender: "unisex", sizeSystem: "US" } as const
function reviewedCopy(snapshot = fixture()): GoogleMerchantCopy {
  const product = normalizeCatalogProduct(snapshot)
  const production = parsePrintifyProduct(snapshot, { productId: snapshot.id, shopId: "123" })!
  return {
    version: 1,
    origin: "generated",
    content: "A geometric circle illustration on a graphic T-shirt.",
    shared_facts_hash: googleCopySharedFactsHash(product, copyProfile),
    reviewed_variants: product.variants.map((v) => ({
      id: v.id,
      fingerprint: production.variants.find((p) => p.id === v.id)!.fingerprint,
      label: production.variants.find((p) => p.id === v.id)!.label,
      color: v.color!,
      size: v.size!,
    })),
    pattern: "Geometric circle and line",
    materials: { Black: "Cotton/Polyester" },
  }
}

it("keeps reviewed Google copy through the stock remap and leaves Meta byte-identical", async () => {
  const published = fixture()
  vi.mocked(listShownProducts).mockResolvedValue(feed([published]))
  const baseline = createMerchantFeed(await getMerchantProducts(), new URL("https://example.com"), "meta")
  vi.mocked(listShownProducts).mockResolvedValue(
    feed([{ ...published, google_merchant_copy: reviewedCopy(published) }])
  )
  const products = await getMerchantProducts()
  expect(products[0]!.googleCopy?.get(1)?.content).toContain("Color: Black. Size: M.")
  expect(products[0]!.product.variants[0]!.available).toBe(true)
  expect(createMerchantFeed(products, new URL("https://example.com"))).toContain("<g:structured_description>")
  expect(createMerchantFeed(products, new URL("https://example.com"), "meta")).toBe(baseline)
})

it.each([
  null,
  {},
  { version: 9 },
  { origin: "unknown" },
  { content: "x".repeat(5001) },
  { content: "illegal\u0000" },
  { pattern: "x".repeat(101) },
  { materials: { Black: "x".repeat(201) } },
  { materials: { White: "Cotton" } },
  { pattern: "bad\ud800" },
])("falls back safely for invalid optional metadata %j", async (patch) => {
  const published = fixture()
  const baseline = createMerchantFeed(await getMerchantProducts(), new URL("https://example.com"))
  const raw = patch === null ? null : Object.keys(patch).length === 0 ? {} : { ...reviewedCopy(), ...patch }
  vi.mocked(listShownProducts).mockResolvedValue(feed([{ ...published, google_merchant_copy: raw }]))
  const products = await getMerchantProducts()
  expect(createMerchantFeed(products, new URL("https://example.com"))).toBe(baseline)
})

it.each(["title", "description", "gender", "ageGroup"])("disables all overrides on shared %s drift", (field) => {
  const snapshot = fixture(),
    copy = reviewedCopy(snapshot)
  const product = normalizeCatalogProduct(snapshot)
  const profile = { ...copyProfile }
  if (field === "title" || field === "description") product[field] = "New fact"
  else Object.assign(profile, { [field]: field === "gender" ? "female" : "kids" })
  const resolved = resolveGoogleMerchantCopy(
    copy,
    product,
    parsePrintifyProduct(snapshot, { productId: snapshot.id, shopId: "123" })!,
    profile
  )
  expect(resolved.variants.size).toBe(0)
  expect(resolved.issues).toEqual([{ code: "SHARED_FACTS_CHANGED" }])
})

it.each(["production", "label", "new", "fingerprint-version"])(
  "retains unchanged reviewed variants after %s drift",
  (change) => {
    const snapshot = fixture(),
      copy = reviewedCopy(snapshot)
    if (change === "new") snapshot.variants[2]!.is_enabled = true
    if (change === "production") {
      snapshot.print_areas = [structuredClone(snapshot.print_areas[0]!), structuredClone(snapshot.print_areas[0]!)]
      snapshot.print_areas[0]!.variant_ids = [1]
      snapshot.print_areas[1]!.variant_ids = [2, 3]
      snapshot.print_areas[0]!.placeholders[0]!.images[0]!.x = 0.6
    }
    if (change === "label") snapshot.options[1]!.values[0]!.title = "Medium"
    if (change === "fingerprint-version")
      copy.reviewed_variants[0]!.fingerprint = copy.reviewed_variants[0]!.fingerprint.replace(/^v\d+:/, "v999:")
    const resolved = resolveGoogleMerchantCopy(
      copy,
      normalizeCatalogProduct(snapshot),
      parsePrintifyProduct(snapshot, { productId: snapshot.id, shopId: "123" })!,
      copyProfile
    )
    expect(resolved.variants.has(2)).toBe(true)
    expect(resolved.variants.has(change === "new" ? 3 : 1)).toBe(false)
  }
)

it("ignores stock, prices, mockup hosting and unused provider metadata when resolving approval", () => {
  const snapshot = fixture(),
    copy = reviewedCopy(snapshot)
  snapshot.variants.forEach((v) => {
    v.price += 100
    v.is_available = true
  })
  snapshot.images[0]!.src = "https://catalog.public.blob.vercel-storage.com/new.png"
  Object.assign(snapshot.print_areas[0]!, { provider_ignored: "new response metadata" })
  const resolved = resolveGoogleMerchantCopy(
    copy,
    normalizeCatalogProduct(snapshot),
    parsePrintifyProduct(snapshot, { productId: snapshot.id, shopId: "123" })!,
    copyProfile
  )
  expect([...resolved.variants.keys()]).toEqual([1, 2])
})

it("falls back only for a variant whose final ending exceeds the Unicode limit, and rejects that proposed approval", async () => {
  const snapshot = fixture(),
    copy = reviewedCopy(snapshot)
  copy.content = "😀".repeat(5000 - [..." Color: Black. Size: M."].length)
  const resolved = resolveGoogleMerchantCopy(
    copy,
    normalizeCatalogProduct(snapshot),
    parsePrintifyProduct(snapshot, { productId: snapshot.id, shopId: "123" })!,
    copyProfile
  )
  expect([...resolved.variants.get(1)!.content]).toHaveLength(5000)
  expect(resolved.variants.has(2)).toBe(false)
  expect(() => validateGoogleCopyApproval(copy, snapshot, "123", copyProfile, "unknown")).toThrow(
    "GOOGLE_COPY_INVALID_APPROVAL"
  )
  vi.mocked(listShownProducts).mockResolvedValue(feed([{ ...snapshot, google_merchant_copy: copy }]))
  expect(createMerchantFeed(await getMerchantProducts(), new URL("https://example.com"))).toContain(
    "<g:description>Published illustration story</g:description>"
  )
})

it("refuses to relabel known generated copy after human editing or approval", () => {
  const snapshot = fixture(),
    copy = reviewedCopy(snapshot)
  expect(() =>
    validateGoogleCopyApproval(
      { ...copy, origin: "human" },
      { ...snapshot, google_merchant_copy: copy },
      "123",
      copyProfile,
      "unknown"
    )
  ).toThrow("GOOGLE_COPY_ORIGIN_DOWNGRADE")
})

it("requires explicit provenance for human-origin approval, including untyped callers", () => {
  const snapshot = fixture()
  const copy = { ...reviewedCopy(snapshot), origin: "human" }
  expect(() =>
    // @ts-expect-error JavaScript callers must not bypass the required provenance argument either.
    validateGoogleCopyApproval(copy, snapshot, "123", copyProfile)
  ).toThrow("GOOGLE_COPY_PROVENANCE_INCOMPLETE")
})

it("falls back for inactive optional copy without logging on feed reads", async () => {
  vi.mocked(listShownProducts).mockResolvedValue(
    feed([{ ...fixture(), google_merchant_copy: { content: "PRIVATE COPY TEXT" } }])
  )
  const products = await getMerchantProducts()
  const xml = createMerchantFeed(products, new URL("https://example.com"))
  expect(xml).toContain("<g:description>Published illustration story</g:description>")
  expect(xml).not.toContain("PRIVATE COPY TEXT")
  expect(console.warn).not.toHaveBeenCalled()
})

it("uses only explicitly supplied material keys, even when a catalog color is an object property name", async () => {
  const snapshot = fixture()
  snapshot.options[0]!.values[0]!.title = "constructor"
  const copy = reviewedCopy(snapshot)
  copy.materials = {}
  vi.mocked(listShownProducts).mockResolvedValue(feed([{ ...snapshot, google_merchant_copy: copy }]))
  const products = await getMerchantProducts()
  expect(products[0]!.googleCopy?.get(1)?.material).toBeUndefined()
  expect(createMerchantFeed(products, new URL("https://example.com"))).toContain("Color: constructor. Size: M.")
})
