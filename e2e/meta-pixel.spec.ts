import { expect, test as base, type BrowserContext, type Page } from "@playwright/test"

import { selectedProductIds } from "./catalog-product-ids"

import { beginKeyboardNavigation } from "../test/begin-keyboard-navigation"
import { stubDropArtwork } from "./stub-drop-artwork"

type SdkCall = { args: unknown[]; url: string; referrer: string }
type PixelFixture = {
  calls: SdkCall[]
  requests: { url: string; referrer: string | undefined }[]
  holdScript: () => void
  releaseScript: () => void
}

const shopOrigin = `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_FIXTURE_PORT ?? 3200)}`
const productId = selectedProductIds[0]!
const pixelId = "123456789012345"
const consentKey = "your-store-meta-consent-v1"
const metaAttemptsKey = "your-store-meta-purchase-attempts-v1"
const vercelAttemptsKey = "your-store-purchase-attempts-v1"
const sessionId = "cs_live_metabrowserfixture"
const receipt = "a".repeat(64)
const purchase = {
  receipt,
  totalUsd: 36.95,
  items: [{ productId, variantId: 1004, quantity: 1, unitAmount: 3200 }],
}

// Replace the remote SDK, including its queued bootstrap commands. Capture the
// actual document fields an SDK can read; sanitized custom parameters alone are insufficient.
const sdkScript = `(() => {
  const fbq = window.fbq;
  if (!fbq) throw new Error("Missing Pixel bootstrap");
  fbq.callMethod = (...args) => {
    window.__captureMetaCall({ args, url: location.href, referrer: document.referrer });
  };
  const queue = fbq.queue.splice(0);
  queue.forEach(args => fbq.callMethod(...args));
})();`

const test = base.extend<{ pixel: PixelFixture }>({
  pixel: async ({ context }, runFixture) => {
    const calls: SdkCall[] = []
    const requests: PixelFixture["requests"] = []
    const unexpected: string[] = []
    let held = false
    const waiting: (() => void)[] = []
    const releaseScript = () => {
      held = false
      waiting.splice(0).forEach((resolve) => resolve())
    }
    await context.exposeBinding("__captureMetaCall", (_source, call: SdkCall) => calls.push(call))
    await context.route("**/*", async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (/(^|\.)(facebook\.com|facebook\.net|fbcdn\.net|meta\.com)$/.test(url.hostname)) {
        requests.push({ url: url.href, referrer: request.headers().referer })
        if (url.href === "https://connect.facebook.net/en_US/fbevents.js") {
          if (held) await new Promise<void>((resolve) => waiting.push(resolve))
          return route.fulfill({ contentType: "text/javascript", body: sdkScript })
        }
        unexpected.push(url.href)
        return route.abort()
      }
      if (url.origin === shopOrigin) {
        if (url.pathname === "/api/analytics/meta-config")
          return route.fulfill({ json: { enabled: true, pixelId, canonicalOrigin: shopOrigin } })
        if (url.pathname.startsWith("/_vercel/insights/"))
          return route.fulfill({ contentType: "text/javascript", body: "" })
        return route.continue()
      }
      if (url.origin === "https://e2e.test")
        return route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 700"><rect width="600" height="700" fill="#bc735c"/></svg>',
        })
      unexpected.push(url.href)
      return route.abort()
    })
    try {
      await runFixture({ calls, requests, holdScript: () => (held = true), releaseScript })
    } finally {
      releaseScript()
    }
    expect(unexpected).toEqual([])
  },
})

test.beforeEach(async ({ page }) => {
  await stubDropArtwork(page)
})

test.use({ baseURL: shopOrigin })

function events(pixel: PixelFixture, name?: string) {
  return pixel.calls.filter((call) => call.args[0] === "trackSingle" && (!name || call.args[2] === name))
}

async function seedConsent(context: BrowserContext, consent: "granted" | "denied") {
  await context.addInitScript(
    ({ key, consent }) => {
      if (localStorage.getItem(key) === null)
        localStorage.setItem(key, JSON.stringify({ consent, expiresAt: Date.now() + 60_000 }))
    },
    { key: consentKey, consent }
  )
}

async function selectVariant(page: Page) {
  await page.getByRole("button", { name: "Clay", exact: true }).click()
  await page.getByRole("button", { name: "XL", exact: true }).click()
}

function expectPrivateDocumentFields(pixel: PixelFixture, secrets: string[]) {
  expect(pixel.requests.every(({ referrer }) => referrer === undefined)).toBe(true)
  for (const call of pixel.calls) {
    const url = new URL(call.url)
    if (url.pathname === "/checkout/success" || url.pathname === "/checkout/meta") expect(url.search).toBe("")
    expect(
      [...url.searchParams.keys()].filter((key) =>
        ["session_id", "products", "coupon", "recovery_unavailable"].includes(key)
      )
    ).toEqual([])
    expect(call.referrer).toBe("")
  }
  for (const secret of secrets) expect(JSON.stringify(pixel.calls)).not.toContain(secret)
}

test("unknown and declined consent make no Meta requests; opt-in measures the current product", async ({
  page,
  pixel,
}, testInfo) => {
  await page.goto(`/shop/${productId}`)
  await expect(page.getByRole("heading", { name: "Your privacy choices" })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("privacy-choices-wide.png"), fullPage: true })
  expect(pixel.requests).toEqual([])
  await page.getByRole("button", { name: "Decline Meta", exact: true }).click()
  await selectVariant(page)
  expect(pixel.requests).toEqual([])
  expect(pixel.calls).toEqual([])

  await page.getByRole("button", { name: "Privacy choices", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Your privacy choices" })).toBeFocused()
  await page.setViewportSize({ width: 320, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath("privacy-choices-320px.png"), fullPage: true })
  const allow = page.getByRole("button", { name: "Allow Meta marketing cookies" })
  await allow.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("button", { name: "Privacy choices", exact: true })).toBeFocused()
  await expect.poll(() => events(pixel, "PageView")).toHaveLength(1)
  await expect.poll(() => events(pixel, "ViewContent")).toHaveLength(1)
  expect(events(pixel, "ViewContent")[0]!.args).toEqual([
    "trackSingle",
    pixelId,
    "ViewContent",
    { content_type: "product_group", content_ids: [productId] },
  ])
  await page.getByRole("button", { name: "Black", exact: true }).click()
  await page.getByRole("button", { name: "M", exact: true }).click()
  expect(events(pixel, "ViewContent")).toHaveLength(1)
  expect(pixel.requests).toEqual([{ url: "https://connect.facebook.net/en_US/fbevents.js", referrer: undefined }])
})

for (const pathname of ["/admin/setup", "/admin/sign-in"]) {
  test(`saved consent cannot load Meta on ${pathname}`, async ({ context, page, pixel }) => {
    await seedConsent(context, "granted")
    await page.goto("/shop")
    await expect.poll(() => events(pixel, "PageView")).toHaveLength(1)
    expect(pixel.requests).toHaveLength(1)

    await page.goto(pathname)
    await expect(page).toHaveURL(`${shopOrigin}${pathname}`)
    // This control only renders after runtime configuration has reached the consent manager.
    await expect(page.getByRole("button", { name: "Privacy choices", exact: true })).toBeVisible()
    expect(pixel.requests).toHaveLength(1)
    expect(events(pixel, "PageView")).toHaveLength(1)
    expect(pixel.calls.every((call) => !new URL(call.url).pathname.startsWith("/admin"))).toBe(true)
  })
}

test("cart and checkout events follow successful actions with exact catalog variant IDs", async ({
  context,
  page,
  pixel,
}) => {
  await seedConsent(context, "granted")
  const stripeUrl = "https://checkout.stripe.com/c/pay/meta-browser-fixture"
  let checkoutRequests = 0
  await page.route("**/api/checkout", (route) => {
    checkoutRequests += 1
    return checkoutRequests === 1
      ? route.fulfill({ status: 503, json: { code: "NOT_CONFIGURED" } })
      : route.fulfill({ json: { url: stripeUrl, sessionId } })
  })
  await page.route(stripeUrl, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<title>Offline Stripe fixture</title><link rel="icon" href="data:,">',
    })
  )
  await page.goto(`/shop/${productId}`)
  await expect.poll(() => events(pixel, "ViewContent")).toHaveLength(1)
  await selectVariant(page)
  expect(events(pixel, "AddToCart")).toEqual([])
  await page.getByRole("button", { name: "Add to cart", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "Added to cart" })).toBeVisible()
  await expect.poll(() => events(pixel, "AddToCart")).toHaveLength(1)
  const parameters = {
    content_type: "product",
    content_ids: [`${productId}-1004`],
    contents: [{ id: `${productId}-1004`, quantity: 1, item_price: 32 }],
    currency: "USD",
    value: 32,
    num_items: 1,
  }
  expect(events(pixel, "AddToCart")[0]!.args).toEqual(["trackSingle", pixelId, "AddToCart", parameters])
  await page.getByRole("link", { name: "View cart (1)", exact: true }).click()
  await page.getByRole("button", { name: "Checkout", exact: true }).click()
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Checkout isn’t open just yet")
  expect(events(pixel, "InitiateCheckout")).toEqual([])
  await page.getByRole("button", { name: "Checkout", exact: true }).click()
  await expect(page).toHaveURL(stripeUrl)
  await expect.poll(() => events(pixel, "InitiateCheckout")).toHaveLength(1)
  expect(events(pixel, "InitiateCheckout")[0]!.args).toEqual(["trackSingle", pixelId, "InitiateCheckout", parameters])
})

test("Global Privacy Control overrides a saved grant", async ({ context, page, pixel }) => {
  await seedConsent(context, "granted")
  await context.addInitScript(() => Object.defineProperty(navigator, "globalPrivacyControl", { value: true }))
  await page.goto(`/shop/${productId}`)
  await page.getByRole("button", { name: "Privacy choices", exact: true }).click()
  await expect(
    page.getByText("Your browser’s Global Privacy Control is on, so Meta marketing cookies are off.")
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Allow Meta marketing cookies" })).toBeDisabled()
  expect(pixel.requests).toEqual([])
  expect(pixel.calls).toEqual([])
})

test("a rejected cart addition cannot become a conversion", async ({ context, page, pixel }) => {
  await seedConsent(context, "granted")
  await page.addInitScript(
    ({ productId }) => {
      localStorage.setItem(
        "your-store-cart-v1",
        JSON.stringify({
          version: 1,
          entries: [
            {
              entryId: "full",
              productId,
              variantId: 1004,
              title: "Fixture Good Hangs",
              variantTitle: "Clay / XL",
              unitAmount: 3200,
              quantity: 10,
            },
          ],
          checkouts: {},
        })
      )
    },
    { productId }
  )
  await page.goto(`/shop/${productId}`)
  await expect.poll(() => events(pixel, "ViewContent")).toHaveLength(1)
  await selectVariant(page)
  await page.getByRole("button", { name: "Add to cart", exact: true }).click()
  await expect(page.getByText("Your cart is full for this item. You can adjust quantities in your cart.")).toBeVisible()
  expect(events(pixel, "AddToCart")).toEqual([])
})

test("an initialized Pixel follows the real recovered-order checkout navigation through clean ingress", async ({
  context,
  page,
  pixel,
}) => {
  await seedConsent(context, "granted")
  await page.route("**/api/checkout", (route) =>
    route.fulfill({ json: { url: `${shopOrigin}/checkout/success?session_id=${sessionId}`, sessionId } })
  )
  await page.route("**/api/checkout/status?*", (route) =>
    route.fulfill({ json: { paymentStatus: "paid", fulfillmentStatus: "submitted", purchase, metaPurchase: purchase } })
  )
  await page.goto(`/shop/${productId}`)
  await expect.poll(() => events(pixel, "ViewContent")).toHaveLength(1)
  await selectVariant(page)
  await page.getByRole("button", { name: "Add to cart", exact: true }).click()
  await page.getByRole("link", { name: "View cart (1)", exact: true }).click()
  await page.getByRole("button", { name: "Checkout", exact: true }).click()
  await expect(page).toHaveURL(`${shopOrigin}/checkout/success`)
  await expect(page.getByRole("heading", { name: "Your order is confirmed." })).toBeVisible()
  await expect.poll(() => events(pixel, "Purchase")).toHaveLength(1)
  expect(events(pixel, "InitiateCheckout")).toEqual([])
  expect(pixel.requests).toHaveLength(2)
  expectPrivateDocumentFields(pixel, [sessionId, receipt])
})

test("a current paid purchase survives delayed opt-in and deduplicates independently of Vercel on reload", async ({
  page,
  pixel,
}) => {
  let statusRequests = 0
  await page.route("**/api/checkout/status?*", (route) => {
    statusRequests += 1
    return route.fulfill({
      json: { paymentStatus: "paid", fulfillmentStatus: "submitted", purchase, metaPurchase: purchase },
    })
  })
  await page.goto(`/checkout/success?session_id=${sessionId}`)
  await expect(page).toHaveURL(`${shopOrigin}/checkout/success`)
  await expect(page.getByRole("heading", { name: "Your order is confirmed." })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Your privacy choices" })).toBeVisible()
  expect(pixel.requests).toEqual([])
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), vercelAttemptsKey)).toContain(receipt)
  expect(await page.evaluate((key) => localStorage.getItem(key), metaAttemptsKey)).toBeNull()
  await page.getByRole("button", { name: "Allow Meta marketing cookies" }).click()
  await expect.poll(() => events(pixel, "Purchase")).toHaveLength(1)
  expect(events(pixel, "Purchase")[0]!.args).toEqual([
    "trackSingle",
    pixelId,
    "Purchase",
    {
      content_type: "product",
      content_ids: [`${productId}-1004`],
      contents: [{ id: `${productId}-1004`, quantity: 1, item_price: 32 }],
      currency: "USD",
      value: 36.95,
      num_items: 1,
    },
  ])
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), metaAttemptsKey)).toContain(receipt)
  await page.reload()
  await expect(page.getByRole("heading", { name: "Your order is confirmed." })).toBeVisible()
  await expect.poll(() => statusRequests).toBe(2)
  await expect.poll(() => events(pixel, "PageView")).toHaveLength(2)
  expect(events(pixel, "Purchase")).toHaveLength(1)
  expectPrivateDocumentFields(pixel, [sessionId, receipt])
})

for (const status of [
  { label: "pending", paymentStatus: "pending", fulfillmentStatus: "pending", metaPurchase: purchase },
  { label: "simulated", paymentStatus: "paid", fulfillmentStatus: "simulated", metaPurchase: purchase },
  { label: "recorded reversal", paymentStatus: "paid", fulfillmentStatus: "action_required", metaPurchase: null },
]) {
  test(`does not send Purchase for ${status.label}`, async ({ context, page, pixel }) => {
    await seedConsent(context, "granted")
    await page.route("**/api/checkout/status?*", (route) => route.fulfill({ json: { ...status, purchase: null } }))
    await page.goto(`/checkout/success?session_id=${sessionId}`)
    await expect(page).toHaveURL(`${shopOrigin}/checkout/success`)
    await expect(
      page.getByRole("heading", {
        name: status.paymentStatus === "paid" ? "Your order is confirmed." : "Checking your payment.",
      })
    ).toBeVisible()
    await expect.poll(() => events(pixel, "PageView")).toHaveLength(1)
    expect(events(pixel, "Purchase")).toEqual([])
    expect(await page.evaluate((key) => localStorage.getItem(key), metaAttemptsKey)).toBeNull()
    expectPrivateDocumentFields(pixel, [sessionId, receipt])
  })
}

test("withdrawal propagates to another tab and discards actions waiting for the SDK", async ({
  context,
  page,
  pixel,
}) => {
  await seedConsent(context, "granted")
  pixel.holdScript()
  await page.goto(`/shop/${productId}`, { waitUntil: "domcontentloaded" })
  await expect.poll(() => pixel.requests.length).toBe(1)
  await selectVariant(page)
  await page.getByRole("button", { name: "Add to cart", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "Added to cart" })).toBeVisible()
  const other = await context.newPage()
  await other.goto("/privacy", { waitUntil: "domcontentloaded" })
  await expect.poll(() => pixel.requests.length).toBe(2)
  await other.getByRole("button", { name: "Privacy choices", exact: true }).click()
  await other.getByRole("button", { name: "Decline Meta", exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(
        (key) => (JSON.parse(localStorage.getItem(key) ?? "null") as { consent?: string } | null)?.consent,
        consentKey
      )
    )
    .toBe("denied")
  pixel.releaseScript()
  await expect.poll(() => pixel.calls.filter((call) => call.args[0] === "consent")).toHaveLength(2)
  expect(events(pixel)).toEqual([])
  await other.getByRole("button", { name: "Privacy choices", exact: true }).click()
  await other.getByRole("button", { name: "Allow Meta marketing cookies" }).click()
  await expect.poll(() => events(pixel, "PageView")).toHaveLength(2)
  expect(events(pixel, "AddToCart")).toEqual([])
  await other.getByRole("button", { name: "Privacy choices", exact: true }).click()
  await other.getByRole("button", { name: "Decline Meta", exact: true }).click()
  await expect
    .poll(() => pixel.calls.filter((call) => call.args[0] === "consent" && call.args[1] === "revoke").length)
    .toBe(6)
})

test("distinct checkout tabs retain their own recovery through clean reloads without exposing capabilities", async ({
  context,
  page,
  pixel,
}) => {
  await seedConsent(context, "granted")
  const secondSession = "cs_live_anothermetafixture"
  const latestSession = new Map<Page, string | null>()
  await context.route("**/api/checkout/status?*", (route) => {
    const returnedSession = new URL(route.request().url()).searchParams.get("session_id")
    latestSession.set(route.request().frame().page(), returnedSession)
    return route.fulfill({
      json: {
        paymentStatus: "paid",
        fulfillmentStatus: returnedSession === secondSession ? "action_required" : "submitted",
        purchase: null,
        metaPurchase: null,
      },
    })
  })
  const other = await context.newPage()
  await Promise.all([
    page.goto(`/checkout/success?session_id=${sessionId}&coupon=PRIVATECODE`),
    other.goto(`/checkout/success?session_id=${secondSession}`),
  ])
  for (const tab of [page, other]) {
    await expect(tab).toHaveURL(`${shopOrigin}/checkout/success`)
    await expect(tab.getByRole("heading", { name: "Your order is confirmed." })).toBeVisible()
  }
  await expect.poll(() => latestSession.get(page)).toBe(sessionId)
  await expect.poll(() => latestSession.get(other)).toBe(secondSession)
  const firstReference = await page.evaluate(() => history.state.storeCheckoutRecovery)
  const secondReference = await other.evaluate(() => history.state.storeCheckoutRecovery)
  expect(firstReference.selector).not.toBe(secondReference.selector)
  latestSession.clear()
  await Promise.all([page.reload(), other.reload()])
  await expect.poll(() => latestSession.get(page)).toBe(sessionId)
  await expect.poll(() => latestSession.get(other)).toBe(secondSession)
  await expect.poll(() => events(pixel, "PageView")).toHaveLength(4)
  await page.goto(`/checkout/success?session_id=${secondSession}`)
  await expect(page).toHaveURL(`${shopOrigin}/checkout/success`)
  await expect.poll(() => latestSession.get(page)).toBe(secondSession)
  await page.goBack()
  await expect(page.getByRole("heading", { name: "Your order is confirmed." })).toBeVisible()
  await expect(page.getByRole("status")).toContainText(
    "Your payment is confirmed and your order is with our printing partner."
  )
  expect(await page.evaluate(() => history.state.storeCheckoutRecovery)).toEqual(firstReference)
  latestSession.delete(page)
  await page.reload()
  await expect.poll(() => latestSession.get(page)).toBe(sessionId)
  expectPrivateDocumentFields(pixel, [
    sessionId,
    secondSession,
    "PRIVATECODE",
    firstReference.selector,
    secondReference.selector,
  ])
})

test("Meta selection ingress cleans raw selections and coupons while preserving review and reload", async ({
  context,
  page,
  pixel,
}) => {
  await seedConsent(context, "granted")
  const rawSelection = `${productId}-1001:2`
  const other = await context.newPage()
  await Promise.all([
    page.goto(`/checkout/meta?products=${encodeURIComponent(rawSelection)}`),
    other.goto(`/checkout/meta?products=${productId}-1004:1&coupon=PRIVATECOUPON`),
  ])
  await expect(page).toHaveURL(`${shopOrigin}/checkout/meta`)
  await expect(other).toHaveURL(`${shopOrigin}/checkout/meta`)
  await expect(page.getByRole("heading", { name: "Fixture Good Hangs – Black / M", exact: true })).toBeVisible()
  await expect(page.getByText("Quantity: 2", { exact: true })).toBeVisible()
  await expect(other.getByRole("main").getByRole("alert")).toContainText("doesn’t currently support coupon codes")
  await Promise.all([page.reload(), other.reload()])
  await expect(page.getByText("Quantity: 2", { exact: true })).toBeVisible()
  await expect(other.getByRole("main").getByRole("alert")).toContainText("doesn’t currently support coupon codes")
  await expect.poll(() => events(pixel, "PageView")).toHaveLength(4)
  await page.getByRole("button", { name: "Add selection to cart" }).click()
  await expect.poll(() => events(pixel, "AddToCart")).toHaveLength(1)
  expect(events(pixel, "AddToCart")[0]!.args[3]).toMatchObject({
    content_ids: [`${productId}-1001`],
    num_items: 2,
    value: 56,
  })
  expectPrivateDocumentFields(pixel, [rawSelection, "PRIVATECOUPON", "products=", "coupon="])
})

test("unavailable recovery cookies preserve checkout with Meta blocked for the document", async ({
  context,
  page,
  pixel,
}) => {
  await seedConsent(context, "granted")
  let missingCookieResponses = 0
  await page.route("**/api/checkout/recovery", async (route) => {
    const response = await route.fetch({ headers: { ...route.request().headers(), cookie: "" } })
    if (response.status() === 404) missingCookieResponses += 1
    return route.fulfill({ response })
  })
  await page.route("**/api/checkout/status?*", (route) =>
    route.fulfill({ json: { paymentStatus: "paid", fulfillmentStatus: "submitted", purchase, metaPurchase: purchase } })
  )
  await page.goto(`/checkout/success?session_id=${sessionId}`)
  await expect(page).toHaveURL((url) => url.searchParams.get("recovery_unavailable") === "1")
  await expect(page.getByRole("heading", { name: "Your order is confirmed." })).toBeVisible()
  expect(missingCookieResponses).toBe(1)
  expect(pixel.requests).toEqual([])
  expect(events(pixel)).toEqual([])
  // Exercise the same document after navigation without abandoning unrelated image optimization at teardown.
  await page.getByRole("contentinfo").getByRole("link", { name: "Privacy", exact: true }).click()
  await expect(page).toHaveURL(`${shopOrigin}/privacy`)
  await expect(page.getByRole("main").getByRole("heading", { name: "Privacy", exact: true })).toBeVisible()
  expect(pixel.requests).toEqual([])
  expect(events(pixel)).toEqual([])
})

test("checkout handoff succeeds without AbortSignal.timeout", async ({ context, page, pixel }) => {
  await seedConsent(context, "granted")
  await context.addInitScript(() => Object.defineProperty(AbortSignal, "timeout", { value: undefined }))
  let verifications = 0
  await page.route("**/api/checkout/recovery", (route) => {
    if (route.request().postDataJSON().verify === true) verifications += 1
    return route.continue()
  })
  await page.route("**/api/checkout/status?*", (route) =>
    route.fulfill({ json: { paymentStatus: "paid", fulfillmentStatus: "submitted", purchase, metaPurchase: purchase } })
  )
  await page.goto(`/checkout/success?session_id=${sessionId}`)
  await expect(page).toHaveURL(`${shopOrigin}/checkout/success`)
  await expect(page.getByRole("heading", { name: "Your order is confirmed." })).toBeVisible()
  expect(await page.evaluate(() => typeof AbortSignal.timeout)).toBe("undefined")
  expect(verifications).toBe(1)
  await expect.poll(() => events(pixel, "Purchase")).toHaveLength(1)
  expectPrivateDocumentFields(pixel, [sessionId, receipt])
})

test("a synchronous handoff fetch failure preserves the paid checkout with Meta blocked", async ({
  context,
  page,
  pixel,
}) => {
  await seedConsent(context, "granted")
  await context.addInitScript(() => {
    const fetch = window.fetch.bind(window)
    window.fetch = (input, options) => {
      const body: unknown = typeof options?.body === "string" ? JSON.parse(options.body) : null
      if (
        input === "/api/checkout/recovery" &&
        !new URL(location.href).searchParams.has("recovery_unavailable") &&
        body &&
        typeof body === "object" &&
        "verify" in body &&
        body.verify === true
      )
        throw new Error("Synchronous ingress fetch failure in fixture")
      return fetch(input, options)
    }
  })
  let returnedSession: string | null = null
  await page.route("**/api/checkout/status?*", (route) => {
    returnedSession = new URL(route.request().url()).searchParams.get("session_id")
    return route.fulfill({
      json: { paymentStatus: "paid", fulfillmentStatus: "submitted", purchase, metaPurchase: purchase },
    })
  })
  await page.goto(`/checkout/success?session_id=${sessionId}`)
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("recovery_unavailable") === "1" && url.searchParams.get("session_id") === sessionId
  )
  await expect(page.getByRole("heading", { name: "Your order is confirmed." })).toBeVisible()
  expect(returnedSession).toBe(sessionId)
  expect(pixel.requests).toEqual([])
  expect(events(pixel)).toEqual([])
  await page.getByRole("contentinfo").getByRole("link", { name: "Privacy", exact: true }).click()
  await expect(page).toHaveURL(`${shopOrigin}/privacy`)
  await expect(page.getByRole("main").getByRole("heading", { name: "Privacy", exact: true })).toBeVisible()
  expect(pixel.requests).toEqual([])
  expect(events(pixel)).toEqual([])
})

test("a cleared order recovery cookie explains the permanent failure and offers order support", async ({
  context,
  page,
  pixel,
}) => {
  await seedConsent(context, "granted")
  let statusRequests = 0
  await page.route("**/api/checkout/status?*", (route) => {
    statusRequests += 1
    return route.fulfill({
      json: { paymentStatus: "paid", fulfillmentStatus: "submitted", purchase: null, metaPurchase: null },
    })
  })
  await page.goto(`/checkout/success?session_id=${sessionId}`)
  await expect(page).toHaveURL(`${shopOrigin}/checkout/success`)
  await expect(page.getByRole("heading", { name: "Your order is confirmed." })).toBeVisible()
  expect(statusRequests).toBe(1)
  await context.clearCookies({ name: /^store-checkout-recovery-/ })
  const unavailable = page.waitForResponse("**/api/checkout/recovery")
  await page.reload()
  expect((await unavailable).status()).toBe(404)
  const main = page.getByRole("main")
  await expect(main.getByRole("alert")).toContainText("This checkout link is no longer available in this browser.")
  await expect(main.getByRole("alert")).toContainText("Please don’t place another order to check its status.")
  await expect(main.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0)
  const support = main.getByRole("link", { name: "Contact us about your order" })
  await expect(support).toHaveAttribute("href", "mailto:support@fixture.example")
  await support.focus()
  await expect(support).toBeFocused()
  await expect(main.getByRole("link", { name: "Browse the shirts" })).toHaveAttribute("href", "/shop")
  expect(statusRequests).toBe(1)
  expect(events(pixel, "Purchase")).toEqual([])
  expectPrivateDocumentFields(pixel, [sessionId, receipt])
})

test("a cleared Meta recovery cookie explains the permanent failure and keeps the cart reachable", async ({
  context,
  page,
  pixel,
}) => {
  await seedConsent(context, "granted")
  await page.goto(`/checkout/meta?products=${productId}-1001:1`)
  await expect(page).toHaveURL(`${shopOrigin}/checkout/meta`)
  await expect(page.getByRole("heading", { name: "Fixture Good Hangs – Black / M", exact: true })).toBeVisible()
  await context.clearCookies({ name: /^store-checkout-recovery-/ })
  const unavailable = page.waitForResponse("**/api/checkout/recovery")
  await page.reload()
  expect((await unavailable).status()).toBe(404)
  const main = page.getByRole("main")
  await expect(main.getByRole("alert")).toContainText("This selection is no longer available in this browser.")
  await expect(main.getByRole("alert")).toContainText("Nothing was added.")
  await expect(main.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0)
  await expect(main.getByRole("link", { name: "Browse the shirts" })).toHaveAttribute("href", "/shop")
  const cart = main.getByRole("link", { name: "View your existing cart" })
  await expect(cart).toHaveAttribute("href", "/cart")
  await cart.focus()
  await expect(cart).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(`${shopOrigin}/cart`)
  await expect(page.getByRole("heading", { name: "Your cart.", exact: true })).toBeVisible()
  expect(events(pixel, "AddToCart")).toEqual([])
  expectPrivateDocumentFields(pixel, [`${productId}-1001:1`])
})

test("the checkout handoff is styled and keyboard accessible at 320 pixels", async ({
  context,
  page,
  pixel,
  browserName,
}, testInfo) => {
  await seedConsent(context, "granted")
  await page.setViewportSize({ width: 320, height: 800 })
  let verifications = 0
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/checkout/recovery", async (route) => {
    if (route.request().postDataJSON().verify === true) {
      verifications += 1
      await held
    }
    return route.continue()
  })
  await page.route("**/api/checkout/status?*", (route) =>
    route.fulfill({ json: { paymentStatus: "paid", fulfillmentStatus: "submitted", purchase, metaPurchase: purchase } })
  )
  try {
    const response = await page.goto(`/checkout/success?session_id=${sessionId}`, { waitUntil: "domcontentloaded" })
    await expect.poll(() => verifications).toBe(1)
    await expect(page.getByRole("heading", { name: "Reopening your checkout.", exact: true })).toBeVisible()
    const nonce = await page.locator("style").evaluate((element: HTMLStyleElement) => element.nonce)
    expect(nonce).not.toBe("")
    expect(response!.headers()["content-security-policy"]).toContain(`style-src 'nonce-${nonce}'`)
    expect(await page.locator("script").evaluate((element: HTMLScriptElement) => element.nonce)).toBe(nonce)
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 253, 246)")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const fallback = page.getByRole("link", { name: "Continue without marketing tracking" })
    expect((await fallback.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await beginKeyboardNavigation(page, browserName)
    await expect(fallback).toBeFocused()
    await expect(fallback).toHaveCSS("outline-width", "3px")
    await page.screenshot({ path: testInfo.outputPath("checkout-handoff-320px.png"), fullPage: true })
    expect(pixel.requests).toEqual([])
    expect(events(pixel)).toEqual([])
  } finally {
    release()
  }
  await expect(page).toHaveURL(`${shopOrigin}/checkout/success`)
  await expect(page.getByRole("heading", { name: "Your order is confirmed." })).toBeVisible()
  await expect.poll(() => events(pixel, "Purchase")).toHaveLength(1)
  expectPrivateDocumentFields(pixel, [sessionId, receipt])
})

test("blocked session storage retains coarse social attribution across clean ingress", async ({
  context,
  page,
  pixel,
}) => {
  await seedConsent(context, "granted")
  const storeEvents: { name: string; data: Record<string, unknown> }[] = []
  await context.exposeBinding("__captureVisitEvent", (_source, event: (typeof storeEvents)[number]) =>
    storeEvents.push(event)
  )
  await page.route("**/_vercel/insights/script.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `(() => {
      const queue = window.vaq || [];
      window.va = (type, payload) => { if (type === "event") window.__captureVisitEvent(payload); };
      window.vaq = [];
      queue.forEach(([type, payload]) => window.va(type, payload));
    })();`,
    })
  )
  await page.addInitScript(() => {
    const read = Storage.prototype.getItem
    const write = Storage.prototype.setItem
    Storage.prototype.getItem = function (key) {
      if (this === sessionStorage) throw new Error("Session storage blocked in fixture")
      return read.call(this, key)
    }
    Storage.prototype.setItem = function (key, value) {
      if (this === sessionStorage) throw new Error("Session storage blocked in fixture")
      return write.call(this, key, value)
    }
  })
  await page.goto(`/checkout/meta?products=${productId}-1001:1&cart_origin=instagram`)
  await expect(page).toHaveURL(`${shopOrigin}/checkout/meta`)
  await expect(page.getByRole("heading", { name: "Review your selection." })).toBeVisible()
  await expect.poll(() => events(pixel, "PageView")).toHaveLength(1)
  await page.getByRole("button", { name: "Add selection to cart" }).click()
  await expect.poll(() => storeEvents.filter(({ name }) => name === "add_to_cart")).toHaveLength(1)
  expect(storeEvents.find(({ name }) => name === "add_to_cart")!.data.source).toBe("social")
  expectPrivateDocumentFields(pixel, ["cart_origin=", "products=", `${productId}-1001:1`])
})
