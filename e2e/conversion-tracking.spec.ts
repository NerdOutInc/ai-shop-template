import { expect, test as base } from "@playwright/test"

import { selectedProductIds } from "./catalog-product-ids"

type AnalyticsEvent = {
  type: "event" | "pageview"
  url: string
  name?: string
  data?: Record<string, string | number>
}

const fixturePort = Number(process.env.PLAYWRIGHT_FIXTURE_PORT ?? 3200)
const shopOrigin = `http://127.0.0.1:${fixturePort}`
const productId = selectedProductIds[0]!
const sessionId = "cs_live_browserconversion"
const receipt = "a".repeat(64)
const stripeUrl = "https://checkout.stripe.com/c/pay/browser-fixture"
const successUrl = `${shopOrigin}/checkout/success?session_id=${sessionId}`

// Exercise the installed SDK's actual queue and beforeSend callback without loading
// Vercel's network script or sending test conversions to a real analytics project.
const analyticsScript = `(() => {
  let beforeSend;
  const queue = window.vaq || [];
  window.va = (type, payload) => {
    if (type === "beforeSend") {
      beforeSend = payload;
      return;
    }
    if (type !== "event" && type !== "pageview") return;
    const event = { type, url: window.location.href };
    const sanitized = beforeSend ? beforeSend(event) : event;
    if (!sanitized) return;
    navigator.sendBeacon("/__e2e_analytics", JSON.stringify({
      ...sanitized,
      ...(type === "event" ? { name: payload.name, data: payload.data } : {}),
    }));
  };
  window.vaq = [];
  queue.forEach(([type, payload]) => window.va(type, payload));
})();`

const test = base.extend<{ analytics: AnalyticsEvent[] }>({
  analytics: async ({ page }, runFixture) => {
    const events: AnalyticsEvent[] = []
    const unexpectedRequests: string[] = []
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === shopOrigin) {
        if (url.pathname === "/_vercel/insights/script.js")
          return route.fulfill({ contentType: "text/javascript", body: analyticsScript })
        if (url.pathname === "/__e2e_analytics") {
          events.push(route.request().postDataJSON() as AnalyticsEvent)
          return route.fulfill({ status: 204 })
        }
        return route.continue()
      }
      if (["https://e2e.test", "https://fixture.public.blob.vercel-storage.com"].includes(url.origin))
        return route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 700"><rect width="600" height="700" fill="#bc735c"/></svg>',
        })
      unexpectedRequests.push(url.href)
      return route.abort()
    })
    await runFixture(events)
    expect(unexpectedRequests).toEqual([])
  },
})

test.use({ baseURL: shopOrigin })

test("tracks the organic shopping funnel once and sanitizes a Stripe-style purchase return", async ({
  page,
  analytics,
}) => {
  let checkoutRequests = 0
  let statusRequests = 0
  await page.route("**/api/checkout", (route) => {
    checkoutRequests += 1
    return checkoutRequests === 1
      ? route.fulfill({ status: 503, json: { code: "NOT_CONFIGURED" } })
      : route.fulfill({ json: { url: stripeUrl, sessionId } })
  })
  await page.route(stripeUrl, (route) =>
    route.fulfill({
      contentType: "text/html",
      // The fixture shop is HTTP; retain the payment origin across that local downgrade.
      headers: { "Referrer-Policy": "origin" },
      body: `<!doctype html><title>Offline checkout fixture</title><link rel="icon" href="data:,"><a href="${successUrl}">Return to Your Store</a>`,
    })
  )
  await page.route("**/api/checkout/status?*", (route) => {
    statusRequests += 1
    return route.fulfill({
      json: { paymentStatus: "paid", fulfillmentStatus: "submitted", purchase: { receipt, totalUsd: 36.95 } },
    })
  })

  await page.goto(`/shop/${productId}`, { referer: "https://www.google.com/search?q=graphic+shirts" })
  await expect(page.getByRole("heading", { level: 1, name: "Fixture Good Hangs" })).toBeVisible()
  await expect.poll(() => analytics.filter((event) => event.name === "product_viewed")).toHaveLength(1)
  await page.getByRole("button", { name: "Black", exact: true }).click()
  await page.getByRole("button", { name: "M", exact: true }).click()
  await page.getByRole("button", { name: "Clay", exact: true }).click()
  await page.getByRole("button", { name: "XL", exact: true }).click()
  await page.getByRole("button", { name: "Add to cart", exact: true }).click()
  const confirmation = page.getByRole("dialog", { name: "Added to cart" })
  await expect(confirmation).toBeVisible()
  await expect.poll(() => analytics.filter((event) => event.name === "add_to_cart")).toHaveLength(1)
  await confirmation.getByRole("link", { name: "View cart (1)", exact: true }).click()
  await expect(page.getByRole("heading", { name: "The good stuff (1)" })).toBeVisible()

  await page.getByRole("button", { name: "Checkout", exact: true }).click()
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Checkout isn’t open just yet")
  expect(analytics.filter((event) => event.name === "begin_checkout")).toHaveLength(0)
  await page.getByRole("button", { name: "Checkout", exact: true }).click()
  await expect(page).toHaveURL(stripeUrl)
  await expect.poll(() => analytics.filter((event) => event.name === "begin_checkout")).toHaveLength(1)
  await page.getByRole("link", { name: "Return to Your Store" }).click()
  await expect(page).toHaveURL(`${shopOrigin}/checkout/success`)
  await expect(page.getByRole("heading", { name: "Your order is confirmed." })).toBeVisible()
  expect(await page.evaluate(() => document.referrer)).toBe("")
  await expect.poll(() => analytics.filter((event) => event.name === "purchase")).toHaveLength(1)
  await expect
    .poll(() => analytics.filter((event) => event.type === "pageview" && event.url.includes("/checkout/success")))
    .not.toHaveLength(0)

  expect(analytics.filter((event) => event.type === "event").map(({ name, data }) => ({ name, data }))).toEqual([
    { name: "product_viewed", data: { source: "organic_search", product_id: productId } },
    { name: "add_to_cart", data: { source: "organic_search", product_id: productId } },
    { name: "begin_checkout", data: { source: "organic_search", subtotal_usd: 32 } },
    { name: "purchase", data: { source: "organic_search", total_usd: 36.95 } },
  ])
  const purchase = analytics.find((event) => event.name === "purchase")!
  expect(purchase.url).toBe(`${shopOrigin}/checkout/success`)
  expect(JSON.stringify(analytics)).not.toContain(sessionId)
  expect(JSON.stringify(analytics)).not.toContain(receipt)
  expect(analytics.every((event) => !new URL(event.url).searchParams.has("session_id"))).toBe(true)

  await page.reload()
  await expect(page.getByRole("heading", { name: "Your order is confirmed." })).toBeVisible()
  await expect.poll(() => statusRequests).toBeGreaterThanOrEqual(2)
  await expect
    .poll(() => analytics.filter((event) => event.type === "pageview" && event.url.includes("/checkout/success")))
    .toHaveLength(2)
  expect(analytics.filter((event) => event.name === "purchase")).toHaveLength(1)
  expect(JSON.stringify(analytics)).not.toContain(sessionId)
})

for (const status of [
  { paymentStatus: "pending", fulfillmentStatus: "pending", heading: "Checking your payment." },
  { paymentStatus: "paid", fulfillmentStatus: "simulated", heading: "Your order is confirmed." },
]) {
  test(`does not record a purchase for ${status.paymentStatus}/${status.fulfillmentStatus} status`, async ({
    page,
    analytics,
  }) => {
    await page.route("**/api/checkout/status?*", (route) =>
      route.fulfill({
        json: {
          paymentStatus: status.paymentStatus,
          fulfillmentStatus: status.fulfillmentStatus,
          purchase: { receipt, totalUsd: 36.95 },
        },
      })
    )
    await page.goto(successUrl)
    await expect(page.getByRole("heading", { name: status.heading })).toBeVisible()
    await expect(page.getByRole("status")).toContainText(
      status.paymentStatus === "pending" ? "Your payment hasn’t been confirmed yet" : "No real order was sent"
    )
    await expect.poll(() => analytics.filter((event) => event.type === "pageview")).toHaveLength(1)
    expect(analytics.filter((event) => event.type === "event")).toEqual([])
    expect(JSON.stringify(analytics)).not.toContain(sessionId)
    expect(await page.evaluate(() => localStorage.getItem("your-store-purchase-attempts-v1"))).toBeNull()
  })
}
