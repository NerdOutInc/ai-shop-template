import { expect, test } from "@playwright/test"

import { beginKeyboardNavigation } from "../test/begin-keyboard-navigation"
import { configuredStoreConfig } from "../test/configured-store-config"

const fixturePort = Number(process.env.PLAYWRIGHT_FIXTURE_PORT ?? 3200)
const offlinePort = Number(process.env.PLAYWRIGHT_PORT ?? 3100)

test("explains active signup data and keeps the manual removal contact keyboard accessible", async ({
  page,
  browserName,
}) => {
  await page.goto(`http://127.0.0.1:${fixturePort}/privacy`)
  const main = page.getByRole("main")
  await expect(main.getByRole("heading", { name: "Design-drop emails" })).toBeVisible()
  await expect(main).toContainText("signup IP address")
  await expect(main).toContainText("Signing up again renews consent")
  await expect(main).toContainText("Supabase")
  await expect(main).toContainText("Vercel")
  await expect(main).not.toContainText("Resend")
  const removal = main.getByRole("link", {
    name: `Email ${configuredStoreConfig.supportEmail} to request removal`,
  })
  await expect(removal).toHaveAttribute(
    "href",
    `mailto:${configuredStoreConfig.supportEmail}?subject=Remove%20me%20from%20design-drop%20emails`
  )
  await expect(main).toContainText("opening the email link does not remove an address automatically")
  await removal.focus()
  const tabKey = await beginKeyboardNavigation(page, browserName)
  await page.keyboard.press(tabKey === "Alt+Tab" ? "Alt+Shift+Tab" : "Shift+Tab")
  await expect(removal).toBeFocused()
  expect(await removal.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("keeps placeholder signup claims off an unconfigured privacy page", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${offlinePort}/privacy`)
  const main = page.getByRole("main")
  await expect(main.getByRole("heading", { name: "Design-drop emails" })).toHaveCount(0)
  await expect(main).not.toContainText("signup IP")
  await expect(main.getByRole("link", { name: /request removal/ })).toHaveCount(0)
})
