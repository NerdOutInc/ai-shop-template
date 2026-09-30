import { randomUUID } from "node:crypto"

import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"
import { Pool } from "pg"

import { beginKeyboardNavigation } from "../test/begin-keyboard-navigation"
import { storeConfig } from "../test/store-config"

// The fixture server has a real database, and this route has no origin check to trip over.
test.use({ baseURL: `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_FIXTURE_PORT ?? 3200)}` })

let pool: Pool
test.beforeAll(() => {
  pool = new Pool({ connectionString: process.env.CATALOG_E2E_DATABASE_URL })
})
test.afterAll(async () => {
  await pool.end()
})

/** A subscriber of this test's own, so browsers running in parallel never share a row. */
async function subscribe() {
  const { rows } = await pool.query<{ id: string }>(
    `insert into commerce.drop_subscribers (email, source, consent_copy_version)
     values ($1, 'design-of-the-week', 'v2') returning id`,
    [`subscriber-${randomUUID()}@example.com`]
  )
  return rows[0]!.id
}
const unsubscribedAt = async (id: string) =>
  (
    await pool.query<{ unsubscribed_at: Date | null }>(
      "select unsubscribed_at from commerce.drop_subscribers where id = $1",
      [id]
    )
  ).rows[0]?.unsubscribed_at ?? null

test("asks before unsubscribing, then takes someone off the list by keyboard", async ({ page, browserName }) => {
  const id = await subscribe()
  const measured: string[] = []
  page.on("request", (request) => {
    if (/_vercel\/insights|googletagmanager|google-analytics|facebook/.test(request.url())) measured.push(request.url())
  })
  await page.goto(`/unsubscribe/${id}`)
  await expect(page.getByRole("heading", { level: 1, name: "Stop the drop emails?" })).toBeVisible()
  // Opening the link did nothing: a mail scanner following it must not unsubscribe anyone.
  expect(await unsubscribedAt(id)).toBeNull()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([])

  await page.locator("main").focus()
  const tabKey = await beginKeyboardNavigation(page, browserName)
  const button = page.getByRole("button", { name: "Unsubscribe" })
  await expect(button).toBeFocused()
  expect(await button.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("heading", { level: 1, name: "You’re off the list." })).toBeFocused()
  await expect.poll(() => unsubscribedAt(id)).not.toBeNull()
  await page.keyboard.press(tabKey)
  await expect(page.locator("main").getByRole("link", { name: storeConfig.home.shopLabel })).toBeFocused()
  // The path carries the subscriber's id, so nothing that measures visits may load here.
  expect(measured).toEqual([])
})

test("honors a mail app's one-click unsubscribe, and ignores a scanner's GET", async ({ request }) => {
  const id = await subscribe()
  expect((await request.get(`/api/drop-unsubscribe/${id}`)).status()).toBe(405)
  expect(await unsubscribedAt(id)).toBeNull()
  const response = await request.post(`/api/drop-unsubscribe/${id}`, { form: { "List-Unsubscribe": "One-Click" } })
  expect(response.status()).toBe(200)
  expect(await unsubscribedAt(id)).not.toBeNull()
})

test("has nothing at a link that is not a subscriber's", async ({ page }) => {
  expect((await page.goto("/unsubscribe/not-a-token"))?.status()).toBe(404)
})

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false })

  test("the button still works and comes back finished", async ({ page }) => {
    const id = await subscribe()
    await page.goto(`/unsubscribe/${id}`)
    await page.getByRole("button", { name: "Unsubscribe" }).click()
    await expect(page).toHaveURL(new RegExp(`/unsubscribe/${id}$`))
    await expect(page.getByRole("heading", { level: 1, name: "You’re off the list." })).toBeVisible()
    expect(await unsubscribedAt(id)).not.toBeNull()
  })
})
