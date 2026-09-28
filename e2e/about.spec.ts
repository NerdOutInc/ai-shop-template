import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { storeConfig } from "../test/store-config"
import { beginKeyboardNavigation } from "../test/begin-keyboard-navigation"

test.describe("About social previews", () => {
  test.use({ javaScriptEnabled: false })

  test("serves the shared share image and social defaults with About-specific copy before hydration", async ({
    page,
    request,
  }) => {
    let sharedImage = ""
    for (const path of ["/", "/returns", "/about"]) {
      await page.goto(path)
      await expect(page.locator('head meta[property="og:site_name"]')).toHaveAttribute("content", "Fixture Store")
      await expect(page.locator('head meta[property="og:type"]')).toHaveAttribute("content", "website")
      await expect(page.locator('head meta[property="og:locale"]')).toHaveAttribute("content", "en_US")
      await expect(page.locator('head meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image")
      const image = page.locator('head meta[property="og:image"]')
      await expect(image).toHaveAttribute("content", /^https:\/\/example\.com\/opengraph-image(?:\?|$)/)
      if (path === "/") sharedImage = (await image.getAttribute("content"))!
      await expect(image).toHaveAttribute("content", sharedImage)
      await expect(page.locator('head meta[property="og:image:width"]')).toHaveAttribute("content", "1200")
      await expect(page.locator('head meta[property="og:image:height"]')).toHaveAttribute("content", "630")
      await expect(page.locator('head meta[property="og:image:alt"]')).toHaveAttribute("content", /Fixture Store/)
      await expect(page.locator('head meta[name="twitter:image"]')).toHaveAttribute("content", sharedImage)
      await expect(page.locator('head meta[name="twitter:image:alt"]')).toHaveAttribute("content", /Fixture Store/)
    }
    for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]'])
      await expect(page.locator(selector)).toHaveAttribute("content", "About | Fixture Store")
    const description = await page.locator('meta[name="description"]').getAttribute("content")
    expect(description).toBeTruthy()
    for (const selector of ['meta[property="og:description"]', 'meta[name="twitter:description"]'])
      await expect(page.locator(selector)).toHaveAttribute("content", description!)
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", "https://example.com/about")
    const imageUrl = new URL(sharedImage)
    const response = await request.get(`${imageUrl.pathname}${imageUrl.search}`)
    expect(response.ok()).toBe(true)
    expect(response.headers()["content-type"]).toContain("image/png")
  })
})

test("opens About from the header by keyboard and connects the story to the shop", async ({ page, browserName }) => {
  await page.goto("/")
  const navigation = page.getByRole("navigation", { name: "Primary navigation" })
  await expect(navigation.getByRole("link")).toHaveText(["About", "Shop", "Cart"])
  const about = navigation.getByRole("link", { name: "About", exact: true })
  const tabKey = await beginKeyboardNavigation(page, browserName)
  for (let step = 0; step < 5 && !(await about.evaluate((element) => element === document.activeElement)); step++)
    await page.keyboard.press(tabKey)
  await expect(about).toBeFocused()
  expect(await about.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL("/about")
  await expect(about).toHaveAttribute("aria-current", "page")
  await expect(navigation.getByRole("link", { name: "Shop", exact: true })).not.toHaveAttribute("aria-current")
  await expect(page).toHaveTitle("About | Fixture Store")
  const main = page.getByRole("main")
  await expect(main.getByRole("heading", { level: 1, name: "About Fixture Store" })).toBeVisible()
  await expect(main.getByRole("link", { name: "support@fixture.example" })).toHaveCount(0)
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([])
  await main.getByRole("link", { name: storeConfig.home.shopLabel }).click()
  await expect(page).toHaveURL("/shop")
})

test("keeps About immediately left of Shop at the narrowest supported width", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto("/about")
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://example.com/about")
  const navigation = page.getByRole("navigation", { name: "Primary navigation" })
  const about = await navigation.getByRole("link", { name: "About", exact: true }).boundingBox()
  const shop = await navigation.getByRole("link", { name: "Shop", exact: true }).boundingBox()
  expect(about).not.toBeNull()
  expect(shop).not.toBeNull()
  expect(about!.x + about!.width).toBeLessThan(shop!.x)
  expect(about!.y).toBe(shop!.y)
  await expect(navigation.getByRole("link", { name: "Cart, 0 items" })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
