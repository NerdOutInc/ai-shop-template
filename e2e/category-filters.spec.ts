import { expect, test } from "@playwright/test"

import { beginKeyboardNavigation } from "../test/begin-keyboard-navigation"
import { catalogProducts } from "./catalog-products"
import { stubDropArtwork } from "./stub-drop-artwork"

const cropTop = catalogProducts.find((product) => product.blueprint_id === 1312)!
// The fixture also includes one product whose scheduled reveal has already passed.
const productCount = catalogProducts.length + 1

test.use({ baseURL: `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_FIXTURE_PORT ?? 3200)}` })

test.beforeEach(async ({ page }) => {
  await stubDropArtwork(page)
  await page.route("https://e2e.test/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 700"><rect width="600" height="700" fill="#e9ece9"/></svg>',
    })
  )
})

test("filters either category or both and clears category, size, and color while retaining sorting", async ({
  page,
}, testInfo) => {
  await page.goto("/shop")
  const tee = page.getByRole("button", { name: "T-shirts", exact: true })
  const crop = page.getByRole("button", { name: "Crop tops", exact: true })
  const cards = page.getByRole("article")
  const titles = () => cards.getByRole("heading", { level: 2 }).allTextContents()
  const sort = page.getByRole("combobox", { name: "Sort by", exact: true })
  const filters = page.getByRole("button", { name: /^Filters/ })

  await expect(cards).toHaveCount(productCount)
  await expect(tee).toHaveAttribute("aria-pressed", "false")
  await expect(crop).toHaveAttribute("aria-pressed", "false")
  await expect(page.getByText(`${productCount} good things to wear`, { exact: true })).toBeVisible()
  const featuredTitles = await titles()
  expect((await page.getByRole("group", { name: "Category", exact: true }).boundingBox())!.y).toBeLessThan(
    (await sort.boundingBox())!.y
  )

  await tee.click()
  await expect(tee).toHaveAttribute("aria-pressed", "true")
  await expect(cards).toHaveCount(productCount - 1)
  expect(await titles()).toEqual(featuredTitles.filter((title) => title !== cropTop.title))
  await crop.click()
  await expect(tee).toHaveAttribute("aria-pressed", "true")
  await expect(crop).toHaveAttribute("aria-pressed", "true")
  await expect(cards).toHaveCount(productCount)
  expect(await titles()).toEqual(featuredTitles)
  await tee.click()
  await expect(cards).toHaveCount(1)
  await expect(cards).toHaveAccessibleName(cropTop.title)
  await expect(page.getByText("1 good thing to wear", { exact: true })).toBeVisible()
  if (test.info().project.name === "desktop-chromium") {
    const screenshot = testInfo.outputPath("desktop-crop-selected.png")
    await page.screenshot({ path: screenshot })
    await testInfo.attach("Desktop crop selection", { path: screenshot, contentType: "image/png" })
  }
  await crop.click()
  await expect(cards).toHaveCount(productCount)
  expect(await titles()).toEqual(featuredTitles)

  await sort.selectOption("newest")
  await expect(cards.first()).toHaveAccessibleName("Fixture Fresh Beta")
  const newestTitles = await titles()
  await crop.click()
  if (await filters.isVisible()) await filters.click()
  await page.getByRole("checkbox", { name: "M", exact: true }).check()
  await page.getByRole("checkbox", { name: "Clay", exact: true }).check()
  await expect(cards).toHaveCount(1)
  await expect(cards).toHaveAccessibleName(cropTop.title)
  if (await filters.isVisible()) await expect(filters).toHaveText("Filters (2) −")

  await page.getByRole("button", { name: "Clear all", exact: true }).click()
  await expect(crop).toHaveAttribute("aria-pressed", "false")
  await expect(page.getByRole("checkbox", { name: "M", exact: true })).not.toBeChecked()
  await expect(page.getByRole("checkbox", { name: "Clay", exact: true })).not.toBeChecked()
  await expect(cards).toHaveCount(productCount)
  await expect(sort).toHaveValue("newest")
  expect(await titles()).toEqual(newestTitles)

  await crop.click()
  await page.getByRole("checkbox", { name: "Black", exact: true }).check()
  await page.getByRole("checkbox", { name: "XL", exact: true }).check()
  await expect(cards).toHaveCount(0)
  await expect(page.getByText("0 good things to wear", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Clear filters", exact: true }).click()
  await expect(crop).toHaveAttribute("aria-pressed", "false")
  await expect(page.getByRole("checkbox", { name: "Black", exact: true })).not.toBeChecked()
  await expect(page.getByRole("checkbox", { name: "XL", exact: true })).not.toBeChecked()
  await expect(cards).toHaveCount(productCount)
  await expect(sort).toHaveValue("newest")
  expect(await titles()).toEqual(newestTitles)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("restores shareable category selections after reload and a product visit while preserving other URL values", async ({
  page,
}) => {
  await page.goto("/shop?campaign=send%20it&category=crop-tops&category=t-shirts#main-content")
  const tee = page.getByRole("button", { name: "T-shirts", exact: true })
  const crop = page.getByRole("button", { name: "Crop tops", exact: true })
  const cards = page.getByRole("article")
  const filters = page.getByRole("button", { name: /^Filters/ })

  await expect(tee).toHaveAttribute("aria-pressed", "true")
  await expect(crop).toHaveAttribute("aria-pressed", "true")
  await expect(cards).toHaveCount(productCount)
  const historyLength = await page.evaluate(() => history.length)
  if (await filters.isVisible()) await expect(filters).toHaveText("Filters +")
  await page.reload()
  await expect(tee).toHaveAttribute("aria-pressed", "true")
  await expect(crop).toHaveAttribute("aria-pressed", "true")
  await expect(cards).toHaveCount(productCount)

  await tee.click()
  await expect(cards).toHaveCount(1)
  await expect(cards).toHaveAccessibleName(cropTop.title)
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.getAll("category").join(",") === "crop-tops" &&
      url.searchParams.get("campaign") === "send it" &&
      url.hash === "#main-content"
  )
  expect(await page.evaluate(() => history.length)).toBe(historyLength)

  await cards.getByRole("link").click()
  await expect(page).toHaveURL((url) => url.pathname === `/shop/${cropTop.id}`)
  await expect(page.getByRole("heading", { name: cropTop.title, exact: true })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/shop" &&
      url.searchParams.getAll("category").join(",") === "crop-tops" &&
      url.searchParams.get("campaign") === "send it" &&
      url.hash === "#main-content"
  )
  await expect(crop).toHaveAttribute("aria-pressed", "true")
  await expect(tee).toHaveAttribute("aria-pressed", "false")
  await expect(cards).toHaveCount(1)
  if (await filters.isVisible()) {
    await expect(filters).toHaveText("Filters +")
    await filters.click()
  }
  await page.getByRole("button", { name: "Clear all", exact: true }).click()
  await expect(page).toHaveURL(
    (url) =>
      !url.searchParams.has("category") &&
      url.searchParams.get("campaign") === "send it" &&
      url.hash === "#main-content"
  )
  await expect(tee).toHaveAttribute("aria-pressed", "false")
  await expect(crop).toHaveAttribute("aria-pressed", "false")
  await expect(cards).toHaveCount(productCount)

  await page.goto("/shop?category=retired&category=")
  await expect(tee).toHaveAttribute("aria-pressed", "false")
  await expect(crop).toHaveAttribute("aria-pressed", "false")
  await expect(cards).toHaveCount(productCount)
})

test("keeps category toggles reachable, visibly focused, and independent at 320 pixels", async ({
  page,
  browserName,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto("/shop")
  const tee = page.getByRole("button", { name: "T-shirts", exact: true })
  const crop = page.getByRole("button", { name: "Crop tops", exact: true })
  for (const button of [tee, crop]) {
    await expect(button).toBeVisible()
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  const tabKey = await beginKeyboardNavigation(page, browserName)
  for (let index = 0; index < 30 && !(await tee.evaluate((element) => element === document.activeElement)); index++) {
    await page.keyboard.press(tabKey)
  }
  await expect(tee).toBeFocused()
  await expect(tee).toBeInViewport()
  expect(
    await tee.evaluate((element) => {
      const style = getComputedStyle(element)
      return (style.outlineStyle !== "none" && style.outlineWidth !== "0px") || style.boxShadow !== "none"
    })
  ).toBe(true)
  await page.keyboard.press("Enter")
  await expect(tee).toHaveAttribute("aria-pressed", "true")
  await expect(crop).toHaveAttribute("aria-pressed", "false")
  await page.keyboard.press(tabKey)
  await expect(crop).toBeFocused()
  await expect(crop).toBeInViewport()
  await page.keyboard.press("Space")
  await expect(tee).toHaveAttribute("aria-pressed", "true")
  await expect(crop).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("article")).toHaveCount(productCount)
  await page.keyboard.press("Enter")
  await expect(crop).toHaveAttribute("aria-pressed", "false")
  await expect(tee).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("article")).toHaveCount(productCount - 1)
  await page.keyboard.press(`Shift+${tabKey}`)
  await expect(tee).toBeFocused()
  await page.keyboard.press("Space")
  await expect(tee).toHaveAttribute("aria-pressed", "false")
  await expect(page.getByRole("article")).toHaveCount(productCount)
  await page.keyboard.press(tabKey)
  await page.keyboard.press("Enter")
  await expect(crop).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("article")).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  if (test.info().project.name === "desktop-chromium") {
    const screenshot = testInfo.outputPath("mobile-320-crop-selected.png")
    await page.screenshot({ path: screenshot })
    await testInfo.attach("Mobile crop selection at 320 pixels", { path: screenshot, contentType: "image/png" })
  }
})
