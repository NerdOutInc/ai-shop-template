import { expect, test } from "@playwright/test"

test.use({ baseURL: `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_FIXTURE_PORT ?? 3200)}` })

import type { OrderAttribution } from "@/features/attribution/order-attribution-schema"

const key = "your-store-order-attribution-v1"
const item = {
  entryId: "attribution-test",
  productId: "aaaaaaaaaaaaaaaaaaaaaaaa",
  variantId: 1,
  title: "Good hangs",
  variantTitle: "Black / M",
  unitAmount: 2800,
  quantity: 1,
}

test("attaches the first public campaign to checkout across navigation and a retry with tags disabled", async ({
  page,
}) => {
  const requests: { requestId: string; attribution?: OrderAttribution }[] = []
  await page.route("**/api/checkout", (route) => {
    requests.push(route.request().postDataJSON())
    return route.fulfill({ status: 503, json: { code: "NOT_CONFIGURED" } })
  })
  await page.goto(
    "/shipping?utm_source=instagram&utm_medium=paid_social&utm_campaign=Autumn_2026&fbclid=SECRET_CLICK#private"
  )
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), key)).not.toBeNull()
  await page.evaluate((item) => {
    localStorage.setItem("your-store-cart-v1", JSON.stringify({ version: 1, entries: [item], checkouts: {} }))
  }, item)
  await page.getByRole("link", { name: /^Cart,/ }).click()
  await expect(page).toHaveURL(/\/cart$/)
  await page.reload()
  await expect(page.getByRole("button", { name: "Checkout", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Checkout", exact: true }).click()
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Checkout isn’t open just yet")
  await page.getByRole("button", { name: "Checkout", exact: true }).click()
  await expect.poll(() => requests.length).toBe(2)
  expect(requests[0]?.attribution).toEqual({
    version: 1,
    capturedAt: expect.any(String),
    source: "instagram",
    channel: "paid",
    referrerHost: null,
    utmSource: "instagram",
    utmMedium: "paid_social",
    utmCampaign: "Autumn_2026",
    landingPath: "/shipping",
    method: "campaign",
  })
  expect(requests[1]).toEqual(requests[0])
  expect(JSON.stringify(requests)).not.toContain("SECRET_CLICK")
  expect(JSON.stringify(requests)).not.toContain("#private")
  expect(await page.locator('script[src*="facebook.net"], script[src*="googletagmanager.com"]').count()).toBe(0)
})

for (const preference of ["gpc", "meta", "google"] as const) {
  test(`omits order attribution for ${preference} privacy preferences with providers disabled`, async ({ page }) => {
    await page.addInitScript(
      ({ preference, item }) => {
        if (preference === "gpc") Object.defineProperty(navigator, "globalPrivacyControl", { value: true })
        else
          localStorage.setItem(
            `your-store-${preference}-consent-v1`,
            JSON.stringify({ consent: "denied", expiresAt: Date.now() + 60_000 })
          )
        localStorage.setItem("your-store-cart-v1", JSON.stringify({ version: 1, entries: [item], checkouts: {} }))
      },
      { preference, item }
    )
    const requests: { attribution?: OrderAttribution }[] = []
    await page.route("**/api/checkout", (route) => {
      requests.push(route.request().postDataJSON())
      return route.fulfill({ status: 503, json: { code: "NOT_CONFIGURED" } })
    })
    await page.goto("/cart?utm_source=instagram&utm_medium=social&utm_campaign=Autumn")
    await page.getByRole("button", { name: "Checkout", exact: true }).click()
    await expect.poll(() => requests.length).toBe(1)
    expect(requests[0]?.attribution).toBeUndefined()
    expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).toBeNull()
  })
}

test("keeps a recognized Meta source through isolated ingress without retaining selection or campaign details", async ({
  page,
}) => {
  await page.goto("/checkout/meta?products=private-selection&cart_origin=instagram&utm_campaign=private-campaign")
  await expect(page).toHaveURL(/\/checkout\/meta$/)
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), key)).not.toBeNull()
  const attribution = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), key)
  expect(attribution).toMatchObject({
    source: "instagram",
    channel: "social",
    method: "meta_checkout",
    utmCampaign: null,
  })
  expect(JSON.stringify(attribution)).not.toContain("private-selection")
  expect(JSON.stringify(attribution)).not.toContain("private-campaign")
  expect(await page.locator('script[src*="facebook.net"], script[src*="googletagmanager.com"]').count()).toBe(0)
})
