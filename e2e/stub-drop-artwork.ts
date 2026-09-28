import type { Page } from "@playwright/test"

import { designOfTheWeekDrop } from "./design-of-the-week-drop"

/**
 * Serve the drop's frozen artwork locally.
 *
 * The fixture pins a real public Blob URL because `catalogProductSchema` discards artwork on any
 * other host, so every page that renders one of the drop's cards would otherwise make a genuine
 * outbound request — which the tracking specs correctly flag as unexpected network traffic.
 */
export async function stubDropArtwork(page: Page) {
  await page.route(new URL(designOfTheWeekDrop.artwork.src).origin + "/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 94 120"><rect width="94" height="120" fill="#17262d"/></svg>',
    })
  )
}
