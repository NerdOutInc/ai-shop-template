import { expect, test, type BrowserContext, type Page } from "@playwright/test"

const origin = `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_FIXTURE_PORT ?? 3200)}`
const googleScript = "https://www.googletagmanager.com/gtag/js?id=GT-TEST1234"
const metaScript = "https://connect.facebook.net/en_US/fbevents.js"
type ConfigurationState = "enabled" | "disabled" | "http-error" | "malformed" | "network-error"

test.use({ baseURL: origin })

async function interceptTracking(
  context: BrowserContext,
  states: { google: ConfigurationState; meta: ConfigurationState },
  ready: Promise<void> = Promise.resolve()
) {
  const remoteRequests: string[] = []
  const configurationRequests: string[] = []
  await context.addInitScript(() => {
    for (const service of ["google", "meta"])
      localStorage.setItem(
        `your-store-${service}-consent-v1`,
        JSON.stringify({ consent: "granted", expiresAt: Date.now() + 60_000 })
      )
  })
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) {
      remoteRequests.push(url.href)
      if (url.href === googleScript) return route.fulfill({ contentType: "text/javascript", body: "" })
      if (url.href === metaScript)
        return route.fulfill({
          contentType: "text/javascript",
          body: "window.fbq.callMethod = () => {}; window.fbq.queue.length = 0;",
        })
      return route.abort()
    }
    const service =
      url.pathname === "/api/analytics/google-config"
        ? "google"
        : url.pathname === "/api/analytics/meta-config"
          ? "meta"
          : null
    if (service) {
      configurationRequests.push(service)
      await ready
      const state = states[service]
      if (state === "network-error") return route.abort()
      return route.fulfill({
        status: state === "http-error" ? 503 : 200,
        json: {
          // Keep a valid ID even when disabled: the enabled switch must independently gate the SDK.
          enabled: state === "malformed" ? "true" : state === "enabled",
          canonicalOrigin: origin,
          ...(service === "google" ? { tagId: "GT-TEST1234" } : { pixelId: "123456789012345" }),
        },
      })
    }
    if (url.pathname.startsWith("/_vercel/insights/"))
      return route.fulfill({ contentType: "text/javascript", body: "" })
    return route.continue()
  })
  return { remoteRequests, configurationRequests }
}

async function expectRemoteResources(page: Page, expected: string[]) {
  // Inspect tags as well as requests, catching resource hints even when the browser never fetches them.
  const remoteResources = await page
    .locator('script[src], link[rel="preconnect"], link[rel="dns-prefetch"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute("src") ?? node.getAttribute("href"))
        .filter((value): value is string => Boolean(value))
        .map((value) => new URL(value, location.href).href)
        .filter((value) => new URL(value).origin !== location.origin)
    )
  expect(remoteResources.sort()).toEqual([...expected].sort())
}

// Gives the page half a second to act on what it has already received, so a check that nothing else happened means
// something. waitForLoadState("networkidle") cannot: it resolves at once for a document that has already been quiet
// for half a second, and a slow browser can get there before hydration asks for measurement configuration.
async function settle(page: Page) {
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)))
}

for (const enabled of ["neither", "Google", "Meta", "both"] as const)
  test(`${enabled} enabled: each remote SDK independently respects its switch despite saved consent`, async ({
    context,
    page,
  }) => {
    const google = enabled === "Google" || enabled === "both"
    const meta = enabled === "Meta" || enabled === "both"
    const expected = [...(google ? [googleScript] : []), ...(meta ? [metaScript] : [])]
    const observed = await interceptTracking(context, {
      google: google ? "enabled" : "disabled",
      meta: meta ? "enabled" : "disabled",
    })
    await page.goto("/privacy")
    await expect.poll(() => [...observed.configurationRequests].sort()).toEqual(["google", "meta"])
    await expect.poll(() => [...observed.remoteRequests].sort()).toEqual([...expected].sort())
    await settle(page)
    expect(observed.configurationRequests.sort()).toEqual(["google", "meta"])
    expect(observed.remoteRequests.sort()).toEqual([...expected].sort())
    await expectRemoteResources(page, expected)

    await page.getByRole("link", { name: "Shipping & care", exact: true }).click()
    await expect(page).toHaveURL(`${origin}/shipping`)
    await page.getByRole("link", { name: "Privacy", exact: true }).click()
    await expect(page).toHaveURL(`${origin}/privacy`)
    await settle(page)
    expect(observed.remoteRequests.sort()).toEqual([...expected].sort())
    await expectRemoteResources(page, expected)

    await page.reload()
    await expect.poll(() => [...observed.configurationRequests].sort()).toEqual(["google", "google", "meta", "meta"])
    await expect.poll(() => [...observed.remoteRequests].sort()).toEqual([...expected, ...expected].sort())
    await settle(page)
    expect(observed.remoteRequests.sort()).toEqual([...expected, ...expected].sort())
    await expectRemoteResources(page, expected)
  })

for (const state of ["http-error", "malformed", "network-error"] as const)
  test(`${state} configuration cannot load either SDK despite saved consent`, async ({ context, page }) => {
    const observed = await interceptTracking(context, { google: state, meta: state })
    await page.goto("/privacy")
    await expect.poll(() => [...observed.configurationRequests].sort()).toEqual(["google", "meta"])
    await settle(page)
    expect(observed.configurationRequests.sort()).toEqual(["google", "meta"])
    expect(observed.remoteRequests).toEqual([])
    await expectRemoteResources(page, [])
    await expect(page.getByRole("heading", { name: /Optional (Google|Meta)/ })).toHaveCount(0)
  })

test("neither SDK loads before runtime configuration arrives", async ({ context, page }) => {
  let release = () => {}
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  const observed = await interceptTracking(context, { google: "disabled", meta: "disabled" }, ready)
  try {
    await page.goto("/privacy")
    await expect.poll(() => observed.configurationRequests.length).toBe(2)
    expect(observed.remoteRequests).toEqual([])
    await expectRemoteResources(page, [])
    release()
    await settle(page)
    expect(observed.remoteRequests).toEqual([])
    await expectRemoteResources(page, [])
  } finally {
    release()
  }
})
