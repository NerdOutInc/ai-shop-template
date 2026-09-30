import { storeConfig } from "../../test/store-config"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

import { expect, test, type Page } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { Pool } from "pg"

import { seedCompleteGarment } from "../../test/seed-complete-garment"
import { listCadenceSlots } from "@/features/publishing/list-cadence-slots"
import { productionFingerprintVersion } from "@/lib/printify/production-fingerprint-version"
import { catalogProducts } from "../catalog-products"

import { adminTestConfig } from "./admin-test-config"
import { stubDropArtwork } from "../stub-drop-artwork"

const config = adminTestConfig()
const auth = createClient(config.authURL, config.secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const pool = new Pool({ connectionString: config.databaseUrl })
// Later journeys reuse the owner session; another email code would crowd the per-source send limit.
const ownerSession = ".tmp/admin-e2e/owner-session.json"

test.describe.configure({ mode: "serial" })

async function emailCode(address: string) {
  let code: string | undefined
  await expect
    .poll(
      async () => {
        const messages = (await (await fetch(`${config.mailURL}/api/v1/messages`)).json()) as {
          messages: { ID: string; To: { Address: string }[] }[]
        }
        const item = messages.messages.find((message) => message.To.some((recipient) => recipient.Address === address))
        if (!item) return false
        const body = (await (await fetch(`${config.mailURL}/api/v1/message/${item.ID}`)).json()) as {
          Text: string
          HTML: string
        }
        code = `${body.Text} ${body.HTML}`.match(/\b\d{6}\b/)?.[0]
        return Boolean(code)
      },
      { message: "A local verification code arrives through Supabase and Mailpit" }
    )
    .toBe(true)
  return code!
}

async function signInByEmail(page: Page, email: string) {
  await fetch(`${config.mailURL}/api/v1/messages`, { method: "DELETE" })
  await page.goto("/admin/sign-in")
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByRole("button", { name: "Send an email code" }).click()
  await page.getByLabel("Email verification code").fill(await emailCode(email))
  await page.getByRole("button", { name: "Verify and sign in" }).click()
}

// The fixture products' mockups live on a host that does not exist.
async function stubProductImages(page: Page) {
  await page.route("https://e2e.test/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#bc735c"/></svg>',
    })
  )
}

test.beforeAll(async () => {
  const { data, error } = await auth.auth.admin.listUsers()
  if (error) throw error
  for (const user of data.users)
    if ([config.ownerEmail, "library-other@example.test", "library-member@example.test"].includes(user.email ?? "")) {
      const removed = await auth.auth.admin.deleteUser(user.id)
      if (removed.error) throw removed.error
    }
  await fetch(`${config.mailURL}/api/v1/messages`, { method: "DELETE" })
  await seedDropEmailStock()
})
test.afterAll(async () => {
  await pool.end()
})

test("visitors cannot read gallery data or artwork", async ({ page, request }) => {
  await page.goto("/admin/concepts/1")
  await expect(page).toHaveURL(/\/admin\/sign-in$/)
  const result = await request.get("/api/admin/assets/11111111-1111-4111-8111-111111111111?download=1")
  expect(result.status()).toBe(401)
  expect(result.headers()["cache-control"]).toContain("no-store")
  expect(result.headers()["x-robots-tag"]).toContain("noindex")
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/)
  await page.goto("/admin/products")
  await expect(page).toHaveURL(/\/admin\/sign-in$/)
  const reorder = await request.put("/api/admin/products/featured-order", {
    headers: { origin: config.baseURL },
    data: { productIds: ["anything"] },
  })
  expect(reorder.status()).toBe(401)
  const visibility = await request.put("/api/admin/products/anything/visibility", {
    headers: { origin: config.baseURL },
    data: { hidden: true },
  })
  expect(visibility.status()).toBe(401)
  // Categories and garment setup are locked the same way: the pages send a visitor to sign in, and
  // every route turns away a request it would otherwise accept.
  for (const path of ["/admin/products/categories", "/admin/products/garments"]) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/admin\/sign-in$/)
  }
  const garmentSetup = {
    manufacturer: "Anything",
    model: "Anything",
    categorySlug: null,
    googleProductCategory: null,
    gender: null,
    ageGroup: null,
    sizeSystem: null,
  }
  for (const [method, path, data] of [
    ["POST", "/api/admin/products/categories", { name: "Anything" }],
    ["PUT", "/api/admin/products/categories", { categorySlugs: ["anything"] }],
    ["PUT", "/api/admin/products/categories/anything", { name: "Anything" }],
    ["DELETE", "/api/admin/products/categories/anything", undefined],
    ["PUT", "/api/admin/products/garments/9999", garmentSetup],
    // The name lookup checks no origin, because a browser sends none on a same-origin GET.
    ["GET", "/api/admin/products/garments/9999/catalog", undefined],
  ] as const) {
    const refused = await request.fetch(path, {
      method,
      headers: method === "GET" ? {} : { origin: config.baseURL },
      data,
    })
    expect(refused.status(), `${method} ${path}`).toBe(401)
    expect(refused.headers()["cache-control"], `${method} ${path}`).toContain("no-store")
  }
  const draftPath = "/api/admin/concepts/11111111-1111-4111-8111-111111111111/draft"
  const review = await request.get(`${draftPath}?number=1&revision=11111111-1111-4111-8111-111111111111`)
  expect(review.status()).toBe(401)
  const draft = await request.post(draftPath, {
    headers: { origin: config.baseURL },
    data: { action: "create", requestId: "11111111-1111-4111-8111-111111111111", displayNumber: 1 },
  })
  expect(draft.status()).toBe(401)
})

test("setup refuses both unconfirmed and confirmed accounts created outside enrollment", async ({ page }) => {
  const registration = createClient(config.authURL, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const credentials = { email: config.ownerEmail, password: "disposable-preexisting-account-password-123!" }
  const { data, error } = config.publicSignup
    ? await registration.auth.signUp(credentials)
    : await auth.auth.admin.createUser({ ...credentials, email_confirm: false })
  if (error || !data.user) throw error ?? new Error("Missing disposable registration")
  expect(data.user.email_confirmed_at).toBeFalsy()
  const existingId = data.user.id
  try {
    for (const confirmed of [false, true]) {
      if (confirmed) {
        const result = await auth.auth.admin.updateUserById(existingId, { email_confirm: true })
        if (result.error) throw result.error
      }
      await fetch(`${config.mailURL}/api/v1/messages`, { method: "DELETE" })
      await page.goto("/admin/setup")
      await page.getByLabel("Owner email").fill(config.ownerEmail)
      await page.getByLabel("One-time setup key").fill(config.setupSecret)
      await page.getByRole("button", { name: "Send an email code" }).click()
      await expect(page.getByRole("status")).toContainText("An existing account conflicts with owner setup")
      await expect(page.getByLabel("Email verification code")).toHaveCount(0)
      const state = (await pool.query("select enrollment_user_id,consumed_at from private.admin_setup_state")).rows[0]
      expect(state.enrollment_user_id).not.toBe(existingId)
      expect(state.consumed_at).toBeNull()
      expect((await pool.query("select * from public.admin_memberships")).rows).toHaveLength(0)
      const messages = (await (await fetch(`${config.mailURL}/api/v1/messages`)).json()) as { total: number }
      expect(messages.total).toBe(0)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByLabel("Owner email").focus()
    await page.keyboard.press("Tab")
    await expect(page.getByLabel("One-time setup key")).toBeFocused()
    await page.screenshot({ path: "test-results/admin/owner-enrollment-conflict.png", fullPage: true })
  } finally {
    // Remove only this disposable registration. Keep the reserved ID to verify a fresh retry next.
    const removed = await auth.auth.admin.deleteUser(existingId)
    if (removed.error) throw removed.error
    await pool.query("truncate private.admin_auth_attempts")
  }
})

test("owner setup, passkeys, exact private downloads, personal favorites and revocation work together", async ({
  page,
  context,
  browser,
}) => {
  const cdp = await context.newCDPSession(page)
  await cdp.send("WebAuthn.enable")
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  await page.goto("/admin/setup")
  await page.getByLabel("Owner email").fill(config.ownerEmail)
  await page.getByLabel("One-time setup key").fill(config.setupSecret)
  await page.getByRole("button", { name: "Send an email code" }).click()
  await expect(page.getByLabel("Email verification code")).toBeVisible()
  const enrollment = (await pool.query("select enrollment_user_id,consumed_at from private.admin_setup_state")).rows[0]
  expect(enrollment.consumed_at).toBeNull()
  expect((await pool.query("select * from public.admin_memberships")).rows).toHaveLength(0)
  // With signup disabled, this is the production OTP path; the other CI case also checks duplicate signup.
  const registration = createClient(config.authURL, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const attemptedPassword = "disposable-new-registration-password-123!"
  const duplicate = await registration.auth.signUp({ email: config.ownerEmail, password: attemptedPassword })
  if (!config.publicSignup) expect(duplicate.error?.code).toBe("signup_disabled")
  expect(
    (await registration.auth.signInWithPassword({ email: config.ownerEmail, password: attemptedPassword })).error
  ).not.toBeNull()
  const provisioned = await auth.auth.admin.getUserById(enrollment.enrollment_user_id)
  expect(provisioned.error).toBeNull()
  expect(provisioned.data.user?.email).toBe(config.ownerEmail)
  await page.getByLabel("Email verification code").fill(await emailCode(config.ownerEmail))
  await page.getByRole("button", { name: "Verify and finish setup" }).click()
  await expect(page).toHaveURL(/\/admin\/account$/)
  await page.getByRole("button", { name: "Add a passkey", exact: true }).click()
  await expect(page.getByText("Passkey added.", { exact: false })).toBeVisible()

  execFileSync(process.execPath, ["--conditions=react-server", "--import=tsx", "e2e/admin/seed-library.ts"], {
    stdio: "pipe",
    timeout: 120_000,
  })
  await page.getByRole("link", { name: "Designs", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Your design library." })).toBeVisible()
  await expect(page.getByRole("status")).toContainText("3 designs")
  const thumbnails = page.locator("article img")
  await expect(thumbnails.first()).toBeVisible()
  await expect
    .poll(() =>
      thumbnails.evaluateAll(
        (images) =>
          images.filter((image) => {
            const element = image as HTMLImageElement
            return element.complete && element.naturalWidth > 0
          }).length
      )
    )
    .toBeGreaterThan(0)
  expect(await page.getByText("Artwork could not load", { exact: false }).count()).toBe(0)
  await expect(page.locator("main#main-content")).toHaveCount(1)
  expect(
    await page.evaluate(
      () => document.querySelectorAll('script[src*="vercel-scripts.com"],script[src*="insights/script"]').length
    )
  ).toBe(0)
  await page.goto("/admin/concepts/1")
  await expect(page.getByRole("heading", { name: "Sample Character", exact: true })).toBeVisible()
  const printFile = page.getByRole("link", { name: "Download print file", exact: true })
  const downloadURL = await printFile.getAttribute("href")
  expect(downloadURL).toMatch(/^\/api\/admin\/assets\//)
  const response = await context.request.get(downloadURL!)
  expect(response.status()).toBe(200)
  expect(response.headers()["content-disposition"]).toContain("attachment")
  const bytes = await response.body()
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(response.headers()["x-content-sha256"])
  expect(response.headers()["cache-control"]).toContain("no-store")

  // A browsing size is derived from the same master and must be far smaller than it: the
  // whole point is that a gallery card never downloads a print file.
  const small = await context.request.get(`${downloadURL}&size=small`)
  expect(small.status()).toBe(200)
  expect(small.headers()["content-type"]).toBe("image/webp")
  const smallBytes = await small.body()
  expect(smallBytes.byteLength).toBeLessThan(bytes.byteLength / 2)
  expect(Number(small.headers()["content-length"])).toBe(smallBytes.byteLength)
  // src/proxy.ts puts private, no-store on every /api/admin response; a derived size is
  // still private artwork and gets the same treatment.
  expect(small.headers()["cache-control"]).toContain("no-store")
  // Derived once: the second request is served from the private store, byte for byte.
  const again = await context.request.get(`${downloadURL}&size=small`)
  expect(Buffer.from(await again.body()).equals(Buffer.from(smallBytes))).toBe(true)
  expect((await context.request.get(`${downloadURL}&size=enormous`)).status()).toBe(404)

  await page.getByRole("button", { name: "Favorite design #1", exact: true }).click()
  await expect(page.getByRole("button", { name: "Remove design #1 from my favorites", exact: true })).toBeVisible()

  const secondDevice = await browser.newContext({ baseURL: config.baseURL })
  const secondPage = await secondDevice.newPage()
  await signInByEmail(secondPage, config.ownerEmail)
  await expect(secondPage).toHaveURL(/\/admin\/concepts$/)
  await secondPage.goto("/admin/concepts?favorites=1")
  await expect(secondPage.getByText("Sample Character", { exact: true })).toBeVisible()

  const { data: other, error: otherError } = await auth.auth.admin.createUser({
    email: "library-other@example.test",
    email_confirm: true,
  })
  if (otherError || !other.user) throw otherError ?? new Error("Missing fixture admin")
  await pool.query("insert into public.admin_memberships(user_id,active) values($1,true)", [other.user.id])
  const otherDevice = await browser.newContext({ baseURL: config.baseURL })
  const otherPage = await otherDevice.newPage()
  await signInByEmail(otherPage, "library-other@example.test")
  await expect(otherPage).toHaveURL(/\/admin\/concepts$/)
  await otherPage.goto("/admin/concepts?favorites=1")
  await expect(otherPage.getByRole("status")).toHaveText("0 designs")
  await pool.query("update public.admin_memberships set active=false where user_id=$1", [other.user.id])
  expect((await otherDevice.request.get(downloadURL!)).status()).toBe(403)
  await otherPage.reload()
  await expect(otherPage).toHaveURL(/\/admin\/sign-in$/)
  await otherDevice.close()
  await secondDevice.close()

  const { error: memberError } = await auth.auth.admin.createUser({
    email: "library-member@example.test",
    email_confirm: true,
  })
  if (memberError) throw memberError
  const memberDevice = await browser.newContext({ baseURL: config.baseURL })
  const memberPage = await memberDevice.newPage()
  await signInByEmail(memberPage, "library-member@example.test")
  await expect(
    memberPage.getByText("This account has no active administrator membership.", { exact: false })
  ).toBeVisible()
  expect((await memberDevice.request.get(downloadURL!)).status()).toBe(401)
  await memberDevice.close()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/admin/concepts/1")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.keyboard.press("Tab")
  const focus = await page
    .locator(":focus")
    .evaluate((element) => ({ tag: element.tagName, outline: getComputedStyle(element).outlineStyle }))
  expect(focus.tag).not.toBe("BODY")
  expect(focus.outline).not.toBe("none")
  await page.screenshot({ path: "test-results/admin/library-narrow.png", fullPage: true })

  // This store has no Printify draft access. The control must say so in plain words, having
  // reserved nothing, and the refusal must not push the narrow page sideways.
  await page.getByRole("button", { name: "Create Printify draft", exact: true }).click()
  await expect(page.getByText("Printify draft access is not configured for this store yet")).toBeVisible()
  await expect(page.getByRole("button", { name: "Create draft", exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect((await pool.query("select 1 from private.design_draft_requests")).rowCount).toBe(0)

  await page.goto("/admin/agents")
  const draftPermission = page.getByLabel("Create product drafts")
  await expect(draftPermission).toBeChecked()
  await draftPermission.focus()
  await page.keyboard.press("Space")
  await expect(draftPermission).not.toBeChecked()
  await page.keyboard.press("Space")
  await expect(draftPermission).toBeChecked()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByLabel("Add and review design batches").uncheck()
  await page.getByLabel("Create product drafts").uncheck()
  await page.getByRole("button", { name: "Create agent access", exact: true }).click()
  const credentialDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download credential file", exact: true }).click()
  const credentialFile = await (await credentialDownload).path()
  if (!credentialFile) throw new Error("The credential was not downloaded")
  const credential = (await readFile(credentialFile, "utf8")).trim()
  const agentDevice = await browser.newContext({ baseURL: config.baseURL })
  const agentHeaders = { authorization: `Bearer ${credential}` }
  const designRead = await agentDevice.request.post("/api/admin/agent", {
    headers: agentHeaders,
    data: { command: "library.get", number: 1 },
  })
  expect(designRead.status()).toBe(200)
  expect((await agentDevice.request.get(downloadURL!, { headers: agentHeaders })).status()).toBe(200)
  const deniedWrite = await agentDevice.request.post("/api/admin/agent", {
    headers: agentHeaders,
    data: {
      command: "batch.create",
      requestId: "329b35b4-601c-4e13-abf7-74d8075d65ca",
      title: "Not authorized",
      brief: "Read-only grants cannot start a batch",
      count: 50,
    },
  })
  expect(deniedWrite.status()).toBe(401)
  // A proposal spends the store's drafts token, so reading the library does not earn one.
  const deniedProposal = await agentDevice.request.post("/api/admin/agent", {
    headers: agentHeaders,
    data: { command: "drafts.propose", numbers: [1] },
  })
  expect(deniedProposal.status()).toBe(401)
  await page.getByRole("button", { name: "Revoke", exact: true }).click()
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible()
  expect((await agentDevice.request.get(downloadURL!, { headers: agentHeaders })).status()).toBe(401)

  // With draft authority the proposal is answered, and answering it reserves nothing.
  await page.getByLabel("Create product drafts").check()
  await page.getByRole("button", { name: "Create agent access", exact: true }).click()
  const draftCredentialDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download credential file", exact: true }).click()
  const draftCredentialFile = await (await draftCredentialDownload).path()
  if (!draftCredentialFile) throw new Error("The draft credential was not downloaded")
  const draftHeaders = { authorization: `Bearer ${(await readFile(draftCredentialFile, "utf8")).trim()}` }
  const unknownProposal = await agentDevice.request.post("/api/admin/agent", {
    headers: draftHeaders,
    data: { command: "drafts.propose", numbers: [999999] },
  })
  expect(unknownProposal.status()).toBe(200)
  expect((await unknownProposal.json()).result.proposals).toEqual([
    expect.objectContaining({
      number: 999999,
      design: null,
      recipe: null,
      blockers: ["Design #999999 is not in this library"],
    }),
  ])
  // This store has no Printify draft access, so a real design is refused rather than guessed at.
  const unconfiguredProposal = await agentDevice.request.post("/api/admin/agent", {
    headers: draftHeaders,
    data: { command: "drafts.propose", numbers: [1] },
  })
  expect(unconfiguredProposal.status()).toBe(400)
  expect((await unconfiguredProposal.json()).error).toContain("Printify draft access is not configured")
  expect((await pool.query("select 1 from private.design_draft_requests")).rowCount).toBe(0)
  await page.getByRole("button", { name: "Revoke", exact: true }).click()
  await expect(page.getByText("Revoked", { exact: true })).toHaveCount(2)
  await agentDevice.close()

  await page.getByRole("link", { name: "Account", exact: true }).click()
  await page.getByRole("button", { name: "Sign out on this device", exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/sign-in$/)
  await page.getByRole("button", { name: "Sign in with a passkey", exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/concepts$/)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: "test-results/admin/library-signed-in.png" })
  await context.storageState({ path: ownerSession })

  // Local fixture assets are byte-verified; these tests do not upload a production Blob or create products.
  const map = JSON.parse(await readFile(".tmp/admin-e2e/blob-files.json", "utf8")) as Record<string, unknown>
  expect(Object.keys(map).length).toBeGreaterThanOrEqual(9)
})

test("owner arranges the featured lineup and the shop follows it", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: config.baseURL, storageState: ownerSession })
  const page = await context.newPage()
  const lineup = catalogProducts.slice(0, 3)
  const [firstDesign, secondDesign, newestDesign] = lineup.map((product) => product.title)
  await pool.query("delete from commerce.product_week_schedule where shop_id='123'")
  await pool.query("delete from commerce.printify_products where shop_id='123'")
  // Showing a tee is refused until its garment is complete. Seed this synthetic shop explicitly.
  await seedCompleteGarment(pool, "123")
  for (const product of lineup)
    await pool.query(
      // hidden_at is named: the reveal gate defaults it to now(), which would hide the fixture.
      "insert into commerce.printify_products (shop_id,product_id,snapshot,active,hidden_at) values ('123',$1,$2::jsonb,true,null)",
      [product.id, JSON.stringify({ ...product, visible: true, blueprint_id: 1317 })]
    )
  // Product artwork uses a public Blob host that does not exist here.
  await stubDropArtwork(page)
  await stubProductImages(page)
  // Direct seeding skips the app's cache refresh, and the data cache outlives server restarts.
  const reset = await context.request.put("/api/admin/products/featured-order", {
    headers: { origin: config.baseURL },
    data: { productIds: lineup.map((product) => product.id) },
  })
  expect(reset.status()).toBe(200)
  const shopTitles = page.getByRole("main").getByRole("heading", { level: 2 })
  await page.goto("/shop")
  await expect(shopTitles).toHaveText([firstDesign!, secondDesign!, newestDesign!])

  await page.goto("/admin/concepts")
  const nav = page.getByRole("navigation", { name: "Primary navigation" })
  await expect(nav.getByRole("link")).toHaveText(["Designs", "Products", "Orders", "Account"])
  await nav.getByRole("link", { name: "Products", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Shop lineup" })).toBeVisible()
  await expect(nav.getByRole("link", { name: "Products", exact: true })).toHaveAttribute("aria-current", "page")
  const rows = page.getByRole("list", { name: "Available products" }).getByRole("link")
  await expect(rows).toHaveText([firstDesign, secondDesign, newestDesign].map((title) => `View in shop: ${title}`))

  const saved = () =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/products/featured-order") && response.request().method() === "PUT"
    )
  const announcement = page.getByRole("status").filter({ hasText: `${newestDesign} ` })
  // dnd-kit ignores arrows for a moment after pickup while it measures rows; retry only an unmoved row.
  async function moveUp(expected: string) {
    const unmoved = await announcement.textContent()
    await expect(async () => {
      if ((await announcement.textContent()) === unmoved) await page.keyboard.press("ArrowUp")
      await expect(announcement).toContainText(expected, { timeout: 250 })
    }).toPass()
  }
  let save = saved()
  await page.getByRole("button", { name: `Reorder ${newestDesign}` }).focus()
  await page.keyboard.press("Space")
  const dragOverlay = page.locator("[data-product-drag-overlay]")
  // The first over-position announcement can immediately replace pickup; the visible row persists.
  await expect(dragOverlay).toBeVisible()
  await expect(dragOverlay).toContainText(newestDesign!)
  await expect(dragOverlay.locator("img")).toBeVisible()
  await moveUp("position 2 of 3")
  await moveUp("position 1 of 3")
  await page.keyboard.press("Space")
  expect((await save).status()).toBe(200)
  await expect(rows).toHaveText([newestDesign, firstDesign, secondDesign].map((title) => `View in shop: ${title}`))

  const from = await page.getByRole("button", { name: `Reorder ${secondDesign}` }).boundingBox()
  const toHandle = page.getByRole("button", { name: `Reorder ${newestDesign}` })
  const to = await toHandle.boundingBox()
  const toRow = await toHandle.locator("xpath=ancestor::li").boundingBox()
  if (!from || !to || !toRow) throw new Error("Drag handles are not visible")
  save = saved()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  // Release in the gap just below the first row, outside every droppable row box.
  await page.mouse.move(to.x + to.width / 2, toRow.y + toRow.height + 1, { steps: 12 })
  await expect(page.locator("[data-product-drag-overlay]")).toBeVisible()
  await expect(page.locator("[data-product-drag-overlay]")).toContainText(secondDesign!)
  await page.mouse.up()
  expect((await save).status()).toBe(200)
  await expect(rows).toHaveText([secondDesign, newestDesign, firstDesign].map((title) => `View in shop: ${title}`))

  // The complete row follows the pointer through dnd-kit's DragOverlay above; menu actions provide
  // the same reorder operation without requiring a drag.
  await expect(page.locator("[data-product-drag-overlay]")).toHaveCount(0)
  await page.getByRole("button", { name: `Actions for ${newestDesign}` }).click()
  save = saved()
  await page.getByRole("menuitem", { name: "Move up in shop" }).click()
  expect((await save).status()).toBe(200)
  await expect(page.getByText("Changes saved.")).toBeVisible()

  const expected = [newestDesign, secondDesign, firstDesign]
  await page.reload()
  await expect(rows).toHaveText(expected.map((title) => `View in shop: ${title}`))
  await page.goto("/shop")
  await expect(shopTitles).toHaveText(expected.map(String))

  const hidden = page.getByRole("list", { name: "Hidden products" })
  const visibilitySaved = () =>
    page.waitForResponse(
      (response) =>
        /\/api\/admin\/products\/[^/]+\/visibility$/.test(response.url()) && response.request().method() === "PUT"
    )
  const scheduleSaved = (method = "PUT") =>
    page.waitForResponse(
      (response) => response.url().endsWith("/api/admin/product-schedule") && response.request().method() === method
    )

  // Hidden products have a full admin preview, while both private and public routes stay 404 for visitors.
  await page.goto("/admin/products")
  await page.getByRole("button", { name: `Actions for ${secondDesign}` }).click()
  let visibility = visibilitySaved()
  await page.getByRole("menuitem", { name: "Hide from shop" }).click()
  expect((await visibility).status()).toBe(200)
  await expect(rows).toHaveText([newestDesign, firstDesign].map((title) => `View in shop: ${title}`))
  const previewPath = `/admin/products/${lineup[1]!.id}`
  const preview = hidden.getByRole("link", { name: new RegExp(`Preview product\\s*:\\s*${secondDesign}`) })
  await expect(preview).toHaveAttribute("href", previewPath)
  await preview.click()
  await expect(page).toHaveURL((url) => url.pathname === previewPath)
  await expect(page.getByRole("heading", { level: 1, name: secondDesign })).toBeVisible()
  await expect(page.getByRole("complementary", { name: "Admin preview" })).toBeVisible()
  await expect(page.getByText("Purchasing is disabled in admin preview.")).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/)
  const visitor = await browser.newContext({ baseURL: config.baseURL })
  for (const path of [previewPath, `/shop/${lineup[1]!.id}`]) {
    const denied = await visitor.request.get(path)
    expect(denied.status(), path).toBe(404)
    expect(await denied.text()).not.toContain(secondDesign!)
  }
  await visitor.close()
  await page.getByRole("link", { name: "Back to shop lineup" }).click()

  const weeks = page.locator("[data-week-drop]")
  await expect(weeks).toHaveCount(6)
  const firstWeek = weeks.nth(0)
  const secondWeek = weeks.nth(1)
  const firstDate = (await firstWeek.getAttribute("data-week-drop"))!
  const secondDate = (await secondWeek.getAttribute("data-week-drop"))!
  const scheduleRequests: string[] = []
  page.on("request", (request) => {
    if (request.url().endsWith("/api/admin/product-schedule") && request.method() === "PUT") {
      scheduleRequests.push(request.postData() ?? "")
    }
  })
  // Picking up and dropping a hidden product without choosing a week must never set a reveal.
  for (const dropKey of ["Space", "Enter"]) {
    await hidden.getByRole("button", { name: `Reorder ${secondDesign}` }).focus()
    await page.keyboard.press("Space")
    await expect(dragOverlay).toBeVisible()
    // KeyboardSensor attaches its key listener in a zero-delay timer after showing the overlay.
    await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
    await page.keyboard.press(dropKey)
    await expect(dragOverlay).toHaveCount(0)
    expect(scheduleRequests).toHaveLength(0)
  }
  expect(
    (
      await pool.query("select reveal_at from commerce.printify_products where shop_id='123' and product_id=$1", [
        lineup[1]!.id,
      ])
    ).rows[0].reveal_at
  ).toBeNull()
  expect(
    (await pool.query("select id from commerce.product_week_schedule where shop_id='123' and ended_at is null")).rows
  ).toHaveLength(0)
  await firstWeek.getByRole("button", { name: "Add the first product" }).click()
  const picker = page.getByRole("dialog", { name: "Add products to this week" })
  await expect(picker).toBeVisible()
  await picker.getByRole("checkbox", { name: new RegExp(`^${secondDesign}`) }).check()
  await picker.getByRole("checkbox", { name: new RegExp(`^${firstDesign}`) }).check()
  let scheduling = scheduleSaved()
  await picker.getByRole("button", { name: "Add 2 products" }).click()
  expect((await scheduling).status()).toBe(200)
  await expect(picker).toHaveCount(0)
  await expect(firstWeek.getByRole("listitem")).toHaveCount(2)
  await expect(firstWeek.getByRole("button", { name: `Scheduled actions for ${secondDesign}` })).toBeVisible()
  await expect(firstWeek.getByRole("button", { name: `Scheduled actions for ${firstDesign}` })).toBeVisible()
  // Scheduling a shown product preserves visibility; the hidden one stays hidden until the slot.
  expect((await context.request.get(`/shop/${lineup[1]!.id}`)).status()).toBe(404)
  expect((await context.request.get(`/shop/${lineup[0]!.id}`)).status()).toBe(200)
  expect(
    (
      await pool.query("select reveal_at from commerce.printify_products where shop_id='123' and product_id=$1", [
        lineup[1]!.id,
      ])
    ).rows[0].reveal_at.toISOString()
  ).toBe(firstDate)

  const scheduledRequests = scheduleRequests.length
  for (const dropKey of ["Space", "Enter"]) {
    await firstWeek.getByRole("button", { name: `Move ${secondDesign} to another week by dragging` }).focus()
    await page.keyboard.press("Space")
    await expect(dragOverlay).toBeVisible()
    await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
    await page.keyboard.press(dropKey)
    await expect(dragOverlay).toHaveCount(0)
    expect(scheduleRequests).toHaveLength(scheduledRequests)
    await expect(firstWeek.getByRole("listitem")).toHaveCount(2)
  }

  await firstWeek.getByRole("button", { name: `Scheduled actions for ${secondDesign}` }).click()
  await page.getByRole("menuitem", { name: "Change week" }).click()
  const change = page.getByRole("dialog", { name: "Change featured week" })
  await change.getByLabel("Featured week").selectOption(secondDate)
  scheduling = scheduleSaved()
  await change.getByRole("button", { name: "Save featured week" }).click()
  expect((await scheduling).status()).toBe(200)
  await expect(firstWeek.getByRole("listitem")).toHaveCount(1)
  await expect(secondWeek.getByRole("listitem")).toHaveCount(1)
  await secondWeek.getByRole("button", { name: `Scheduled actions for ${secondDesign}` }).click()
  scheduling = scheduleSaved("DELETE")
  await page.getByRole("menuitem", { name: "Remove from this week" }).click()
  expect((await scheduling).status()).toBe(200)
  await expect(secondWeek.getByRole("listitem")).toHaveCount(0)
  expect(
    (
      await pool.query("select reveal_at from commerce.printify_products where shop_id='123' and product_id=$1", [
        lineup[1]!.id,
      ])
    ).rows[0].reveal_at
  ).toBeNull()
  expect((await context.request.get(`/shop/${lineup[1]!.id}`)).status()).toBe(404)

  // The real visibility action restores the product's original lineup slot immediately.
  await page.getByRole("button", { name: `Actions for ${secondDesign}` }).click()
  visibility = visibilitySaved()
  await page.getByRole("menuitem", { name: "Show in shop" }).click()
  expect((await visibility).status()).toBe(200)
  await expect(rows).toHaveText(expected.map((title) => `View in shop: ${title}`))

  // Seed one arrived product feature. The public page and admin current-week list agree on the
  // explicit product ID and its arrived reveal.
  const now = new Date()
  const liveAt = listCadenceSlots({
    cadence: { ...storeConfig.weeklyFeature, timeZone: storeConfig.timeZone },
    from: new Date(now.getTime() - 15 * 86_400_000),
    count: 3,
  })
    .filter((instant) => instant.getTime() <= now.getTime())
    .at(-1)!
    .toISOString()
  await pool.query("delete from commerce.product_week_schedule where shop_id='123'")
  await pool.query(
    "update commerce.printify_products set hidden_at=$2::timestamptz - interval '1 day',reveal_at=$2 where shop_id='123' and product_id=$1",
    [lineup[1]!.id, liveAt]
  )
  await pool.query(
    `insert into commerce.product_week_schedule (shop_id,product_id,live_at,featured_by)
     values ('123',$1,$2,gen_random_uuid())`,
    [lineup[1]!.id, liveAt]
  )
  // Direct fixture writes need the same cache refresh that normal admin mutations perform.
  expect(
    (
      await context.request.put("/api/admin/products/featured-order", {
        headers: { origin: config.baseURL },
        data: { productIds: [lineup[2]!.id, lineup[1]!.id, lineup[0]!.id] },
      })
    ).status()
  ).toBe(200)
  await page.reload()
  const currentWeek = page.getByRole("list", { name: "Design of the Week products" })
  await expect(page.getByRole("heading", { level: 2, name: "This week", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { level: 2, name: "Design of the Week", exact: true })).toHaveCount(1)
  await expect(currentWeek.getByRole("link")).toHaveText([`View in shop: ${secondDesign}`])
  await expect(rows).toHaveText([newestDesign, firstDesign].map((title) => `View in shop: ${title}`))
  expect((await context.request.get(`/shop/${lineup[1]!.id}`)).status()).toBe(200)
  await page.goto("/#design-of-the-week")
  await expect(
    page.getByRole("list", { name: "Design of the Week products" }).getByRole("article", { name: secondDesign })
  ).toBeVisible()
  await page.goto("/admin/concepts/1")
  await expect(page.getByRole("link", { name: "Products", exact: true }).last()).toHaveAttribute(
    "href",
    "/admin/products"
  )
  await expect(page.getByRole("button", { name: /Feature this design/ })).toHaveCount(0)
  await page.goto("/admin/products")

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/admin/products")
  await expect(rows).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole("button", { name: `Reorder ${newestDesign}` }).focus()
  expect(await page.locator(":focus").evaluate((element) => getComputedStyle(element).boxShadow !== "none")).toBe(true)
  await page.screenshot({ path: "test-results/admin/featured-order-narrow.png", fullPage: true })
  await context.close()
})

test("a tee on a garment nobody has set up stays off the wall until the owner finishes it", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: config.baseURL, storageState: ownerSession })
  const page = await context.newPage()
  const selling = catalogProducts[0]!
  const waiting = catalogProducts[1]!
  // Its own rows, so nothing leans on what the lineup journey left behind. No drop may hold the tee
  // either: a Design of the Week row has no Show button to wait on.
  await pool.query("delete from commerce.product_week_schedule where shop_id='123'")
  await pool.query("delete from commerce.printify_products where shop_id='123'")
  await pool.query("delete from commerce.garment_models where shop_id='123' and blueprint_id=9999")
  // Garment 1317 and the T-shirts category it hangs on. Blueprint 9999 gets nothing at all, because
  // no row is exactly what a garment nobody has set up looks like.
  await seedCompleteGarment(pool, "123")
  for (const [product, blueprintId, hidden] of [
    [selling, 1317, false],
    [waiting, 9999, true],
  ] as const)
    await pool.query(
      // hidden_at is named here too: the waiting tee is hidden on purpose, the selling one is not.
      "insert into commerce.printify_products (shop_id,product_id,snapshot,active,hidden_at) values ('123',$1,$2::jsonb,true,case when $3::boolean then now() end)",
      [product.id, JSON.stringify({ ...product, visible: true, blueprint_id: blueprintId }), hidden]
    )
  const hiddenInPostgres = async () =>
    (
      await pool.query<{ hidden: boolean }>(
        "select hidden_at is not null as hidden from commerce.printify_products where shop_id='123' and product_id=$1",
        [waiting.id]
      )
    ).rows[0]?.hidden
  await stubProductImages(page)
  // Direct seeding skips the app's cache refresh, exactly as in the lineup journey.
  const reset = await context.request.put("/api/admin/products/featured-order", {
    headers: { origin: config.baseURL },
    data: { productIds: [selling.id, waiting.id] },
  })
  expect(reset.status()).toBe(200)
  const shopTitles = page.getByRole("main").getByRole("heading", { level: 2 })
  await page.goto("/shop")
  await expect(shopTitles).toHaveText([selling.title])

  await page.goto("/admin/products")
  await expect(page.getByText("1 product is waiting on garment setup and cannot be shown or scheduled.")).toBeVisible()
  const available = page.getByRole("list", { name: "Available products" })
  const hidden = page.getByRole("list", { name: "Hidden products" })
  await expect(hidden.getByText("Garment setup missing.")).toBeVisible()
  // The notice belongs to the garment, so the tee on a finished one carries none.
  await expect(available.getByText("Garment setup missing.")).toHaveCount(0)
  // Not offered, rather than offered and refused; the notice is the button's stated reason.
  const actions = page.getByRole("button", { name: `Actions for ${waiting.title}` })
  await actions.click()
  const show = page.getByRole("menuitem", { name: "Show in shop" })
  await expect(show).toBeDisabled()
  await expect(page.getByRole("menuitem", { name: "Add to Design of the week" })).toBeDisabled()
  await page.keyboard.press("Escape")
  // The disabled button is a courtesy and the server is the gate: a stale tab that still offers
  // Show is refused, and the tee stays exactly where it was.
  const refused = await context.request.put(`/api/admin/products/${waiting.id}/visibility`, {
    headers: { origin: config.baseURL },
    data: { hidden: false },
  })
  expect(refused.status()).toBe(409)
  expect(await refused.json()).toMatchObject({ code: "GARMENT_INCOMPLETE" })
  expect(await hiddenInPostgres()).toBe(true)

  // The row's link lands on that garment's own card and takes focus there, so a keyboard user is
  // not left to Tab past every other garment.
  await hidden.getByRole("link", { name: new RegExp(`Set up blueprint 9999\\s+for ${waiting.title}`) }).click()
  await expect(page).toHaveURL(/\/admin\/products\/garments#garment-9999$/)
  await expect(page.getByRole("heading", { name: "Garment models", level: 1 })).toBeVisible()
  const card = page.locator("#garment-9999")
  await expect(page.getByRole("list", { name: "Garments that need setup" }).locator("#garment-9999")).toBeVisible()
  await expect(card).toBeFocused()
  await expect(card).toContainText("Found on 1 published product, 0 shown; not set up yet")

  // This store has no Printify token. The lookup says so in plain words and fills in nothing, and
  // typing the name by hand carries on working, which is the whole point of it being a shortcut.
  // Matched by their start: each button ends in a visually hidden ": Blueprint 9999", and Chromium
  // puts a space before it that the source does not have.
  await card.getByRole("button", { name: /^Look up name from Printify/ }).click()
  await expect(card.getByRole("alert")).toContainText("Printify's catalog is not answering")
  await expect(card.getByLabel("Manufacturer", { exact: true })).toHaveValue("")
  await card.getByLabel("Manufacturer", { exact: true }).fill("Fixture Mill")
  await card.getByLabel("Model", { exact: true }).fill("Sample Tee")
  await card.getByLabel("Shop category", { exact: true }).selectOption({ label: "T-shirts" })
  await card.getByLabel("Google product category", { exact: true }).fill("212")
  await card.getByLabel("Gender", { exact: true }).selectOption({ label: "Unisex" })
  await card.getByLabel("Age group", { exact: true }).selectOption({ label: "Adult" })
  await card.getByLabel("Size system", { exact: true }).selectOption({ label: "US" })
  const garmentSaved = page.waitForResponse(
    (response) => response.url().endsWith("/api/admin/products/garments/9999") && response.request().method() === "PUT"
  )
  await card.getByRole("button", { name: /^Save garment/ }).click()
  expect((await garmentSaved).status()).toBe(200)
  // Finished, so the card moves to the other list under its new name, and focus follows it there.
  const readyCard = page.getByRole("list", { name: "Ready garments" }).locator("#garment-9999")
  await expect(readyCard).toHaveAccessibleName(/Fixture Mill Sample Tee\s*Ready/)
  await expect(readyCard).toBeFocused()
  // Complete is Postgres's answer (a generated column), not something the page worked out.
  expect(
    (
      await pool.query(
        "select complete, category_slug from commerce.garment_models where shop_id='123' and blueprint_id=9999"
      )
    ).rows
  ).toEqual([{ complete: true, category_slug: "t-shirts" }])

  // Back on Products, by the owner's own route. The garment was the only thing in the way.
  await page
    .getByRole("navigation", { name: "Products sections" })
    .getByRole("link", { name: "Shop lineup", exact: true })
    .click()
  await expect(page.getByRole("heading", { name: "Shop lineup" })).toBeVisible()
  // One link left in the row: the notice, and the link that came with it, are gone.
  await expect(hidden.getByRole("link")).toHaveAttribute("href", `/admin/products/${waiting.id}`)
  await expect(page.getByText("waiting on garment setup")).toHaveCount(0)
  await actions.click()
  await expect(show).toBeEnabled()
  const visibility = page.waitForResponse(
    (response) =>
      /\/api\/admin\/products\/[^/]+\/visibility$/.test(response.url()) && response.request().method() === "PUT"
  )
  await show.click()
  expect((await visibility).status()).toBe(200)
  await expect(available.getByRole("link")).toHaveText(
    [selling.title, waiting.title].map((title) => `View in shop: ${title}`)
  )
  await expect(hidden).toHaveCount(0)
  expect(await hiddenInPostgres()).toBe(false)
  await page.goto("/shop")
  await expect(shopTitles).toHaveText([selling.title, waiting.title])

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/admin/products/garments")
  await expect(readyCard).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await readyCard.getByLabel("Manufacturer", { exact: true }).focus()
  expect(await page.locator(":focus").evaluate((element) => getComputedStyle(element).boxShadow !== "none")).toBe(true)
  await page.screenshot({ path: "test-results/admin/garment-models-narrow.png", fullPage: true })

  // Assigned once per garment: both of this shop's garments now hang on the one category, which is
  // why it cannot be deleted out from under them.
  await page.goto("/admin/products/categories")
  const categories = page.getByRole("list", { name: "Shop categories" })
  await expect(categories.getByRole("listitem").filter({ hasText: "T-shirts" })).toContainText(
    "Slug t-shirts · 2 garments"
  )
  await expect(categories.getByRole("button", { name: "Delete T-shirts" })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByLabel("New category name", { exact: true }).focus()
  expect(await page.locator(":focus").evaluate((element) => getComputedStyle(element).boxShadow !== "none")).toBe(true)
  await page.screenshot({ path: "test-results/admin/categories-narrow.png", fullPage: true })
  await context.close()
})

// Here rather than in the public suite because this build uses the local origin, so the form's
// same-origin guard lets a real browser submission through and the whole path can be exercised.
test("takes an email for the next drop and records the consent it showed", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: config.baseURL })
  const page = await context.newPage()
  await pool.query("delete from commerce.drop_subscribers")

  await page.goto("/#design-of-the-week")
  // Home streams this form; label lookup can also match React's hidden staged HTML.
  const field = page.getByRole("textbox", { name: "Know when the next one drops" })
  await field.fill("Customer@Example.com")
  await page.getByRole("button", { name: "Keep me posted" }).click()
  await expect(page.getByRole("status").filter({ hasText: "You're on the list" })).toBeVisible()
  await expect(field).toHaveValue("")

  const saved = (
    await pool.query("select email, source, consent_copy_version, confirmed_at from commerce.drop_subscribers")
  ).rows
  // Stored normalized, with what they were shown, and confirmed by nothing -- signing up is the opt-in.
  expect(saved).toEqual([
    { email: "customer@example.com", source: "design-of-the-week", consent_copy_version: "v2", confirmed_at: null },
  ])

  // Signing up again refreshes consent rather than erroring or making a twin.
  await field.fill("customer@example.com")
  await page.getByRole("button", { name: "Keep me posted" }).click()
  await expect(page.getByRole("status").filter({ hasText: "You're on the list" })).toBeVisible()
  expect((await pool.query("select count(*) from commerce.drop_subscribers")).rows[0].count).toBe("1")
  await context.close()
})

const dropEmailProducts = catalogProducts.slice(0, 2)
// Shaped like a real production fingerprint but derived from nothing real, so only this journey's rows match it.
const dropEmailFingerprint = (variant: { id: number }) =>
  `${productionFingerprintVersion}:${createHash("sha256").update(`drop-email-fixture-${variant.id}`).digest("hex")}`

/**
 * A fresh stock read for the drop email journey's two tees, seeded before any journey runs. The app
 * caches this read for five minutes and only the stock cron clears it, so seeded later, an earlier
 * journey's cached "no stock read yet" is what the page would still see. Other journeys' tees carry no
 * matching production fingerprint, so this changes nothing for them: they stay unavailable either way.
 */
async function seedDropEmailStock() {
  const products = Object.fromEntries(
    dropEmailProducts.map((product) => [
      product.id,
      product.variants.map((variant) => ({
        id: variant.id,
        enabled: true,
        inStock: true,
        fingerprint: dropEmailFingerprint(variant),
      })),
    ])
  )
  await pool.query(
    `insert into commerce.catalog_refreshes (shop_id,kind,payload,observed_at) values ('123','stock',$1::jsonb,now())
     on conflict (shop_id,kind) do update set payload=excluded.payload, observed_at=excluded.observed_at`,
    [JSON.stringify({ fingerprintVersion: productionFingerprintVersion, products })]
  )
}

test("shows the owner the drop list, the next drop's email and what went out, without ever sending", async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: config.baseURL, storageState: ownerSession })
  const page = await context.newPage()
  await stubProductImages(page)
  await stubDropArtwork(page)
  const drop = dropEmailProducts
  await pool.query("delete from commerce.drop_email_deliveries")
  await pool.query("delete from commerce.drop_emails")
  await pool.query("delete from commerce.product_week_schedule where shop_id='123'")
  await pool.query("delete from commerce.printify_products where shop_id='123'")
  await seedCompleteGarment(pool, "123")
  // Hidden until next week's reveal: the preview has to see what the shop cannot show yet. An email
  // offers only what is for sale, so each tee matches the stock read the suite seeded up front.
  const cadence = { ...storeConfig.weeklyFeature, timeZone: storeConfig.timeZone }
  const nextWeek = listCadenceSlots({ from: new Date(), count: 1, cadence })[0]!.toISOString()
  for (const product of drop) {
    // Without print_areas the shop checks each variant's recorded production fingerprint instead of
    // deriving one, so only these rows match the seeded stock and every other journey's tees stay as
    // they were.
    const listing = Object.fromEntries(Object.entries(product).filter(([key]) => key !== "print_areas"))
    const snapshot = {
      ...listing,
      visible: true,
      blueprint_id: 1317,
      variants: product.variants.map((variant) => ({
        ...variant,
        storefront_production_fingerprint: dropEmailFingerprint(variant),
      })),
    }
    await pool.query(
      `insert into commerce.printify_products (shop_id,product_id,snapshot,active,hidden_at,reveal_at)
       values ('123',$1,$2::jsonb,true,now(),$3)`,
      [product.id, JSON.stringify(snapshot), nextWeek]
    )
    await pool.query(
      `insert into commerce.product_week_schedule (shop_id,product_id,live_at,featured_by)
       values ('123',$1,$2,gen_random_uuid())`,
      [product.id, nextWeek]
    )
  }
  // The signup journey above left one subscriber; add one who has left, and last week's email to them.
  const [subscriber] = (await pool.query<{ id: string }>("select id from commerce.drop_subscribers")).rows
  await pool.query(
    `insert into commerce.drop_subscribers (email, source, consent_copy_version, unsubscribed_at)
     values ('left@example.com', 'design-of-the-week', 'v2', now())`
  )
  const lastWeek = listCadenceSlots({
    from: new Date(Date.now() - 8 * 86_400_000),
    count: 1,
    cadence,
  })[0]!.toISOString()
  await pool.query(
    `insert into commerce.drop_emails (live_at, from_address, reply_to, subject, html, text_body, product_ids, site_origin)
     values ($1, 'Fixture Store <drops@fixture.example>', $2, 'New this week: Last Week',
             '<p>Last week</p>', 'Last week', array['last-week'], $3)`,
    [lastWeek, storeConfig.supportEmail, config.baseURL]
  )
  await pool.query(
    `insert into commerce.drop_email_deliveries (drop_live_at, subscriber_id, status, attempt_started_at, sent_at, provider_email_id)
     values ($1, $2, 'sent', now(), now(), 're_fixture')`,
    [lastWeek, subscriber!.id]
  )
  // Direct fixture writes need the same cache refresh that normal admin mutations perform.
  const refreshed = await context.request.put("/api/admin/products/featured-order", {
    headers: { origin: config.baseURL },
    data: { productIds: drop.map((product) => product.id) },
  })
  expect(refreshed.status()).toBe(200)

  await page.goto("/admin/products")
  await page
    .getByRole("navigation", { name: "Products sections" })
    .getByRole("link", { name: "Drop emails", exact: true })
    .click()
  await expect(page.getByRole("heading", { level: 1, name: "Drop emails" })).toBeVisible()
  // This build has no Resend key, sender or mailing address, and says so by name.
  await expect(page.getByRole("heading", { name: "Sending is off" })).toBeVisible()
  await expect(page.getByText(/^Set .*RESEND_API_KEY.*STORE_POSTAL_ADDRESS.* in Vercel\.$/)).toBeVisible()
  await expect(page.getByText("1 subscribed · 1 unsubscribed")).toBeVisible()

  const names = drop.map((product) => product.title)
  await expect(page.getByText(`New this week: ${names.join(" and ")}`)).toBeVisible()
  // The preview is its own sandboxed document, loaded with the owner's session.
  const preview = page.frameLocator('iframe[title^="Preview of the email for the"]')
  await expect(preview.getByRole("heading", { name: "This week’s picks." })).toBeVisible()
  for (const name of names) await expect(preview.getByRole("heading", { name })).toBeVisible()

  await page.getByRole("button", { name: `Send a test to ${storeConfig.supportEmail}` }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Email sending isn't set up yet." })).toBeVisible()
  expect((await pool.query("select count(*) from commerce.drop_emails")).rows[0].count).toBe("1")

  const history = page.getByRole("region", { name: "Sent so far" })
  await expect(history.getByText("New this week: Last Week")).toBeVisible()
  await expect(history.getByText(/^Sent to 1 of 1 subscriber\./)).toBeVisible()

  await page.setViewportSize({ width: 375, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: "test-results/admin/drop-emails-narrow.png", fullPage: true })
  await context.close()
})
