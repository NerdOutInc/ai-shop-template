import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { beginKeyboardNavigation } from "../test/begin-keyboard-navigation"

test("shows a useful first-collection placeholder without credentials, accessibility violations, or overflow", async ({
  page,
  browserName,
}) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  const response = await page.goto("/shop")

  expect(response?.status()).toBe(200)
  await expect(page.getByRole("heading", { name: "Shop the collection", exact: true, level: 1 })).toBeVisible()
  await expect(page.getByText("Our first collection is on its way. Check back soon.", { exact: true })).toBeVisible()
  await expect(page).toHaveTitle("Shop | Fixture Store")
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /\S+/)
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Fixture Store/)
  await expect(page.getByRole("main")).toHaveAttribute("id", "main-content")

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([])
  expect(pageErrors).toEqual([])

  await beginKeyboardNavigation(page, browserName)
  const skipLink = page.getByRole("link", { name: "Skip to content", exact: true })
  await expect(skipLink).toBeFocused()
  await expect(skipLink).toBeInViewport()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("main")).toBeFocused()
})

test("provides keyboard navigation from home to the shop and back with visible focus", async ({
  page,
  browserName,
}) => {
  await page.goto("/")

  const navigation = page.getByRole("navigation", { name: "Primary navigation" })
  const homeTabKey = await beginKeyboardNavigation(page, browserName)
  await expect(page.getByRole("link", { name: "Skip to content", exact: true })).toBeFocused()
  await page.keyboard.press(homeTabKey)
  await expect(page.getByRole("link", { name: "Fixture Store home", exact: true })).toBeFocused()
  for (const name of ["About", "Shop"]) {
    const link = navigation.getByRole("link", { name, exact: true })
    await page.keyboard.press(homeTabKey)
    await expect(link).toBeFocused()
    expect(
      await link.evaluate((element) => {
        const style = getComputedStyle(element)
        return (style.outlineStyle !== "none" && style.outlineWidth !== "0px") || style.boxShadow !== "none"
      })
    ).toBe(true)
  }
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL("/shop")
  await expect(page.getByRole("heading", { name: "Shop the collection", exact: true, level: 1 })).toBeVisible()

  await page.reload()
  const homeLink = page.getByRole("link", { name: "Fixture Store home", exact: true })
  await expect(homeLink).toHaveAttribute("href", "/")
  const shopTabKey = await beginKeyboardNavigation(page, browserName)
  await expect(page.getByRole("link", { name: "Skip to content", exact: true })).toBeFocused()
  await page.keyboard.press(shopTabKey)
  await expect(homeLink).toBeFocused()
  expect(
    await homeLink.evaluate((element) => {
      const style = getComputedStyle(element)
      return (style.outlineStyle !== "none" && style.outlineWidth !== "0px") || style.boxShadow !== "none"
    })
  ).toBe(true)
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL("/")
  await expect(
    page.getByRole("heading", { name: "Your next favorite starts here.", exact: true, level: 1 })
  ).toBeVisible()
})
