import { randomUUID } from "node:crypto"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"
import { expect, test, type Browser } from "@playwright/test"
import { Pool } from "pg"

import { adminTestConfig } from "./admin-test-config"

const config = adminTestConfig()
const auth = createClient(config.authURL, config.secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const database = new Pool({ connectionString: config.databaseUrl })
const address = "subscriber-support-admin@example.test"
const password = "Local-only-subscriber-fixture-12345678"
let userId: string

test.beforeAll(async () => {
  const users = await auth.auth.admin.listUsers()
  const previous = users.data.users.find((user) => user.email === address)
  if (previous) await auth.auth.admin.deleteUser(previous.id)
  const created = await auth.auth.admin.createUser({ email: address, password, email_confirm: true })
  if (created.error || !created.data.user) throw new Error("Local subscriber admin fixture unavailable")
  userId = created.data.user.id
  await database.query("insert into public.admin_memberships(user_id,active) values($1,true)", [userId])
})
test.afterAll(async () => {
  await auth.auth.admin.deleteUser(userId)
  await database.end()
})
async function signedIn(browser: Browser) {
  let cookies: { name: string; value: string }[] = []
  const client = createServerClient(config.authURL, config.publishableKey, {
    cookies: {
      getAll: () => cookies,
      setAll: (values) => {
        cookies = values
      },
    },
  })
  const { error } = await client.auth.signInWithPassword({ email: address, password })
  if (error) throw new Error("Local Supabase password session unavailable")
  const context = await browser.newContext({ baseURL: config.baseURL })
  await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: config.baseURL, sameSite: "Lax" })))
  return context
}

test("protects every subscriber operation with a current admin and denies both browser database roles", async ({
  browser,
  request,
}) => {
  const id = randomUUID()
  const actions = [
    { action: "lookup", email: "privacy@example.com" },
    { action: "unsubscribe", id },
    { action: "preview", id },
    {
      action: "erase",
      email: "privacy@example.com",
      preview: { id, updatedAt: "snapshot", deliveries: 0, confirmations: 0 },
    },
  ]
  for (const action of actions) {
    const response = await request.post("/api/admin/subscribers", { headers: { origin: config.baseURL }, data: action })
    expect(response.status()).toBe(401)
    expect(response.headers()["cache-control"]).toContain("no-store")
  }
  const context = await signedIn(browser)
  try {
    await database.query("update public.admin_memberships set active=false where user_id=$1", [userId])
    for (const action of actions)
      expect(
        (
          await context.request.post("/api/admin/subscribers", { headers: { origin: config.baseURL }, data: action })
        ).status()
      ).toBe(401)
    await database.query("update public.admin_memberships set active=true where user_id=$1", [userId])
    expect(
      (
        await context.request.post("/api/admin/subscribers", {
          headers: { origin: "https://foreign.example" },
          data: actions[0],
        })
      ).status()
    ).toBe(403)
    // This is the actual local Supabase schema, not a mocked role fixture.
    for (const role of ["anon", "authenticated"]) {
      const connection = await database.connect()
      try {
        await connection.query(`set role ${role}`)
        for (const table of ["drop_subscribers", "drop_signup_confirmations", "drop_email_deliveries"]) {
          await expect(connection.query(`select 1 from commerce.${table} limit 1`)).rejects.toThrow(/permission denied/)
          await expect(connection.query(`delete from commerce.${table}`)).rejects.toThrow(/permission denied/)
        }
      } finally {
        await connection.query("reset role")
        connection.release()
      }
    }
  } finally {
    await database.query("update public.admin_memberships set active=true where user_id=$1", [userId])
    await context.close()
  }
})

test("keeps private evidence out of URLs and safely erases only the reviewed identity", async ({ browser }) => {
  const context = await signedIn(browser)
  const page = await context.newPage()
  const id = (
    await database.query<{
      id: string
    }>(`insert into commerce.drop_subscribers(email,source,consent_copy_version,subscription_state,signup_ip)
    values ('support-target@example.com','footer','v1','legacy','203.0.113.7') returning id`)
  ).rows[0]!.id
  await database.query(
    `insert into commerce.drop_signup_confirmations(subscriber_id,token_hash,source,consent_copy_version,message)
    values($1,$2,'footer','v3','{"text":"private-confirmation-secret"}')`,
    [id, "a".repeat(64)]
  )
  try {
    const subscriberURLs: string[] = []
    page.on("request", (request) => {
      if (request.url().includes("subscribers")) subscriberURLs.push(request.url())
    })
    await page.goto("/admin/products/emails")
    await page.setViewportSize({ width: 375, height: 812 })
    await page.getByLabel("Subscriber email").fill("support-target@example.com")
    await page.getByLabel("Subscriber email").press("Tab")
    await expect(page.getByRole("button", { name: "Look up subscriber" })).toBeFocused()
    await page.keyboard.press("Enter")
    await page.getByText("Consent evidence", { exact: true }).click()
    await expect(
      page.getByText("We'll email you when a new design drops. Nothing else, and you can stop any time.", {
        exact: true,
      })
    ).toBeVisible()
    const lookup = await context.request.post("/api/admin/subscribers", {
      headers: { origin: config.baseURL },
      data: { action: "lookup", email: "support-target@example.com" },
    })
    expect(await lookup.text()).not.toContain("private-confirmation-secret")
    await page.getByRole("button", { name: "Unsubscribe", exact: true }).click()
    const confirmStop = page.getByRole("button", { name: "Confirm unsubscribe", exact: true })
    await expect(confirmStop).toBeFocused()
    await expect(page.getByText("Legacy consent", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Cancel unsubscribe", exact: true }).click()
    await expect(page.getByRole("button", { name: "Unsubscribe", exact: true })).toBeFocused()
    await page.getByRole("button", { name: "Unsubscribe", exact: true }).click()
    await confirmStop.click()
    await expect(page.getByRole("button", { name: "Keep unsubscribed / revoke new links" })).toBeVisible()
    expect(
      (
        await database.query(
          "select revoked_at,message from commerce.drop_signup_confirmations where subscriber_id=$1",
          [id]
        )
      ).rows[0]
    ).toMatchObject({ revoked_at: expect.any(Date), message: null })
    await page.getByRole("button", { name: "Preview erasure", exact: true }).click()
    const typed = page.getByLabel("Type the email to confirm erasure")
    await expect(typed).toBeFocused()
    await page.getByRole("button", { name: "Cancel", exact: true }).click()
    const previewButton = page.getByRole("button", { name: "Preview erasure", exact: true })
    await expect(previewButton).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(typed).toBeFocused()
    await typed.fill("support-target@example.com")
    // A repeat stop invalidates the open preview, even if the first stop time stays unchanged.
    await context.request.post("/api/admin/subscribers", {
      headers: { origin: config.baseURL },
      data: { action: "unsubscribe", id },
    })
    await page.getByRole("button", { name: "Erase subscriber", exact: true }).click()
    await expect(page.getByRole("alert").filter({ hasText: "This record changed" })).toBeVisible()
    await expect(typed).toHaveValue("")
    await expect(typed).toBeFocused()
    await typed.fill("support-target@example.com")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: ".tmp/subscribers/erasure-mobile.png", fullPage: true })
    // Commit succeeds, then its response is lost. Recovery must read the original UUID.
    await page.route("**/api/admin/subscribers", async (route) => {
      const body = route.request().postDataJSON() as { action: string }
      if (body.action !== "erase") {
        await route.continue()
        return
      }
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await database.query(
        `insert into commerce.drop_subscribers(email,source,consent_copy_version) values ('support-target@example.com','footer','v3')`
      )
      await route.abort("failed")
    })
    await page.getByRole("button", { name: "Erase subscriber", exact: true }).click()
    await expect(page.getByRole("alert").filter({ hasText: "response was lost" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Check original record", exact: true })).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.getByText(/original subscriber record is no longer present/)).toBeVisible()
    expect(
      (await database.query("select count(*) from commerce.drop_signup_confirmations where subscriber_id=$1", [id]))
        .rows[0].count
    ).toBe("0")
    const replacement = (
      await database.query("select id,subscription_state from commerce.drop_subscribers where email=$1", [
        "support-target@example.com",
      ])
    ).rows[0]
    expect(replacement.id).not.toBe(id)
    expect(replacement.subscription_state).toBe("pending")
    expect(
      subscriberURLs.every((url) => !url.includes(id) && !url.includes("support-target") && !url.includes("?"))
    ).toBe(true)
  } finally {
    await database.query("delete from commerce.drop_subscribers where email='support-target@example.com'")
    await context.close()
  }
})
