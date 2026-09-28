import { readFile } from "node:fs/promises"
import { get } from "node:http"
import { expect, test } from "@playwright/test"
import { z } from "zod"

function regenerateWithoutUserAgent(url: URL, previewModeId: string) {
  return new Promise<{ status: number | undefined; cacheStatus: string | string[] | undefined }>((resolve, reject) => {
    // Node HTTP does not add a User-Agent; browser and Playwright request clients do.
    const request = get(url, { headers: { "x-prerender-revalidate": previewModeId } }, (response) => {
      response.on("error", reject)
      response.resume()
      response.on("end", () =>
        resolve({ status: response.statusCode, cacheStatus: response.headers["x-nextjs-cache"] })
      )
    })
    request.on("error", reject)
    request.setTimeout(10_000, () => request.destroy(new Error("Local metadata regeneration timed out")))
  })
}

test.beforeEach(async ({ page, browserName, baseURL }) => {
  if (!baseURL) throw new Error("Canonical navigation tests require a local baseURL")
  const origin = new URL(baseURL)
  if (origin.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(origin.hostname)) {
    throw new Error("Canonical navigation regeneration is restricted to a loopback HTTP server")
  }
  const manifest = z
    .object({ preview: z.object({ previewModeId: z.string().min(1) }) })
    .parse(JSON.parse(await readFile(new URL("../.next/prerender-manifest.json", import.meta.url), "utf8")))

  // Home renders the weekly catalog dynamically. Regenerate the static pages instead,
  // including About as an initial document so its hoisted metadata must hydrate before navigation.
  for (const path of ["/about", "/returns"]) {
    const response = await regenerateWithoutUserAgent(new URL(path, origin), manifest.preview.previewModeId)
    expect(response.status, `${path} regeneration status`).toBe(200)
    expect(response.cacheStatus, `${path} must regenerate rather than reuse its build artifact`).toBe("REVALIDATED")
  }

  if (browserName === "chromium") {
    // Keep the hydration race observable even on fast developer and CI machines.
    const session = await page.context().newCDPSession(page)
    await session.send("Emulation.setCPUThrottlingRate", { rate: 4 })
  }
})

for (const { from, path, navigation, label, title } of [
  { from: "/", path: "/about", navigation: "Primary navigation", label: "About", title: "About | Your Store" },
  {
    from: "/",
    path: "/returns",
    navigation: "Footer navigation",
    label: "Returns & order help",
    title: "Returns & order help | Your Store",
  },
  {
    from: "/about",
    path: "/returns",
    navigation: "Footer navigation",
    label: "Returns & order help",
    title: "Returns & order help | Your Store",
  },
]) {
  test(`replaces the canonical after fast client navigation from ${from} to ${path}`, async ({ page }) => {
    // Navigate as soon as the document is parsed: waiting for idle can hide metadata hydration races.
    await page.goto(from, { waitUntil: "domcontentloaded" })
    const initialDocument = await page.evaluateHandle(() => document)
    await page.getByRole("navigation", { name: navigation }).getByRole("link", { name: label, exact: true }).click()
    await expect(page).toHaveURL(path)
    expect(await page.evaluate((initial) => initial === document, initialDocument)).toBe(true)
    await expect(page).toHaveTitle(title)
    await expect(page.locator("title")).toHaveCount(1)
    await expect(page.locator('meta[name="description"]')).toHaveCount(1)

    // Count across the whole document, including metadata that Next may stream into the body.
    const canonical = page.locator('link[rel="canonical"]')
    await expect(canonical).toHaveCount(1)
    await expect(canonical).toHaveAttribute("href", `https://example.com${path}`)
    await expect(page.locator('head link[rel="canonical"]')).toHaveCount(1)

    await page.goBack()
    await expect(page).toHaveURL(from)
    await expect(canonical).toHaveCount(1)
    await expect(canonical).toHaveAttribute("href", `https://example.com${from === "/" ? "" : from}`)
    await page.goForward()
    await expect(page).toHaveURL(path)
    await expect(canonical).toHaveCount(1)
    await expect(canonical).toHaveAttribute("href", `https://example.com${path}`)
    await expect(page.locator("title")).toHaveCount(1)
    await expect(page).toHaveTitle(title)
    expect(await page.evaluate((initial) => initial === document, initialDocument)).toBe(true)
  })
}

for (const from of ["/", "/about"]) {
  test(`removes the canonical after navigating from ${from} to a utility page without one`, async ({ page }) => {
    await page.goto(from, { waitUntil: "domcontentloaded" })
    const initialDocument = await page.evaluateHandle(() => document)
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Cart, 0 items" })
      .click()
    await expect(page).toHaveURL("/cart")
    expect(await page.evaluate((initial) => initial === document, initialDocument)).toBe(true)
    await expect(page).toHaveTitle("Your cart | Your Store")
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow")
  })
}
