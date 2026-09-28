import { expect, test } from "@playwright/test"

import { beginKeyboardNavigation } from "../test/begin-keyboard-navigation"
import { catalogProducts } from "./catalog-products"
import { stubDropArtwork } from "./stub-drop-artwork"

const cropTop = catalogProducts.find((product) => product.blueprint_id === 1312)!

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

test("uses each product's configured garment for its header and search metadata", async ({ page }) => {
  for (const garment of [
    {
      product: catalogProducts[0]!,
      model: "Next Level 6210",
      type: "Unisex tee",
      title: "Fixture Good Hangs – T-Shirt | Your Store",
      description: /A unisex T-shirt from Your Store\.$/,
    },
    {
      product: cropTop,
      model: "Next Level 5080",
      type: "Women's crop top",
      title: "Fixture Festival Crop - Women's Festival Crop Top | Your Store",
      description: /A women's crop top from Your Store\.$/,
    },
  ]) {
    // Client navigation has its own SEO journey; this checks each product's published page response.
    const response = await page.goto(`/shop/${garment.product.id}`)
    expect(response?.status()).toBe(200)
    const options = page.getByRole("region", { name: "Product options" })
    const heading = options.getByRole("heading", { level: 1, name: garment.product.title, exact: true })
    const model = options.getByText(garment.model, { exact: true })
    await expect(heading).toBeVisible()
    await expect(model).toBeVisible()
    await expect(options.getByText(garment.type, { exact: true })).toBeVisible()
    expect((await model.boundingBox())!.y).toBeLessThan((await heading.boundingBox())!.y)
    await expect(page).toHaveTitle(garment.title)
    for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) {
      await expect(page.locator(selector)).toHaveAttribute("content", garment.title)
    }
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", garment.description)
    if (garment.product === cropTop) {
      await expect(options.getByText("Next Level 6210", { exact: true })).toHaveCount(0)
      await expect(options.getByText("Unisex tee", { exact: true })).toHaveCount(0)
      await expect(page.locator('meta[name="description"]')).not.toHaveAttribute("content", /T-shirt|unisex/i)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test("keeps crop-top labels and the size guide usable by keyboard at narrow width", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto(`/shop/${cropTop.id}`)
  await expect(page.getByText("Next Level 5080", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Women's crop top", { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  const fitButton = page.getByRole("button", { name: "Find your fit", exact: true })
  const tabKey = await beginKeyboardNavigation(page, browserName)
  for (
    let index = 0;
    index < 30 && !(await fitButton.evaluate((element) => element === document.activeElement));
    index++
  ) {
    await page.keyboard.press(tabKey)
  }
  await expect(fitButton).toBeFocused()
  await expect(fitButton).toBeInViewport()
  expect(
    await fitButton.evaluate((element) => {
      const style = getComputedStyle(element)
      return (style.outlineStyle !== "none" && style.outlineWidth !== "0px") || style.boxShadow !== "none"
    })
  ).toBe(true)
  await page.keyboard.press("Enter")
  await expect(page.getByText("Size guide", { exact: true })).toBeFocused()
  const sizeChart = page.getByRole("region", { name: "Size chart, scroll horizontally for more sizes" })
  await expect(sizeChart).toBeVisible()
  await expect(sizeChart.getByRole("row", { name: "Length, in 18 19", exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
