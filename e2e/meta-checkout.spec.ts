import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { selectedProductIds } from "./catalog-product-ids"

import { beginKeyboardNavigation } from "../test/begin-keyboard-navigation"
import { stubDropArtwork } from "./stub-drop-artwork"

test.use({ baseURL: `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_FIXTURE_PORT ?? 3200)}` })

const productId = selectedProductIds[0]!
const cartKey = "your-store-cart-v1"
const existing = {
  productId: selectedProductIds[1]!,
  variantId: 1001,
  title: "Existing shirt",
  variantTitle: "Black / M",
  unitAmount: 2800,
  quantity: 1,
  entryId: "existing",
}
const selectionUrl = `/checkout/meta?products=${encodeURIComponent(`${productId}-1001:1,${productId}-1004:1,${productId}-1001:1`)}`

test.beforeEach(async ({ page }) => {
  await stubDropArtwork(page)
  await page.route("https://e2e.test/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 700"><rect width="600" height="700" fill="#bc735c"/></svg>',
    })
  )
  await page.route("**/_vercel/insights/**", (route) => route.fulfill({ status: 204 }))
})

test("reviews exact Meta variants, preserves the existing cart and cannot duplicate on reload or back", async ({
  page,
  browserName,
}, testInfo) => {
  const requests: unknown[] = []
  await page.route("**/api/checkout", (route) => {
    requests.push(route.request().postDataJSON())
    return route.fulfill({ status: 503, json: { code: "NOT_CONFIGURED" } })
  })
  await page.goto("/cart")
  await page.evaluate(
    ({ cartKey, existing }) =>
      localStorage.setItem(cartKey, JSON.stringify({ version: 1, entries: [existing], checkouts: {} })),
    { cartKey, existing }
  )
  await page.goto(selectionUrl)
  await expect(page.getByRole("heading", { level: 1, name: "Review your selection." })).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow")
  const catalogTitles = ["Fixture First Design – Black / M", "Fixture First Design – Clay / XL"]
  for (const name of catalogTitles) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
  await expect(page.getByText("Quantity: 2", { exact: true })).toBeVisible()
  await expect(page.getByText("$32.00 each", { exact: true })).toBeVisible()
  await expect(page.getByText(/You already have 1 shirt/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Checkout", exact: true })).toHaveCount(0)
  expect(requests).toHaveLength(0)
  const add = page.getByRole("button", { name: "Add selection to cart" })
  const tabKey = await beginKeyboardNavigation(page, browserName)
  for (let step = 0; step < 15 && !(await add.evaluate((element) => element === document.activeElement)); step++)
    await page.keyboard.press(tabKey)
  await expect(add).toBeFocused()
  expect(await add.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
  await page.screenshot({ path: testInfo.outputPath("meta-review.png"), fullPage: true })
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([])
  await page.keyboard.press("Enter")
  await expect(page.getByRole("heading", { name: "The good stuff (4)" })).toBeVisible()
  for (const name of catalogTitles) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: `Increase quantity of ${name}`, exact: true })).toBeVisible()
  }
  const importStatus = page.getByRole("status").filter({ hasText: "This selection has been added" })
  await expect(importStatus).toBeFocused()
  expect(await importStatus.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
  await page.keyboard.press(tabKey)
  await expect(page.getByRole("link", { name: "View Existing shirt", exact: true })).toBeFocused()
  await expect(page.getByText("Existing shirt", { exact: true })).toBeVisible()
  await expect(page.getByText("$128.15", { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("heading", { name: "The good stuff (4)" })).toBeVisible()
  for (const name of catalogTitles) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
  await page.goto("/cart")
  for (const name of catalogTitles) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
  await page.goto("/shipping")
  await page.goBack()
  await expect(page.getByRole("heading", { name: "The good stuff (4)" })).toBeVisible()
  await page.setViewportSize({ width: 320, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath("meta-cart-320px.png"), fullPage: true })
  await page.getByRole("button", { name: "Checkout", exact: true }).click()
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Checkout isn’t open just yet")
  expect(requests).toEqual([
    {
      requestId: expect.any(String),
      expectedShippingAmount: 1215,
      attribution: {
        version: 1,
        capturedAt: expect.any(String),
        channel: "direct",
        source: null,
        referrerHost: null,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        landingPath: "/cart",
        method: "direct",
      },
      items: [
        { productId: existing.productId, variantId: 1001, quantity: 1, expectedUnitAmount: 2800 },
        { productId, variantId: 1001, quantity: 2, expectedUnitAmount: 2800 },
        { productId, variantId: 1004, quantity: 1, expectedUnitAmount: 3200 },
      ],
    },
  ])
})

test("rejects broken links, unavailable variants and coupons without touching the existing cart", async ({ page }) => {
  await page.goto("/cart")
  const saved = JSON.stringify({ version: 1, entries: [existing], checkouts: {} })
  await page.evaluate(({ cartKey, saved }) => localStorage.setItem(cartKey, saved), { cartKey, saved })
  for (const query of [
    "",
    `products=${productId}-1001:0`,
    `products=${productId}-1001:21`,
    `products=aaaaaaaaaaaaaaaaaaaaaaaa-1001:1`,
    `products=${productId}-9999:1`,
    `products=${productId}-1002:1`,
    `products=${productId}-1001:1&coupon=SAVE10`,
    `products=${productId}-1001:1&products=${productId}-1004:1`,
  ]) {
    await page.goto(`/checkout/meta?${query}`)
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Nothing was added")
    if (query.includes("coupon="))
      await expect(page.getByRole("main").getByRole("alert")).toContainText("doesn’t currently support coupon codes")
    await expect(page.getByRole("button", { name: "Add selection to cart" })).toHaveCount(0)
    expect(await page.evaluate((cartKey) => localStorage.getItem(cartKey), cartKey)).toBe(saved)
  }
})

test("permits deliberate reimport after removal and explains blocked storage", async ({ page }) => {
  await page.addInitScript(() => {
    const write = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === "your-store-cart-v1") throw new Error("Storage blocked in test")
      write.call(this, key, value)
    }
  })
  await page.goto(`/checkout/meta?products=${productId}-1001:2`)
  await page.getByRole("button", { name: "Add selection to cart" }).click()
  await expect(page.getByRole("heading", { name: "The good stuff (2)" })).toBeVisible()
  await expect(page.getByText(/Your browser isn’t saving your cart/)).toBeVisible()
  await page.getByRole("button", { name: /Remove Fixture First Design/ }).click()
  await page.getByRole("button", { name: "Add selection to cart" }).click()
  await expect(page.getByRole("heading", { name: "The good stuff (2)" })).toBeVisible()
})

test("names an unavailable line and links to its current options without adding the other lines", async ({ page }) => {
  await page.goto("/cart")
  const saved = JSON.stringify({ version: 1, entries: [existing], checkouts: {} })
  await page.evaluate(({ cartKey, saved }) => localStorage.setItem(cartKey, saved), { cartKey, saved })
  await page.goto(`/checkout/meta?products=${productId}-1001:1,${productId}-1002:1`)
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Fixture First Design (Black / L)")
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Nothing was added")
  const recovery = page.getByRole("link", { name: "Choose options for Fixture First Design" })
  await expect(recovery).toHaveAttribute("href", `/shop/${productId}`)
  await page.setViewportSize({ width: 320, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([])
  await recovery.click()
  await expect(page).toHaveURL((url) => url.pathname === `/shop/${productId}` && !url.searchParams.has("size"))
  await expect(page.getByRole("button", { name: "Choose a size" })).toBeDisabled()
  expect(await page.evaluate((cartKey) => localStorage.getItem(cartKey), cartKey)).toBe(saved)
})
