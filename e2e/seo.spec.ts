import { expect, test } from "@playwright/test"
import { z } from "zod"

import { selectedProductIds } from "./catalog-product-ids"
import { stubDropArtwork } from "./stub-drop-artwork"

const fixturePort = Number(process.env.PLAYWRIGHT_FIXTURE_PORT ?? 3200)
const offlinePort = Number(process.env.PLAYWRIGHT_PORT ?? 3100)
const returnPolicyId = "https://example.com/returns#return-policy"
const shippingServiceId = "https://example.com/shipping#standard-shipping"

function readInitialStructuredData(html: string): unknown {
  const script = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  return JSON.parse(script?.[1] ?? "null")
}

test.beforeEach(async ({ page }) => {
  await stubDropArtwork(page)
})

test.use({ baseURL: `http://127.0.0.1:${fixturePort}` })

test("replaces catalog metadata during client navigation to a product and back", async ({ page }) => {
  await page.goto("/shop", { waitUntil: "domcontentloaded" })
  const initialDocument = await page.evaluateHandle(() => document)
  const path = `/shop/${selectedProductIds[0]}`
  await page.getByRole("link", { name: "Fixture First Design", exact: true }).click()
  await expect(page).toHaveURL((url) => url.pathname === path)
  expect(await page.evaluate((initial) => initial === document, initialDocument)).toBe(true)
  const canonical = page.locator('link[rel="canonical"]')
  await expect(canonical).toHaveCount(1)
  await expect(canonical).toHaveAttribute("href", `https://example.com${path}`)
  await expect(page.locator("title")).toHaveCount(1)
  await expect(page).toHaveTitle("Fixture First Design – T-Shirt | Your Store")
  await expect(page.locator('meta[name="description"]')).toHaveCount(1)
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /A soft everyday tee/)
  await page.goBack()
  await expect(page).toHaveURL("/shop")
  await expect(canonical).toHaveCount(1)
  await expect(canonical).toHaveAttribute("href", "https://example.com/shop")
  expect(await page.evaluate((initial) => initial === document, initialDocument)).toBe(true)
})

test("serves variant offers in the initial HTML with matching deep-linked product options", async ({
  page,
  request,
}) => {
  const path = `/shop/${selectedProductIds[0]}`
  const response = await request.get(`${path}?color=Clay&size=XL`)
  const html = await response.text()
  const graph = z
    .object({ "@graph": z.array(z.object({ "@type": z.string() }).passthrough()) })
    .parse(readInitialStructuredData(html))["@graph"]
  const group = z
    .object({
      productGroupID: z.string(),
      hasVariant: z.array(
        z.object({
          color: z.string(),
          size: z.string(),
          offers: z.object({
            price: z.string(),
            priceCurrency: z.string(),
            availability: z.string(),
            url: z.url(),
            hasMerchantReturnPolicy: z.strictObject({ "@id": z.literal(returnPolicyId) }),
            shippingDetails: z.strictObject({
              "@type": z.literal("OfferShippingDetails"),
              hasShippingService: z.strictObject({ "@id": z.literal(shippingServiceId) }),
            }),
          }),
        })
      ),
    })
    .parse(graph.find((item) => item["@type"] === "ProductGroup"))
  expect(group.productGroupID).toBe(selectedProductIds[0])
  expect(group.hasVariant).toHaveLength(4)
  expect(group.hasVariant.find((variant) => variant.color === "Clay" && variant.size === "XL")?.offers).toMatchObject({
    price: "32.00",
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
    url: `https://example.com${path}?color=Clay&size=XL`,
  })
  expect(
    group.hasVariant.find((variant) => variant.color === "Black" && variant.size === "L")?.offers.availability
  ).toBe("https://schema.org/OutOfStock")
  expect(graph.some((item) => item["@type"] === "BreadcrumbList")).toBe(true)

  await page.route("https://e2e.test/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>',
    })
  )
  await page.goto(`${path}?color=Clay&size=XL`)
  await expect(page).toHaveTitle("Fixture First Design – T-Shirt | Your Store")
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /A soft everyday tee for good company/
  )
  await expect(page.locator(".product-story")).toHaveText("A soft everyday tee for good company.")
  for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) {
    await expect(page.locator(selector)).toHaveAttribute("content", "Fixture First Design – T-Shirt | Your Store")
  }
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://e2e.test/clay-shirt.png")
  await expect(page.getByRole("button", { name: "Clay", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "XL", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator(".product-price")).toHaveText("$32.00")
  await expect(page.getByRole("button", { name: "Add to cart", exact: true })).toBeEnabled()
  await page.goto(`${path}?color=Black&size=L`)
  await expect(page.getByRole("button", { name: "This option is unavailable" })).toBeDisabled()
  await expect(page.locator(".product-price")).toHaveText("$28.00")
})

test("shows the configured shipping copy at a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto("/shipping")
  await expect(page.getByRole("main")).toContainText("Fixture policy: standard shipping")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("resolves offer policy references to the published shipping and return policies", async ({ page, request }) => {
  const [returnsResponse, shippingResponse] = await Promise.all([request.get("/returns"), request.get("/shipping")])
  expect(returnsResponse.status()).toBe(200)
  expect(shippingResponse.status()).toBe(200)
  const store = z
    .object({
      "@type": z.literal("OnlineStore"),
      "@id": z.literal("https://example.com/#store"),
      hasMerchantReturnPolicy: z.strictObject({
        "@type": z.literal("MerchantReturnPolicy"),
        "@id": z.literal(returnPolicyId),
        merchantReturnLink: z.literal("https://example.com/returns"),
      }),
    })
    .parse(readInitialStructuredData(await returnsResponse.text()))
  const servicePeriod = z.strictObject({
    "@type": z.literal("ServicePeriod"),
    duration: z.strictObject({
      "@type": z.literal("QuantitativeValue"),
      minValue: z.number(),
      maxValue: z.number(),
      unitCode: z.literal("DAY"),
    }),
    businessDays: z.array(z.string()),
  })
  const shipping = z
    .object({
      "@type": z.literal("OnlineStore"),
      "@id": z.literal(store["@id"]),
      hasShippingService: z.strictObject({
        "@type": z.literal("ShippingService"),
        "@id": z.literal(shippingServiceId),
        name: z.literal("Standard shipping"),
        description: z.string().min(1),
        handlingTime: servicePeriod,
        shippingConditions: z
          .array(
            z.strictObject({
              "@type": z.literal("ShippingConditions"),
              numItems: z.strictObject({ "@type": z.literal("QuantitativeValue"), maxValue: z.literal(1) }),
              shippingDestination: z.strictObject({
                "@type": z.literal("DefinedRegion"),
                addressCountry: z.literal("US"),
                addressRegion: z.array(z.string()),
              }),
              shippingRate: z.strictObject({
                "@type": z.literal("MonetaryAmount"),
                value: z.literal(4.95),
                currency: z.literal("USD"),
              }),
              transitTime: servicePeriod,
            })
          )
          .length(2),
      }),
    })
    .parse(readInitialStructuredData(await shippingResponse.text()))
  const { handlingTime, shippingConditions } = shipping.hasShippingService
  expect(handlingTime.duration).toMatchObject({ minValue: 2, maxValue: 10 })
  expect(handlingTime.businessDays).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"])
  expect(shippingConditions[0]!.transitTime.duration).toMatchObject({ minValue: 2, maxValue: 5 })
  expect(shippingConditions[1]!.shippingDestination.addressRegion).toEqual(["AK", "HI"])
  expect(shippingConditions[1]!.transitTime.duration).toMatchObject({ minValue: 9, maxValue: 17 })
  const regions = shippingConditions.flatMap((condition) => condition.shippingDestination.addressRegion)
  expect([...regions].sort()).toEqual(
    "AK AL AR AZ CA CO CT DC DE FL GA HI IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY".split(
      " "
    )
  )
  for (const unsupportedRegion of ["AS", "GU", "MP", "PR", "VI", "AA", "AE", "AP"]) {
    expect(regions).not.toContain(unsupportedRegion)
  }

  await page.goto("/shipping")
  await expect(page.getByRole("main")).toContainText(
    "Fixture policy: standard shipping is $4.95 for the first item and $2.40 for each additional item."
  )
  expect(new URL(store.hasMerchantReturnPolicy.merchantReturnLink).pathname).toBe(new URL(returnPolicyId).pathname)
})

test("publishes crawl instructions and a complete canonical product sitemap", async ({ request }) => {
  const robots = await request.get("/robots.txt")
  expect(robots.status()).toBe(200)
  expect(await robots.text()).toContain("Sitemap: https://example.com/sitemap.xml")
  const response = await request.get("/sitemap.xml")
  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toContain("application/xml")
  const xml = await response.text()
  const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1])
  // Six public pages, every selected product, and the one withheld fixture
  // whose reveal has passed -- so the two still withheld are absent by count as well as by name.
  expect(urls).toHaveLength(6 + selectedProductIds.length + 1)
  expect(urls).toContain("https://example.com/about")
  expect(urls).not.toContain("https://example.com/design-of-the-week")
  expect(urls).not.toContain("https://example.com/#design-of-the-week")
  for (const id of selectedProductIds) expect(urls).toContain(`https://example.com/shop/${id}`)
  expect(urls.every((url) => url?.startsWith("https://example.com/") && !url.includes("?"))).toBe(true)
  expect(urls).not.toContain("https://example.com/cart")
  expect(urls).not.toContain("https://example.com/checkout/success")
  // The withheld fixtures are published at Printify but off the wall, so the length assertion above
  // is a real absence proof: their ids are deliberately outside selectedProductIds.
  for (const id of ["f1de0000000000000000ca01", "f1de0000000000000000ca02"])
    expect(urls).not.toContain(`https://example.com/shop/${id}`)
  expect(urls).toContain("https://example.com/shop/f1de0000000000000000ca03")
})

test("keeps an unconfigured store out of the sitemap", async ({ request }) => {
  const response = await request.get(`http://127.0.0.1:${offlinePort}/sitemap.xml`)
  expect(response.status()).toBe(404)
  expect(response.headers()["cache-control"]).toBe("no-store")
  expect(response.headers()["x-robots-tag"]).toBe("noindex")
})

test("uses a per-page canonical while keeping utility and missing pages out of search", async ({ page }) => {
  for (const path of ["/", "/about", "/shop", "/shipping", "/returns", "/privacy"]) {
    await page.goto(path)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `https://example.com${path === "/" ? "" : path}`
    )
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0)
  }
  const path = `/shop/${selectedProductIds[0]}`
  await page.goto(`${path}?color=Clay&size=XL&utm_source=test`)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://example.com${path}`)
  await expect(page.getByRole("button", { name: "XL", exact: true })).toHaveAttribute("aria-pressed", "true")
  // A product the owner is withholding must read exactly like one that does not exist: 404, noindex,
  // no canonical. Anything softer confirms the id to a crawler before the drop.
  for (const path of [
    "/cart",
    "/checkout/success",
    "/not-a-route",
    "/shop/missing-product",
    "/shop/f1de0000000000000000ca01",
    "/shop/f1de0000000000000000ca02",
  ]) {
    await page.goto(path)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/)
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0)
  }
})
