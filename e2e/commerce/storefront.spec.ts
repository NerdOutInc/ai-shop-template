import { randomUUID } from "node:crypto"
import { readdirSync } from "node:fs"

import AxeBuilder from "@axe-core/playwright"
import { expect } from "@playwright/test"
import { Pool } from "pg"
import Stripe from "stripe"

import { beginKeyboardNavigation } from "../../test/begin-keyboard-navigation"
import { catalogProducts } from "../catalog-products"
import { commerceTestConfig as config } from "./test-config"
import { test } from "./storefront-test"

let pool: Pool
const signer = new Stripe(config.stripeKey)
// Parallel groups can revisit this file in one worker after its earlier afterAll closed the pool.
test.beforeAll(() => {
  pool = new Pool({ connectionString: config.databaseUrl })
})
test.afterAll(async () => pool.end())

// New public routes automatically join the smoke test. Dynamic routes need an explicit valid fixture.
const publicRoutes = readdirSync("src/app", { recursive: true })
  .filter((file) => typeof file === "string" && (file === "page.tsx" || file.endsWith("/page.tsx")))
  .map((file) => `/${String(file).replace(/(^|\/)page\.tsx$/, "")}`.replace(/\/$/, "") || "/")
  .filter((route) => !route.startsWith("/admin"))
  .flatMap((route) => {
    if (route === "/shop/[id]") return catalogProducts.map((product) => `/shop/${product.id}`)
    if (route.includes("[") && route !== "/unsubscribe/[token]") throw new Error(`Add a valid fixture for ${route}`)
    return [route]
  })

for (const route of publicRoutes) {
  test(`public page ${route} renders without browser or server errors`, async ({ page }) => {
    let path = route
    if (route === "/unsubscribe/[token]") {
      const { rows } = await pool.query<{ id: string }>(
        "insert into commerce.drop_subscribers (email,source,consent_copy_version,subscription_state) values ($1,'design-of-the-week','v1','legacy') returning id",
        [`smoke-${randomUUID()}@example.com`]
      )
      path = `/unsubscribe/${rows[0]!.id}`
    }
    expect((await page.goto(path))?.status(), path).toBe(200)
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("main"), path).toBeVisible()
    await expect(page.getByRole("heading", { level: 1 }), path).toBeVisible()
  })
}

test("finds a shirt, changes options and images, edits the cart, pays and prints exactly once", async ({
  page,
  request,
}, testInfo) => {
  await page.goto("/shop")
  await page.getByLabel("Sort by").selectOption("newest")
  const filters = page.getByRole("button", { name: /^Filters/ })
  if (await filters.isVisible()) await filters.click()
  await page.getByRole("checkbox", { name: "XL", exact: true }).check()
  await page.getByRole("article", { name: "Fixture First Design" }).getByRole("link").click()
  await expect(page).toHaveURL(new RegExp(`/shop/${catalogProducts[0]!.id}`))
  await expect(page.getByRole("heading", { level: 1, name: "Fixture First Design", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Black", exact: true }).click()
  await expect(page.getByRole("button", { name: "L", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "M", exact: true }).click()
  await page.getByRole("button", { name: "Clay", exact: true }).click()
  await page.getByRole("button", { name: "XL", exact: true }).click()
  await expect(page.getByText("$32.00", { exact: true })).toBeVisible()
  const gallery = page.getByRole("region", { name: "Fixture First Design photos" })
  await gallery.focus()
  await page.keyboard.press("ArrowRight")
  await expect(gallery).toBeFocused()
  await expect(gallery.getByRole("button", { name: "View photo 2 of Fixture First Design" })).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  await gallery.getByRole("button", { name: "View photo 1 of Fixture First Design" }).click()
  await page.getByRole("button", { name: "Add to cart", exact: true }).click()
  const viewCart = page
    .getByRole("dialog", { name: "Added to cart" })
    .getByRole("link", { name: "View cart (1)", exact: true })
  await expect(viewCart).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByText("Clay / XL", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: /Increase quantity/ }).click()
  await page.waitForLoadState("networkidle")
  await page.reload()
  await expect(page.getByRole("heading", { name: "The good stuff (2)" })).toBeVisible()
  await expect(page.getByText("$71.35", { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([])
  await page.screenshot({ path: testInfo.outputPath("shopping-cart.png"), fullPage: true })
  const checkout = page.getByRole("button", { name: "Checkout", exact: true })
  // Enter keyboard modality before focusing, so this also checks visible focus on the purchase action.
  await page.keyboard.press("Tab")
  await checkout.focus()
  await expect(checkout).toBeFocused()
  expect(await checkout.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
  await page.waitForLoadState("networkidle")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("heading", { name: "Fixture secure checkout" })).toBeVisible()
  const sessionId = new URL(page.url()).pathname.split("/").at(-1)!
  const readFixture = async () => (await request.get(`${config.providerURL}/fixtures/${sessionId}`)).json()
  expect((await readFixture()).orders).toEqual([])
  const sendEvent = async () => {
    const data = JSON.stringify({
      id: "evt_fixture",
      type: "checkout.session.completed",
      data: { object: { id: sessionId } },
    })
    return request.post("/api/webhooks/stripe", {
      data,
      headers: {
        "content-type": "application/json",
        "stripe-signature": signer.webhooks.generateTestHeaderString({ payload: data, secret: config.webhookSecret }),
      },
    })
  }
  expect((await sendEvent()).status()).toBe(200)
  expect((await readFixture()).orders).toEqual([]) // An authentic but unpaid event must never print.
  expect((await request.post(`${config.providerURL}/fixtures/${sessionId}/paid`)).ok()).toBe(true)
  expect((await sendEvent()).status()).toBe(200)
  expect((await sendEvent()).status()).toBe(200)
  const fixture = await readFixture()
  expect(fixture.creates).toBe(1)
  expect(fixture.orders).toHaveLength(1)
  expect(fixture.orders[0]).toMatchObject({
    status: "in-production",
    submissions: 1,
    line_items: [{ product_id: catalogProducts[0]!.id, variant_id: 1004, quantity: 2 }],
    address_to: {
      first_name: "Robin",
      last_name: "Shopper",
      address1: "123 Test Street",
      city: "Minneapolis",
      region: "MN",
      zip: "55401",
    },
  })
  const stored = (
    await pool.query("select state,payment,snapshot from commerce.checkout_orders where session_id=$1", [sessionId])
  ).rows[0]
  expect(stored).toMatchObject({ state: "submitted", payment: { status: "paid", totalAmount: 7135 } })
  await page.goto(`/checkout/success?session_id=${sessionId}`)
  await expect(page.getByRole("heading", { name: "Your order is confirmed." })).toBeVisible()
  await expect(page.getByText(/your order is with our printing partner/)).toBeVisible()
  await page.waitForLoadState("networkidle")
  await page.reload()
  await page.waitForLoadState("networkidle")
  await page.goto("/cart")
  await expect(
    page.getByText("Your cart is empty. Explore the collection to find a shirt that suits you.")
  ).toBeVisible()
})

test("requires inbox confirmation, deduplicates signup and honors unsubscribe", async ({
  page,
  request,
  browserName,
}) => {
  const email = `Shopper-${randomUUID()}@Example.com`
  let releaseScripts!: () => void
  const scriptsReleased = new Promise<void>((resolve) => {
    releaseScripts = resolve
  })
  await page.route("**/_next/static/**/*.js", async (route) => {
    await scriptsReleased
    await route.fallback()
  })
  const field = page.getByRole("textbox", { name: "Know when the next one drops" })
  try {
    await page.goto("/#design-of-the-week", { waitUntil: "commit" })
    // A customer can type while JavaScript is still loading; submission must use the visible address.
    await field.pressSequentially(email)
  } finally {
    releaseScripts()
  }
  await page.waitForLoadState("networkidle")
  const signup = page.locator("#design-of-the-week")
  await expect(
    signup.getByText(
      "We'll send a confirmation email first. Once you confirm, we'll email you about new design drops. You can unsubscribe in every drop email or contact our support team."
    )
  ).toBeVisible()
  await expect(signup.locator('input[name="company"]')).toBeHidden()
  await expect(signup.getByRole("textbox", { name: "Company", exact: true })).toHaveCount(0)
  expect((await new AxeBuilder({ page }).include("#design-of-the-week").analyze()).violations).toEqual([])
  await field.focus()
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await field.fill(email)
    await expect(field).toBeFocused()
    expect(await field.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
    await beginKeyboardNavigation(page, browserName)
    const signupButton = page.getByRole("button", { name: "Keep me posted" })
    await expect(signupButton).toBeFocused()
    expect(await signupButton.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
    await page.keyboard.press("Enter")
    await expect(page.getByRole("status").filter({ hasText: "Check your inbox" })).toBeVisible()
    await expect(field).toHaveValue("")
  }
  const { rows } = await pool.query(
    "select id,email,source,consent_copy_version,subscription_state,confirmed_at,unsubscribed_at from commerce.drop_subscribers where email=$1",
    [email.toLowerCase()]
  )
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    email: email.toLowerCase(),
    source: "design-of-the-week",
    consent_copy_version: "v3",
    subscription_state: "pending",
    confirmed_at: null,
    unsubscribed_at: null,
  })
  const emails = async () =>
    (
      await request.get(`${config.providerURL}/confirmation-emails`, { params: { recipient: email.toLowerCase() } })
    ).json() as Promise<{ text: string }[]>
  await expect.poll(async () => (await emails()).length).toBe(1)
  const token = (await emails())[0]!.text.match(/confirm-signup#([a-f0-9]{64})/)![1]!
  let confirmationPosts = 0
  page.on("request", (outgoing) => {
    if (outgoing.url().endsWith("/api/drop-confirm") && outgoing.method() === "POST") confirmationPosts++
  })
  await page.goto(`/confirm-signup#${token}`)
  const confirm = page.getByRole("button", { name: "Confirm signup" })
  await expect(confirm).toBeEnabled()
  expect(confirmationPosts).toBe(0)
  expect(
    (await pool.query("select subscription_state from commerce.drop_subscribers where id=$1", [rows[0].id])).rows[0]
      .subscription_state
  ).toBe("pending")
  const tabKey = await beginKeyboardNavigation(page, browserName)
  const skip = page.getByRole("link", { name: "Skip to content", exact: true })
  await expect(skip).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("main")).toBeFocused()
  await expect(confirm).toBeEnabled()
  expect(confirmationPosts).toBe(0)
  await page.keyboard.press(tabKey)
  await expect(confirm).toBeFocused()
  expect(await confirm.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("heading", { name: "You're on the list" })).toBeFocused()
  expect(confirmationPosts).toBe(1)
  expect(
    (
      await pool.query("select subscription_state,confirmed_at from commerce.drop_subscribers where id=$1", [
        rows[0].id,
      ])
    ).rows[0]
  ).toMatchObject({ subscription_state: "confirmed", confirmed_at: expect.any(Date) })
  await page.goto(`/unsubscribe/${rows[0].id}`)
  expect(
    (await pool.query("select unsubscribed_at from commerce.drop_subscribers where id=$1", [rows[0].id])).rows[0]
      .unsubscribed_at
  ).toBeNull()
  await page.getByRole("button", { name: "Unsubscribe" }).click()
  await expect(page.getByRole("heading", { name: "You’re off the list." })).toBeVisible()
  expect(
    (await pool.query("select unsubscribed_at from commerce.drop_subscribers where id=$1", [rows[0].id])).rows[0]
      .unsubscribed_at
  ).not.toBeNull()
  // A used link cannot undo a later stop.
  const replay = await request.post("/api/drop-confirm", { data: { token }, headers: { origin: config.baseURL } })
  expect(replay.status()).toBe(410)
  expect(await replay.json()).toEqual({ status: "expired" })
  expect(
    (await pool.query("select unsubscribed_at from commerce.drop_subscribers where id=$1", [rows[0].id])).rows[0]
      .unsubscribed_at
  ).not.toBeNull()
})

test("rejects forged payment and changed prices; reconciles a lost print response without printing twice", async ({
  request,
}) => {
  const input = {
    requestId: randomUUID(),
    expectedShippingAmount: 495,
    items: [{ productId: catalogProducts[0]!.id, variantId: 1004, quantity: 1, expectedUnitAmount: 1 }],
  }
  const changed = await request.post("/api/checkout", { data: input, headers: { origin: config.baseURL } })
  expect(changed.status()).toBe(409)
  expect(await changed.json()).toMatchObject({ code: "PRICE_CHANGED" })
  input.items[0]!.expectedUnitAmount = 3200
  const checkout = await request.post("/api/checkout", { data: input, headers: { origin: config.baseURL } })
  expect(checkout.ok(), await checkout.text()).toBe(true)
  const { sessionId } = await checkout.json()
  const data = JSON.stringify({
    id: "evt_recovery",
    type: "checkout.session.completed",
    data: { object: { id: sessionId } },
  })
  expect(
    (
      await request.post("/api/webhooks/stripe", {
        data,
        headers: { "content-type": "application/json", "stripe-signature": "forged" },
      })
    ).status()
  ).toBe(400)
  await request.post(`${config.providerURL}/fixtures/${sessionId}/paid`)
  await request.post(`${config.providerURL}/fixtures/${sessionId}/fail-production`)
  const event = () =>
    request.post("/api/webhooks/stripe", {
      data,
      headers: {
        "content-type": "application/json",
        "stripe-signature": signer.webhooks.generateTestHeaderString({ payload: data, secret: config.webhookSecret }),
      },
    })
  expect((await event()).status()).toBe(500)
  const paid = (await pool.query("select state,payment from commerce.checkout_orders where session_id=$1", [sessionId]))
    .rows[0]
  expect(paid).toMatchObject({ state: "submitting", payment: { status: "paid" } })
  expect((await event()).status()).toBe(200)
  const fixture = await (await request.get(`${config.providerURL}/fixtures/${sessionId}`)).json()
  expect(fixture.orders).toHaveLength(1)
  expect(fixture.orders[0]).toMatchObject({ status: "in-production", submissions: 1 })
  expect(
    (await pool.query("select state from commerce.checkout_orders where session_id=$1", [sessionId])).rows[0].state
  ).toBe("submitted")
})

test("retains pre-hydration typing through a failed signup and clears it after retry", async ({
  browser,
  browserName,
}, testInfo) => {
  const context = await browser.newContext({ baseURL: config.baseURL, viewport: { width: 375, height: 812 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const submitted: unknown[] = []
  let releaseScripts!: () => void
  const scriptsReleased = new Promise<void>((resolve) => {
    releaseScripts = resolve
  })
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === config.baseURL) return route.continue()
    return route.abort()
  })
  await page.route("**/_next/static/**/*.js", async (route) => {
    await scriptsReleased
    await route.fallback()
  })
  await page.route("**/api/drop-signup", async (route) => {
    submitted.push(route.request().postDataJSON())
    return route.fulfill({
      status: submitted.length === 1 ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(submitted.length === 1 ? { error: "Try again shortly" } : { subscribed: true }),
    })
  })
  try {
    await page.goto("/#design-of-the-week", { waitUntil: "commit" })
    const field = page.getByRole("textbox", { name: "Know when the next one drops" })
    await field.click()
    await field.pressSequentially("early@exa")
    releaseScripts()
    await page.waitForLoadState("networkidle")
    await expect(field).toBeFocused()
    await page.keyboard.type("mple.com")
    await expect(field).toHaveValue("early@example.com")
    await page.getByRole("button", { name: "Keep me posted" }).click()
    await expect(page.getByRole("alert").filter({ hasText: "Try again shortly" })).toBeVisible()
    await expect(field).toHaveValue("early@example.com")
    await field.focus()
    await beginKeyboardNavigation(page, browserName)
    const retry = page.getByRole("button", { name: "Keep me posted" })
    await expect(retry).toBeFocused()
    expect(await retry.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
    await page.screenshot({ path: testInfo.outputPath("early-signup-retry-narrow.png"), fullPage: true })
    await page.keyboard.press("Enter")
    await expect(page.getByRole("status").filter({ hasText: "Check your inbox" })).toBeVisible()
    await expect(field).toHaveValue("")
    expect(submitted).toEqual(
      Array.from({ length: 2 }, () => ({ email: "early@example.com", source: "design-of-the-week", company: "" }))
    )
    expect(errors).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally {
    releaseScripts()
    await context.close()
  }
})
