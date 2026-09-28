import { expect, test as base } from "@playwright/test"

import { beginKeyboardNavigation } from "../test/begin-keyboard-navigation"

type Call = { args: unknown[]; url: string; referrer: string }
const origin = `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_FIXTURE_PORT ?? 3200)}`
const sessionId = "cs_live_googlebrowserfixture"
const consentKey = "your-store-google-consent-v1"
const purchase = {
  transaction_id: "b".repeat(64),
  currency: "USD",
  value: 30,
  shipping: 4.95,
  tax: 2.8,
  items: [{ item_id: "abcdef0123456789abcdef01-12345", price: 30, quantity: 1 }],
}
const test = base.extend<{ google: { calls: Call[]; requests: string[] } }>({
  google: async ({ context }, runFixture) => {
    const calls: Call[] = []
    const requests: string[] = []
    const unexpected: string[] = []
    await context.exposeBinding("captureGoogle", (_source, call: Call) => calls.push(call))
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url())
      if (url.href === "https://www.googletagmanager.com/gtag/js?id=GT-TEST1234") {
        requests.push(url.href)
        expect(route.request().headers().referer).toBeUndefined()
        return route.fulfill({
          contentType: "text/javascript",
          body: `(() => {
          const queue = window.dataLayer;
          const capture = args => window.captureGoogle({args: Array.from(args), url: location.href, referrer: document.referrer});
          queue.splice(0).forEach(capture);
          queue.push = (...entries) => { entries.forEach(capture); return 0; };
        })();`,
        })
      }
      if (url.origin === origin) {
        if (url.pathname === "/api/analytics/google-config")
          return route.fulfill({ json: { enabled: true, tagId: "GT-TEST1234", canonicalOrigin: origin } })
        if (url.pathname === "/api/analytics/meta-config")
          return route.fulfill({ json: { enabled: false, pixelId: "", canonicalOrigin: origin } })
        if (url.pathname.startsWith("/_vercel/insights/"))
          return route.fulfill({ contentType: "text/javascript", body: "" })
        return route.continue()
      }
      if (["https://e2e.test", "https://fixture.public.blob.vercel-storage.com"].includes(url.origin))
        return route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
        })
      unexpected.push(url.origin)
      return route.abort()
    })
    await runFixture({ calls, requests })
    expect(unexpected).toEqual([])
  },
})
test.use({ baseURL: origin })

test("privacy disclosure waits for enabled runtime configuration and remains visible after declining", async ({
  page,
  google,
  browserName,
}, testInfo) => {
  let release = () => {}
  const configurationReady = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/analytics/google-config", async (route) => {
    await configurationReady
    await route.fulfill({ json: { enabled: true, tagId: "GT-TEST1234", canonicalOrigin: origin } })
  })
  try {
    const requested = page.waitForRequest("**/api/analytics/google-config")
    await page.goto("/privacy")
    await requested
    const disclosure = page.getByRole("heading", { name: "Optional Google marketing cookies" })
    await expect(disclosure).toHaveCount(0)
    release()
    await expect(disclosure).toBeVisible()
    await expect(page.getByRole("link", { name: "Google’s privacy policy" })).toBeVisible()
    expect(google.requests).toEqual([])
    await page.getByRole("button", { name: "Decline Google", exact: true }).click()
    await expect(disclosure).toBeVisible()
    await expect(page.getByRole("heading", { name: "Optional Meta marketing cookies" })).toHaveCount(0)
    const tabKey = await beginKeyboardNavigation(page, browserName)
    const policyLink = page.getByRole("link", { name: "Google’s privacy policy" })
    await policyLink.focus()
    await page.keyboard.press(tabKey)
    const cookieLink = page.getByRole("link", { name: "cookie policy", exact: true })
    await expect(cookieLink).toBeFocused()
    await expect(cookieLink).toHaveCSS("outline-style", "solid")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath("google-privacy-disclosure.png"), fullPage: true })
    expect(google.requests).toEqual([])
  } finally {
    release()
  }
})

for (const state of ["disabled", "unavailable", "invalid", "wrong-origin"] as const)
  test(`privacy disclosure stays hidden when Google configuration is ${state}`, async ({ context, page, google }) => {
    await context.addInitScript((key) => {
      localStorage.setItem(key, JSON.stringify({ consent: "granted", expiresAt: Date.now() + 60000 }))
    }, consentKey)
    await page.route("**/api/analytics/google-config", (route) =>
      route.fulfill({
        status: state === "unavailable" ? 503 : 200,
        json: {
          enabled: state !== "disabled",
          tagId: state === "invalid" ? "invalid-tag" : "GT-TEST1234",
          canonicalOrigin: state === "wrong-origin" ? "https://another-store.example" : origin,
        },
      })
    )
    const configured = page.waitForResponse("**/api/analytics/google-config")
    await page.goto("/privacy")
    await configured
    await expect(page.getByRole("heading", { name: "Privacy", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Optional Google marketing cookies" })).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Google’s privacy policy" })).toHaveCount(0)
    expect(google.requests).toEqual([])
  })

test("Google has a separate keyboard-accessible choice and respects withdrawal", async ({
  context,
  page,
  google,
  browserName,
}) => {
  await context.addInitScript(() =>
    localStorage.setItem(
      "your-store-meta-consent-v1",
      JSON.stringify({ consent: "granted", expiresAt: Date.now() + 60000 })
    )
  )
  await page.goto("/privacy")
  const allow = page.getByRole("button", { name: "Allow Google marketing cookies" })
  await expect(allow).toBeVisible()
  expect(google.requests).toEqual([])
  await beginKeyboardNavigation(page, browserName)
  await allow.focus()
  await expect(allow).toBeFocused()
  await expect(allow).toHaveCSS("outline-style", "solid")
  await page.keyboard.press("Enter")
  await expect.poll(() => google.calls.filter((call) => call.args[1] === "page_view")).toHaveLength(1)
  await page.getByRole("button", { name: "Privacy choices", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Your privacy choices" })).toBeFocused()
  await page.getByRole("button", { name: "Decline Google", exact: true }).click()
  await expect(page.getByRole("button", { name: "Privacy choices", exact: true })).toBeFocused()
  await page.reload()
  await expect(page.getByRole("button", { name: "Privacy choices", exact: true })).toBeVisible()
  expect(google.requests).toHaveLength(1)
})

test("both services have named groups and independent keyboard choices", async ({
  page,
  google,
  browserName,
}, testInfo) => {
  await page.route("**/api/analytics/meta-config", (route) =>
    route.fulfill({ json: { enabled: true, pixelId: "123456789012345", canonicalOrigin: origin } })
  )
  await page.goto("/privacy")
  const metaGroup = page.getByRole("group", { name: "Meta marketing cookies" })
  const googleGroup = page.getByRole("group", { name: "Google marketing cookies" })
  await expect(metaGroup).toBeVisible()
  await expect(googleGroup).toContainText("advertising and analytics cookies")
  await expect(googleGroup).toContainText("Personalized advertising stays off.")
  await expect(page.getByRole("button", { name: "Decline", exact: true })).toHaveCount(0)
  const tabKey = await beginKeyboardNavigation(page, browserName)
  await metaGroup.getByRole("button", { name: "Allow Meta marketing cookies" }).focus()
  await page.keyboard.press(tabKey)
  const declineMeta = metaGroup.getByRole("button", { name: "Decline Meta", exact: true })
  await expect(declineMeta).toBeFocused()
  await expect(declineMeta).toHaveCSS("outline-style", "solid")
  await page.keyboard.press("Enter")
  await expect(metaGroup).toContainText("Meta marketing cookies are currently off.")
  await expect(googleGroup).toContainText("Google marketing cookies stay off until you allow them.")
  expect(google.requests).toEqual([])
  expect(await page.evaluate((key) => localStorage.getItem(key), consentKey)).toBeNull()
  await googleGroup.getByRole("link", { name: "privacy policy" }).focus()
  await page.keyboard.press(tabKey)
  const allowGoogle = googleGroup.getByRole("button", { name: "Allow Google marketing cookies" })
  await expect(allowGoogle).toBeFocused()
  await expect(allowGoogle).toHaveCSS("outline-style", "solid")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath("separate-marketing-choices.png"), fullPage: true })
  await page.keyboard.press("Enter")
  await expect(page.getByRole("region", { name: "Your privacy choices" })).toHaveCount(0)
  await expect.poll(() => google.calls.filter((call) => call.args[1] === "page_view")).toHaveLength(1)
  expect(google.calls.find((call) => call.args[0] === "consent" && call.args[1] === "update")?.args[2]).toEqual({
    ad_storage: "granted",
    analytics_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "denied",
  })
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("your-store-meta-consent-v1") ?? "null"))
  ).toMatchObject({ consent: "denied" })
})

test("a return visit is counted after re-granting without replaying pages visited while declined", async ({
  page,
  google,
}) => {
  await page.goto("/privacy")
  await page.getByRole("button", { name: "Allow Google marketing cookies" }).click()
  await expect.poll(() => google.calls.filter((call) => call.args[1] === "page_view")).toHaveLength(1)
  await page.getByRole("button", { name: "Privacy choices", exact: true }).click()
  await page.getByRole("button", { name: "Decline Google", exact: true }).click()
  await page.getByRole("link", { name: "Shipping & care", exact: true }).click()
  await expect(page).toHaveURL(`${origin}/shipping`)
  await page.getByRole("link", { name: "Privacy", exact: true }).click()
  await expect(page).toHaveURL(`${origin}/privacy`)
  expect(google.calls.filter((call) => call.args[1] === "page_view")).toHaveLength(1)
  await page.getByRole("button", { name: "Privacy choices", exact: true }).click()
  await page.getByRole("button", { name: "Allow Google marketing cookies" }).click()
  await expect.poll(() => google.calls.filter((call) => call.args[1] === "page_view")).toHaveLength(2)
  for (const call of google.calls.filter((call) => call.args[1] === "page_view"))
    expect(call.args[2]).toMatchObject({ page_location: `${origin}/privacy` })
})

test("a paid purchase waits for opt-in, uses clean checkout ingress and survives reload without duplication", async ({
  page,
  google,
}) => {
  await page.route("**/api/checkout/status?*", (route) =>
    route.fulfill({ json: { paymentStatus: "paid", fulfillmentStatus: "submitted", googlePurchase: purchase } })
  )
  await page.goto(`/checkout/success?session_id=${sessionId}`)
  await expect(page).toHaveURL(`${origin}/checkout/success`)
  await expect(page.getByRole("heading", { name: "Your order is confirmed." })).toBeVisible()
  expect(google.requests).toEqual([])
  await page.getByRole("button", { name: "Allow Google marketing cookies" }).click()
  await expect.poll(() => google.calls.filter((call) => call.args[1] === "purchase")).toHaveLength(1)
  expect(google.calls.find((call) => call.args[1] === "purchase")?.args[2]).toMatchObject(purchase)
  for (const call of google.calls) {
    expect(call.url).not.toContain(sessionId)
    expect(call.referrer).not.toContain(sessionId)
    expect(JSON.stringify(call.args)).not.toContain(sessionId)
  }
  await page.reload()
  await expect(page.getByRole("heading", { name: "Your order is confirmed." })).toBeVisible()
  expect(google.calls.filter((call) => call.args[1] === "purchase")).toHaveLength(1)
})

for (const kind of ["pending", "simulated", "reversed"] as const)
  test(`never reports ${kind} payments`, async ({ context, page, google }) => {
    await context.addInitScript(
      (key) => localStorage.setItem(key, JSON.stringify({ consent: "granted", expiresAt: Date.now() + 60000 })),
      consentKey
    )
    await page.route("**/api/checkout/status?*", (route) =>
      route.fulfill({
        json: {
          paymentStatus: kind === "pending" ? "pending" : "paid",
          fulfillmentStatus: kind === "simulated" ? "simulated" : "pending",
          googlePurchase: kind === "reversed" ? null : purchase,
        },
      })
    )
    await page.goto(`/checkout/success?session_id=${sessionId}`)
    await expect(page).toHaveURL(`${origin}/checkout/success`)
    await expect.poll(() => google.calls.some((call) => call.args[0] === "config")).toBe(true)
    expect(google.calls.filter((call) => call.args[1] === "purchase")).toEqual([])
  })

test("GPC suppresses the Google SDK and disables granting", async ({ context, page, google }) => {
  await context.addInitScript(() => Object.defineProperty(navigator, "globalPrivacyControl", { value: true }))
  await page.goto("/privacy")
  await expect(page.getByRole("heading", { name: "Optional Google marketing cookies" })).toBeVisible()
  await page.getByRole("button", { name: "Privacy choices", exact: true }).click()
  await expect(page.getByRole("button", { name: "Allow Google marketing cookies" })).toBeDisabled()
  expect(google.requests).toEqual([])
})
