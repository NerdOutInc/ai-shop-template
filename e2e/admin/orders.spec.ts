import { randomUUID } from "node:crypto"

import { expect, test } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { Pool } from "pg"

import { adminTestConfig } from "./admin-test-config"

const config = adminTestConfig()
const auth = createClient(config.authURL, config.secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const database = new Pool({ connectionString: config.databaseUrl })
const email = `orders-admin-${randomUUID()}@example.test`
const ids: string[] = []
let userId: string | undefined
let socialOrder: string
let unrecordedOrder: string
let testOrder: string
let otherShopOrder: string

test.describe.configure({ mode: "serial" })

test.beforeAll(async () => {
  const { data, error } = await auth.auth.admin.createUser({ email, email_confirm: true })
  if (error) throw error
  userId = data.user.id
  await database.query("insert into public.admin_memberships(user_id) values($1)", [userId])
  const captured = {
    status: "paid",
    paymentIntentId: "pi_adminorderfixture",
    paidAt: "2026-09-21T18:22:00.000Z",
    livemode: true,
    currency: "usd",
    subtotalAmount: 3400,
    shippingAmount: 500,
    taxAmount: 280,
    totalAmount: 4180,
    customerName: "Jamie Orders",
    customerEmail: "jamie-orders@example.test",
  }
  const social = {
    version: 1,
    capturedAt: "2026-09-21T18:00:00.000Z",
    channel: "social",
    source: "instagram",
    referrerHost: "instagram.com",
    utmSource: "instagram",
    utmMedium: "social",
    utmCampaign: "september_send",
    landingPath: "/shop/send-it",
    method: "campaign",
  }
  async function seed({
    shopId = "123",
    payment = captured,
    attribution = social,
    state = "submitted",
    failure = null,
    createdAt = "2026-09-21T18:20:00.000Z",
  }: {
    shopId?: string
    payment?: typeof captured | null
    attribution?: typeof social | null
    state?: string
    failure?: string | null
    createdAt?: string
  } = {}) {
    const id = randomUUID()
    ids.push(id)
    await database.query(
      `insert into commerce.checkout_orders(request_id,snapshot,payment,state,failure_code,created_at)
      values($1,$2,$3,$4,$5,$6)`,
      [
        id,
        {
          shopId,
          shippingAddress: { firstName: "Robin", lastName: "Recipient" },
          ...(attribution ? { attribution } : {}),
        },
        payment,
        state,
        failure,
        createdAt,
      ]
    )
    return `ORDER-${id.slice(0, 8).toUpperCase()}`
  }
  socialOrder = await seed({ state: "pending", failure: "PRINTIFY_UNAVAILABLE", createdAt: "2026-09-22T18:20:00.000Z" })
  unrecordedOrder = await seed({ payment: null, attribution: null })
  testOrder = await seed({ payment: { ...captured, livemode: false }, state: "simulated" })
  otherShopOrder = await seed({ shopId: "another-shop" })
  await Promise.all(
    Array.from({ length: 26 }, () => seed({ attribution: { ...social, channel: "direct", source: "direct" } }))
  )
})

test.afterAll(async () => {
  await database.query("delete from commerce.checkout_orders where request_id = any($1::uuid[])", [ids])
  if (userId) await auth.auth.admin.deleteUser(userId)
  await database.end()
})

test("orders require sign-in and do not reveal customer data", async ({ page }) => {
  const response = await page.goto("/admin/orders")
  await expect(page).toHaveURL(/\/admin\/sign-in$/)
  await expect(page.getByText("jamie-orders@example.test")).toHaveCount(0)
  expect(await response?.text()).not.toContain("jamie-orders@example.test")
})

test("an admin can inspect purchase sources, filter and page orders with keyboard access on a phone", async ({
  page,
}) => {
  await page.goto("/admin/sign-in")
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByRole("button", { name: "Send an email code" }).click()
  let code: string | undefined
  await expect
    .poll(async () => {
      const messages = (await (await fetch(`${config.mailURL}/api/v1/messages`)).json()) as {
        messages: { ID: string; To: { Address: string }[] }[]
      }
      const message = messages.messages.find((item) => item.To.some((recipient) => recipient.Address === email))
      if (!message) return false
      const content = (await (await fetch(`${config.mailURL}/api/v1/message/${message.ID}`)).json()) as {
        Text: string
        HTML: string
      }
      code = `${content.Text} ${content.HTML}`.match(/\b\d{6}\b/)?.[0]
      return Boolean(code)
    })
    .toBe(true)
  await page.getByLabel("Email verification code").fill(code!)
  await page.getByRole("button", { name: "Verify and sign in" }).click()
  await page.getByRole("link", { name: "Orders", exact: true }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Orders", exact: true })).toHaveAttribute("aria-current", "page")
  await expect(page.getByRole("heading", { name: `Order ${socialOrder}`, exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: `Order ${testOrder}`, exact: true })).toHaveCount(0)
  await expect(page.getByRole("heading", { name: `Order ${unrecordedOrder}`, exact: true })).toHaveCount(0)
  await expect(page.getByRole("heading", { name: `Order ${otherShopOrder}`, exact: true })).toHaveCount(0)
  const orders = page.getByRole("list", { name: "Orders" })
  await expect(orders.getByRole("listitem")).toHaveCount(25)
  await page.getByRole("link", { name: "Next page" }).click()
  await expect(orders.getByRole("listitem")).toHaveCount(2)
  await expect(page.getByRole("link", { name: "Next page" })).toHaveCount(0)

  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByLabel("Channel", { exact: true }).selectOption("social")
  await page.getByRole("button", { name: "Apply filters" }).click()
  await expect(orders.getByRole("listitem")).toHaveCount(1)
  await expect(page).not.toHaveURL(/page=2/)
  const order = orders.getByRole("article").first()
  await expect(order.getByText("instagram", { exact: true })).toBeVisible()
  await expect(order.getByText("september_send")).toBeVisible()
  await expect(order.getByText("$41.80")).toBeVisible()
  await expect(order.getByText("Needs attention")).toBeVisible()
  await expect(order.getByText("Payment captured", { exact: true })).toBeVisible()
  const details = order.locator("summary")
  await expect(details).toHaveAccessibleName(`Order details for ${socialOrder}`)
  await details.focus()
  await page.keyboard.press("Enter")
  await expect(order.getByText("instagram.com", { exact: true })).toBeVisible()
  await expect(order.getByText("Customer (billing)")).toBeVisible()
  await expect(order.getByText("Jamie Orders")).toBeVisible()
  await expect(order.getByText("Delivery recipient")).toBeVisible()
  await expect(order.getByText("Robin Recipient")).toBeVisible()
  await expect(details).toBeFocused()
  expect(await details.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 320, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByLabel("Channel", { exact: true }).focus()
  await page.keyboard.press("Tab")
  await expect(page.getByLabel("Test orders", { exact: true })).toBeFocused()

  await page.getByLabel("Payment", { exact: true }).selectOption("unverified")
  await page.getByLabel("Channel", { exact: true }).selectOption("unknown")
  await page.getByRole("button", { name: "Apply filters" }).click()
  await expect(orders.getByRole("listitem")).toHaveCount(1)
  await expect(page.getByRole("heading", { name: `Order ${unrecordedOrder}`, exact: true })).toBeVisible()
  await expect(orders.getByText("Payment not recorded")).toBeVisible()
  await expect(orders.getByText("Payment captured", { exact: true })).toHaveCount(0)

  await page.getByLabel("Payment", { exact: true }).selectOption("paid")
  await page.getByLabel("Channel", { exact: true }).selectOption("all")
  await page.getByLabel("Test orders", { exact: true }).selectOption("test")
  await page.getByRole("button", { name: "Apply filters" }).click()
  await expect(page.getByRole("heading", { name: `Order ${testOrder}`, exact: true })).toBeVisible()
  await expect(orders.getByText("Test order")).toBeVisible()
  await expect(orders.getByText("Simulated")).toBeVisible()
  await expect(page.getByRole("link", { name: "Stripe (opens in a new tab)" })).toHaveAttribute(
    "href",
    "https://dashboard.stripe.com/test/payments"
  )

  await database.query("update public.admin_memberships set active=false where user_id=$1", [userId])
  await page.goto("/admin/orders")
  await expect(page).toHaveURL(/\/admin\/sign-in$/)
  await expect(page.getByText("jamie-orders@example.test")).toHaveCount(0)
})
