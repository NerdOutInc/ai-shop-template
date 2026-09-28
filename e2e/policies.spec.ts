import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { beginKeyboardNavigation } from "../test/begin-keyboard-navigation"

test("makes draft policies reachable without publishing placeholder support details", async ({ page, browserName }) => {
  await page.goto("/")
  const footer = page.getByRole("contentinfo")
  const help = footer.getByRole("link", { name: "Returns & order help" })
  const tabKey = await beginKeyboardNavigation(page, browserName)
  for (let step = 0; step < 30 && !(await help.evaluate((element) => element === document.activeElement)); step++)
    await page.keyboard.press(tabKey)
  await expect(help).toBeFocused()
  expect(await help.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL("/returns")

  const main = page.getByRole("main")
  await expect(main.getByRole("heading", { level: 1, name: "Returns & order help" })).toBeVisible()
  await expect(main).toContainText("preparing its policies")
  await expect(main.getByRole("link", { name: "support@fixture.example" })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([])
  for (const [label, target] of [
    ["Shipping & care", "/shipping"],
    ["Privacy", "/privacy"],
  ]) {
    await footer.getByRole("link", { name: label!, exact: true }).click()
    await expect(page).toHaveURL(target!)
    await expect(main).toContainText("preparing its policies")
    await expect(main.getByRole("link", { name: "support@fixture.example" })).toHaveCount(0)
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0)
  }
})
