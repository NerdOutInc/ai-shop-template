import { expect, test } from "@playwright/test"

test("does not show a section focus ring when opening a campaign link", async ({ page }) => {
  await page.goto("/?utm_source=newsletter#design-of-the-week")
  await page.waitForLoadState("networkidle")

  const section = page.locator("#design-of-the-week")
  await expect(section).toBeInViewport()
  expect(await section.evaluate((element) => element.matches(":focus-visible"))).toBe(false)
})

test("does not show a section focus ring when a tap on the footer link moves focus there", async ({ page }) => {
  for (const path of ["/", "/shipping"]) {
    await page.goto(path)
    // Safari does not focus a tapped link, so moving focus to the section from script counts as visible.
    // A click event that leaves focus where it was gives every engine that same starting point.
    await page.getByRole("contentinfo").getByRole("link", { name: "Design of the week" }).dispatchEvent("click")
    const section = page.locator("#design-of-the-week")
    await expect(section).toBeFocused()
    expect(await section.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("none")
  }
})

test.describe("configured sender-disabled fixture", () => {
  test.use({ baseURL: `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_FIXTURE_PORT ?? 3200)}` })

  test("does not invite signup before or after hydration when its sender is disabled", async ({ page }) => {
    let releaseScripts!: () => void
    const scriptsReleased = new Promise<void>((resolve) => {
      releaseScripts = resolve
    })
    await page.route("**/_next/static/**/*.js", async (route) => {
      await scriptsReleased
      await route.continue()
    })
    try {
      await page.goto("/#design-of-the-week", { waitUntil: "commit" })
      const field = page.getByRole("textbox", { name: "Know when the next one drops" })
      await expect(field).toHaveCount(0)
      releaseScripts()
      await page.waitForLoadState("networkidle")
      await expect(field).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Keep me posted" })).toHaveCount(0)
    } finally {
      releaseScripts()
    }
  })
})
