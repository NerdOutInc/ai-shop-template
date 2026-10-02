import { test as base, expect } from "@playwright/test"

import { stubDropArtwork } from "../stub-drop-artwork"
import { commerceTestConfig as config } from "./test-config"

export const test = base.extend({
  page: async ({ page }, runTest) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text())
    })
    page.on("response", (response) => {
      if (response.url().startsWith(config.baseURL) && response.status() >= 500)
        errors.push(`${response.status()} ${response.url()}`)
    })
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url())
      if (url.origin === config.baseURL) return route.continue()
      errors.push(`Unexpected external browser request: ${url.origin}`)
      return route.abort()
    })
    await stubDropArtwork(page)
    await page.route("https://e2e.test/**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 700"><rect width="600" height="700" fill="#17262d"/></svg>',
      })
    )
    await page.route("**/_vercel/insights/**", (route) =>
      route.fulfill({ contentType: "application/javascript", body: "" })
    )
    await page.route("https://checkout.stripe.com/c/pay/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<html><title>Fixture checkout</title><h1>Fixture secure checkout</h1></html>",
      })
    )
    await runTest(page)
    expect(errors, "Unexpected storefront browser or server errors").toEqual([])
  },
})
