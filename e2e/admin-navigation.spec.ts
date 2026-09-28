import { expect, test } from "@playwright/test"

for (const route of ["/admin", "/admin/not-a-real-route"]) {
  test(`disabled or unmatched ${route} keeps a hydrated storefront header`, async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    const response = await page.goto(route)
    await page.waitForLoadState("networkidle")
    expect(response?.status()).toBe(404)
    await expect(page.getByRole("heading", { name: "This page has wandered off." })).toBeVisible()
    const navigation = page.getByRole("navigation", { name: "Primary navigation" })
    await expect(navigation.getByRole("link", { name: "Shop", exact: true })).toBeVisible()
    await expect(navigation.getByRole("link", { name: "Designs", exact: true })).toHaveCount(0)
    await expect(navigation.getByRole("link", { name: "Products", exact: true })).toHaveCount(0)
    await expect(navigation.getByRole("link", { name: "Orders", exact: true })).toHaveCount(0)
    expect(errors).toEqual([])
  })
}
