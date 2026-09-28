import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

test.use({ baseURL: `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_FIXTURE_PORT ?? 3200)}` })

import { beginKeyboardNavigation } from "../test/begin-keyboard-navigation"

const item = {
  entryId: "purchased",
  productId: "aaaaaaaaaaaaaaaaaaaaaaaa",
  variantId: 1,
  title: "Good hangs",
  variantTitle: "Black / M",
  unitAmount: 2800,
  quantity: 1,
}
const cartKey = "your-store-cart-v1"

test("edits and persists the bag with accessible keyboard controls and no narrow-screen overflow", async ({
  page,
  browserName,
}, testInfo) => {
  await page.goto("/cart")
  await page.evaluate(
    ({ cartKey, item }) =>
      localStorage.setItem(cartKey, JSON.stringify({ version: 1, entries: [item], checkouts: {} })),
    { cartKey, item }
  )
  await page.reload()
  await expect(page.getByRole("heading", { name: "The good stuff (1)" })).toBeVisible()
  await expect(page.getByText("$4.95", { exact: true })).toBeVisible()
  await expect(page.getByText("$32.95", { exact: true })).toBeVisible()
  await expect(page.getByText(/Estimated delivery, including printing/)).toContainText(
    "4–15 business days in the contiguous US and Washington, DC; 11–27 business days to Alaska and Hawaii."
  )
  await page.screenshot({ path: testInfo.outputPath("cart-default.png"), fullPage: true })
  const tabKey = await beginKeyboardNavigation(page, browserName)
  const increase = page.getByRole("button", { name: /Increase quantity/ })
  for (
    let step = 0;
    step < 12 && !(await increase.evaluate((element) => element === document.activeElement));
    step += 1
  )
    await page.keyboard.press(tabKey)
  await expect(increase).toBeFocused()
  expect(
    await increase.evaluate((element) => {
      const style = getComputedStyle(element)
      return style.outlineStyle !== "none" && style.outlineWidth !== "0px"
    })
  ).toBe(true)
  await page.keyboard.press("Enter")
  await expect(page.getByRole("heading", { name: "The good stuff (2)" })).toBeVisible()
  await expect(page.getByText("$7.35", { exact: true })).toBeVisible()
  await expect(page.getByText("$63.35", { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("heading", { name: "The good stuff (2)" })).toBeVisible()
  await page.setViewportSize({ width: 320, height: 800 })
  await expect(page.getByRole("link", { name: "Cart, 2 items", exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath("cart-320px.png"), fullPage: true })
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([])
  await page.getByRole("button", { name: /Remove Good hangs/ }).click()
  await expect(page.getByRole("heading", { name: "Ready for your next favorite." })).toBeVisible()
})

test("explains the same US shipping rate on the public shipping page", async ({ page }) => {
  await page.goto("/shipping")
  await expect(page.getByRole("heading", { name: "Shipping & care", exact: true })).toBeVisible()
  await expect(page.getByRole("main")).toContainText(
    "Fixture policy: standard shipping is $4.95 for the first item and $2.40 for each additional item."
  )
})

test("checks out directly by keyboard and preserves the bag and request identity on a retry", async ({
  page,
  browserName,
}) => {
  const requests: { requestId: string; expectedShippingAmount: number; items: unknown[] }[] = []
  await page.route("**/api/checkout", (route) => {
    requests.push(route.request().postDataJSON())
    return route.fulfill({ status: 503, json: { code: "NOT_CONFIGURED", error: "Test checkout unavailable" } })
  })
  await page.goto("/cart")
  await page.evaluate(
    ({ cartKey, item }) =>
      localStorage.setItem(cartKey, JSON.stringify({ version: 1, entries: [item], checkouts: {} })),
    { cartKey, item }
  )
  await page.reload()
  await expect(page.getByText("$4.95", { exact: true })).toBeVisible()
  await expect(page.getByText("$32.95", { exact: true })).toBeVisible()
  await expect(page.getByRole("textbox")).toHaveCount(0)
  await expect(page.getByRole("combobox")).toHaveCount(0)
  const checkout = page.getByRole("button", { name: "Checkout", exact: true })
  const tabKey = await beginKeyboardNavigation(page, browserName)
  for (
    let step = 0;
    step < 20 && !(await checkout.evaluate((element) => element === document.activeElement));
    step += 1
  )
    await page.keyboard.press(tabKey)
  await expect(checkout).toBeFocused()
  expect(
    await checkout.evaluate((element) => {
      const style = getComputedStyle(element)
      return style.outlineStyle !== "none" && style.outlineWidth !== "0px"
    })
  ).toBe(true)
  await page.keyboard.press("Enter")
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Checkout isn’t open just yet")
  await expect(page.getByRole("heading", { name: "The good stuff (1)" })).toBeVisible()
  await checkout.click()
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Checkout isn’t open just yet")
  expect(requests).toHaveLength(2)
  expect(requests[0]).toEqual({
    items: [{ productId: item.productId, variantId: 1, quantity: 1, expectedUnitAmount: 2800 }],
    expectedShippingAmount: 495,
    requestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
    attribution: expect.objectContaining({ channel: "direct", source: null, landingPath: "/cart" }),
  })
  expect(requests[1]?.requestId).toBe(requests[0]?.requestId)
  await page.reload()
  await expect(page.getByRole("heading", { name: "The good stuff (1)" })).toBeVisible()
})

test("consumes paid snapshot additions once and preserves later items", async ({ page }) => {
  await page.route("**/api/checkout/status?*", (route) =>
    route.fulfill({ json: { paymentStatus: "paid", fulfillmentStatus: "simulated" } })
  )
  await page.goto("/cart")
  await page.evaluate(
    ({ cartKey, item }) =>
      localStorage.setItem(
        cartKey,
        JSON.stringify({
          version: 1,
          entries: [item, { ...item, entryId: "added-later" }],
          checkouts: {
            cs_test_browsercart: { createdAt: Date.now(), entries: [{ entryId: "purchased", quantity: 1 }] },
          },
        })
      ),
    { cartKey, item }
  )
  await page.goto("/checkout/success?session_id=cs_test_browsercart")
  await expect(page.getByRole("heading", { name: "Your order is confirmed." })).toBeVisible()
  await expect(page.getByText(/No real order was sent for printing/)).toBeVisible()
  await page.reload()
  await expect(page.getByRole("heading", { name: "Your order is confirmed." })).toBeVisible()
  await page.goto("/cart")
  await expect(page.getByRole("heading", { name: "The good stuff (1)" })).toBeVisible()
})
