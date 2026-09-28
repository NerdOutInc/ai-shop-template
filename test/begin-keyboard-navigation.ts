import type { Page } from "@playwright/test"

export async function beginKeyboardNavigation(page: Page, browserName: string): Promise<"Tab" | "Alt+Tab"> {
  // macOS WebKit can Tab directly to a text field, skipping links/buttons. Option+Tab includes every control.
  const tabKey = browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab"
  await page.keyboard.press(tabKey)
  return tabKey
}
