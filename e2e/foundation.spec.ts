import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { beginKeyboardNavigation } from "../test/begin-keyboard-navigation"

test("shows the branded landing page without accessibility violations or horizontal overflow", async ({
  page,
  browserName,
}) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  const response = await page.goto("/")

  expect(response?.status()).toBe(200)
  await expect(
    page.getByRole("heading", { name: "Your next favorite starts here.", exact: true, level: 1 })
  ).toBeVisible()
  const shopLink = page.getByRole("link", { name: "Shop", exact: true })
  await expect(shopLink).toBeVisible()
  await expect(shopLink).toHaveAttribute("href", "/shop")
  await expect(page).toHaveTitle(/Fixture Store/)
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /\S+/)
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Fixture Store/)

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

test("returns a real 404 and offers keyboard navigation home", async ({ page, browserName }) => {
  const response = await page.goto("/this-route-does-not-exist")

  expect(response?.status()).toBe(404)
  await expect(page.getByRole("heading", { name: "This page has wandered off." })).toBeVisible()

  const homeLink = page.getByRole("link", { name: "Back to home", exact: true })
  await expect(homeLink).toHaveAttribute("href", "/")
  const tabKey = await beginKeyboardNavigation(page, browserName)
  await expect(page.getByRole("link", { name: "Skip to content", exact: true })).toBeFocused()
  for (
    let step = 0;
    step < 12 && !(await homeLink.evaluate((element) => element === document.activeElement));
    step += 1
  )
    await page.keyboard.press(tabKey)
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

test("provides a lightweight health endpoint", async ({ request }) => {
  const response = await request.get("/api/health")

  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toContain("application/json")
  expect(await response.json()).toEqual({ status: "ok" })
})
