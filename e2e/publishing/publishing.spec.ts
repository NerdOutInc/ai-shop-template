import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"

import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test"
import { Pool } from "pg"
import { z } from "zod"

import { applyAllMigrations } from "../../test/apply-all-migrations"
import { createAdminDatabaseFixture } from "../../test/create-admin-database-fixture"
import { seedCompleteGarment } from "../../test/seed-complete-garment"

import { createPublishingProduct } from "./create-publishing-product"
import { createPublishingImage } from "./create-publishing-image"
import { publishingTestConfig as config } from "./publishing-test-config"

let pool: Pool
let currentProduct: ReturnType<typeof createPublishingProduct>
let workerPath: string
let forestImage: string
let clayImage: string
const fullSelection = { title: true, description: true, images: true, variants: true }
const merchantFeedHeaders = {
  google: {
    authorization: `Basic ${Buffer.from(`google-merchant:${config.merchantFeedPassword}`).toString("base64")}`,
  },
  meta: {
    authorization: `Basic ${Buffer.from(`meta-catalog:${config.metaFeedPassword}`).toString("base64")}`,
  },
}
const providerStateSchema = z.object({
  apiReads: z.array(z.string()),
  product: z.object({ visible: z.boolean(), is_locked: z.boolean() }).nullable(),
  callbacks: z.array(z.object({ action: z.string(), body: z.unknown() })),
  unexpected: z.array(z.string()),
  imageReads: z.array(z.string()),
  imageUploads: z.array(z.string()),
  imagePutAttempts: z.array(z.string()),
})

async function hostedImage(pathname: string) {
  const checksum = createHash("sha256")
    .update(await createPublishingImage(pathname))
    .digest("hex")
  return `https://${config.blobHost}/published-mockups/v1/${checksum}.png`
}

async function expectHostedImage(locator: Locator, expected: string) {
  await expect
    .poll(async () => {
      const src = await locator.getAttribute("src")
      if (!src) return null
      const url = new URL(src, config.baseURL)
      return url.pathname === "/_next/image" ? url.searchParams.get("url") : url.href
    })
    .toBe(expected)
  await expect.poll(() => locator.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
}

function event(action: "create" | "update" | "delete", sequence: number, publishDetails = fullSelection) {
  return {
    id: `browser-publication-${sequence}`,
    type: "product:publish:started",
    created_at: `2026-09-09T12:00:0${sequence}Z`,
    resource: {
      id: currentProduct.id,
      type: "product",
      data:
        action === "delete" ? { action } : { action, shop_id: Number(config.shopId), publish_details: publishDetails },
    },
  }
}

async function deliver(request: APIRequestContext, payload: ReturnType<typeof event>) {
  const body = JSON.stringify(payload)
  return request.post("/api/webhooks/printify", {
    data: body,
    headers: {
      "content-type": "application/json",
      "x-pfy-signature": `sha256=${createHmac("sha256", config.webhookSecret).update(body).digest("hex")}`,
    },
  })
}

async function control(request: APIRequestContext, path: string, body: unknown) {
  const response = await request.post(`${config.providerURL}/control/${path}`, {
    data: body,
    headers: { authorization: `Bearer ${config.cronSecret}` },
  })
  expect(response.status()).toBe(200)
}

async function providerState(request: APIRequestContext) {
  const response = await request.get(`${config.providerURL}/control/state`, {
    headers: { authorization: `Bearer ${config.cronSecret}` },
  })
  expect(response.status()).toBe(200)
  return providerStateSchema.parse(await response.json())
}

async function jobState(id: string) {
  return (
    await pool.query<{ state: string }>("select state from commerce.printify_publish_jobs where event_id=$1", [id])
  ).rows[0]?.state
}

async function revisionCount() {
  return (await pool.query<{ count: number }>("select count(*)::int as count from commerce.printify_product_revisions"))
    .rows[0]?.count
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

async function refreshStock(request: APIRequestContext) {
  const response = await request.post("/api/internal/catalog-sync/stock", {
    headers: { authorization: `Bearer ${config.cronSecret}` },
  })
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject({ result: "updated" })
}

async function merchantFeed(request: APIRequestContext, page: Page, destination: "google" | "meta" = "google") {
  await refreshStock(request)
  const response = await request.get(`/feeds/${destination}`, { headers: merchantFeedHeaders[destination] })
  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toContain("xml")
  expect(response.headers()["cache-control"]).toContain("private")
  expect(response.headers()["cache-control"]).toContain("no-store")
  const parsed = await page.evaluate(
    (xml) => {
      const document = new DOMParser().parseFromString(xml, "application/xml")
      const field = (item: Element, name: string) =>
        item.getElementsByTagNameNS("http://base.google.com/ns/1.0", name)[0]?.textContent ?? null
      return {
        parseError: document.querySelector("parsererror")?.textContent ?? null,
        root: document.documentElement.tagName,
        version: document.documentElement.getAttribute("version"),
        items: [...document.getElementsByTagName("item")].map((item) => ({
          id: field(item, "id"),
          groupId: field(item, "item_group_id"),
          title: field(item, "title"),
          description: field(item, "description"),
          link: field(item, "link"),
          imageLink: field(item, "image_link"),
          price: field(item, "price"),
          availability: field(item, "availability"),
          ...(field(item, "quantity_to_sell_on_facebook") !== null
            ? { quantity: field(item, "quantity_to_sell_on_facebook") }
            : {}),
          color: field(item, "color"),
          size: field(item, "size"),
        })),
      }
    },
    await response.text()
  )
  expect(parsed.parseError).toBeNull()
  expect(parsed.root).toBe("rss")
  expect(parsed.version).toBe("2.0")
  return parsed.items.toSorted((first, second) => (first.id ?? "").localeCompare(second.id ?? ""))
}

async function prepareMerchantProduct(request: APIRequestContext) {
  await control(request, "product", currentProduct)
  return currentProduct
}

test.beforeAll(async () => {
  const deployment = z
    .object({
      $schema: z.literal("https://openapi.vercel.sh/vercel.json"),
      crons: z.tuple([
        z.object({ path: z.literal("/api/internal/printify-publishing"), schedule: z.literal("* * * * *") }).strict(),
        z.object({ path: z.literal("/api/internal/catalog-sync/stock"), schedule: z.literal("*/30 * * * *") }).strict(),
        z
          .object({ path: z.literal("/api/internal/catalog-sync/popularity"), schedule: z.literal("0 */6 * * *") })
          .strict(),
        z.object({ path: z.literal("/api/internal/order-alerts"), schedule: z.literal("0 * * * *") }).strict(),
        z.object({ path: z.literal("/api/internal/drop-emails"), schedule: z.literal("5,20,35,50 * * * *") }).strict(),
        z
          .object({ path: z.literal("/api/internal/signup-confirmations"), schedule: z.literal("*/15 * * * *") })
          .strict(),
      ]),
    })
    .strict()
    .parse(JSON.parse(await readFile("scripts/vercel-crons.example.json", "utf8")))
  workerPath = deployment.crons[0].path
  const database = new URL(config.databaseUrl!)
  if (
    !["localhost", "127.0.0.1"].includes(database.hostname) ||
    database.pathname !== "/store_publishing_e2e" ||
    database.search
  )
    throw new Error("Refusing to reset a database outside the isolated publishing browser suite")
  pool = await createAdminDatabaseFixture(config.databaseUrl!)
  await applyAllMigrations(pool)
  forestImage = await hostedImage("forest.png")
  clayImage = await hostedImage("clay.png")
})

test.afterAll(async () => {
  await pool?.end()
})

test.beforeEach(async ({ page, request }) => {
  await pool.query(
    "truncate commerce.checkout_capacity, commerce.catalog_refreshes, commerce.printify_publish_jobs, commerce.printify_product_revisions, commerce.printify_products restart identity cascade"
  )
  await pool.query("delete from commerce.garment_models where shop_id=$1", [config.shopId])
  await seedCompleteGarment(pool, config.shopId)
  currentProduct = createPublishingProduct(randomBytes(12).toString("hex"))
  await control(request, "reset", currentProduct)
  // Next's disk cache outlives the test database. Invalidate it through a signed removal,
  // then discard that setup event so each journey still starts with no publications or callbacks.
  const reset = event("delete", 0)
  expect((await deliver(request, reset)).status()).toBe(200)
  await expect.poll(() => jobState(reset.id)).toBe("complete")
  await refreshStock(request)
  expect((await providerState(request)).callbacks.map((callback) => callback.action)).toEqual(["unpublish"])
  await pool.query(
    "truncate commerce.printify_publish_jobs, commerce.printify_product_revisions, commerce.printify_products restart identity cascade"
  )
  await control(request, "reset", currentProduct)
  expect(
    (
      await request.post("/api/internal/catalog-sync/popularity", {
        headers: { authorization: `Bearer ${config.cronSecret}` },
      })
    ).status()
  ).toBe(200)
  // Publication no longer decides what the shop shows: the reveal gate defaults a brand-new product
  // to hidden. These journeys are about publishing, so stand in for the owner having already chosen
  // to show this one. Intake inserts with `on conflict do nothing`, so this row's decision survives.
  // The default itself is proved separately, in "a newly published product waits for the owner".
  await pool.query(
    "insert into commerce.printify_products (shop_id,product_id,hidden_at) values ($1,$2,null) on conflict do nothing",
    [config.shopId, currentProduct.id]
  )
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === config.blobHost)
      return route.fulfill({ response: await request.get(`${config.providerURL}/blob-content${url.pathname}`) })
    if (["localhost", "127.0.0.1"].includes(url.hostname)) return route.continue()
    return route.abort("blockedbyclient")
  })
})

test.afterEach(async ({ request }) => {
  await control(request, "outage", { enabled: false })
  // Invalidate application caches through the real removal path before the next fixture replaces database rows.
  await control(request, "product", currentProduct)
  const cleanup = event("delete", 9)
  expect((await deliver(request, cleanup)).status()).toBe(200)
  await expect.poll(() => jobState(cleanup.id)).toBe("complete")
  await refreshStock(request)
})

test("publishes signed events, isolates drafts, preserves hidden shirts, and removes an unpublished shirt", async ({
  page,
  request,
}, testInfo) => {
  const product = currentProduct
  await page.goto("/shop")
  await expect(page.getByRole("article")).toHaveCount(0)
  expect(await (await request.get("/sitemap.xml")).text()).not.toContain(`/shop/${product.id}`)

  const create = event("create", 1)
  const invalid = await request.post("/api/webhooks/printify", {
    data: create,
    headers: { "x-pfy-signature": "sha256=invalid" },
  })
  expect(invalid.status()).toBe(400)
  expect(await jobState(create.id)).toBeUndefined()
  expect((await deliver(request, create)).status()).toBe(200)
  await expect.poll(() => jobState(create.id)).toBe("complete")
  expect(await revisionCount()).toBe(1)
  expect((await providerState(request)).callbacks.map((callback) => callback.action)).toEqual(["publishing_succeeded"])
  expect((await providerState(request)).imagePutAttempts).toHaveLength(2)

  expect((await deliver(request, create)).status()).toBe(200)
  expect(await revisionCount()).toBe(1)
  expect((await providerState(request)).callbacks).toHaveLength(1)

  await page.reload()
  const card = page.getByRole("article", { name: product.title })
  await expect(card).toBeVisible()
  await expectHostedImage(card.getByAltText(product.title, { exact: true }), forestImage)
  await card.getByRole("link").click()
  await expect(page.getByRole("heading", { level: 1, name: product.title })).toBeVisible()
  await expect(page.getByRole("button", { name: "Forest", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expectHostedImage(page.locator(".product-main-image"), forestImage)
  await noOverflow(page)

  const draft = {
    ...product,
    title: "PRIVATE DRAFT TITLE",
    description: "<p>PRIVATE DRAFT DESCRIPTION</p>",
    is_locked: false,
    variants: product.variants.map((variant) => ({ ...variant, price: 9900 })),
    images: product.images.map((image) => ({ ...image, is_default: image.src.includes("clay") })),
  }
  await control(request, "product", draft)
  await page.reload()
  await expect(page.getByRole("heading", { level: 1, name: product.title })).toBeVisible()
  await expect(page.getByText("PRIVATE DRAFT DESCRIPTION")).toHaveCount(0)
  await expectHostedImage(page.locator(".product-main-image"), forestImage)
  await page.getByRole("button", { name: "M", exact: true }).click()
  await expect(page.getByText("$30.00", { exact: true })).toBeVisible()
  const savedBeforeUpdate = (
    await pool.query<{ snapshot: Record<string, unknown> }>(
      "select snapshot from commerce.printify_products where product_id=$1",
      [product.id]
    )
  ).rows[0]?.snapshot
  expect(savedBeforeUpdate).toMatchObject({
    title: product.title,
    description: product.description,
    variants: product.variants,
  })

  await control(request, "product", { ...draft, is_locked: true })
  const update = event("update", 2, { title: false, description: false, variants: false, images: true })
  expect((await deliver(request, update)).status()).toBe(200)
  await expect.poll(() => jobState(update.id)).toBe("complete")
  expect(await revisionCount()).toBe(2)
  // Re-publishing identical mockup bytes reuses the immutable objects without rejected PUTs.
  expect((await providerState(request)).imagePutAttempts).toHaveLength(2)
  await page.reload()
  await expect(page.getByRole("heading", { level: 1, name: product.title })).toBeVisible()
  // Publishing a new Primary must preserve an explicit color and size in the shopper's URL.
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("color") === "Forest" && url.searchParams.get("size") === "M"
  )
  await expect(page.getByRole("button", { name: "Forest", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "M", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expectHostedImage(page.locator(".product-main-image"), forestImage)
  await expect(page.getByText("$30.00", { exact: true })).toBeVisible()

  // A fresh visit without a selection should use the newly published Primary.
  await page.goto(`/shop/${product.id}`)
  await expect(page.getByRole("heading", { level: 1, name: product.title })).toBeVisible()
  await expect(page).toHaveURL((url) => url.searchParams.get("color") === "Clay" && !url.searchParams.has("size"))
  await expect(page.getByRole("button", { name: "Clay", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expectHostedImage(page.locator(".product-main-image"), clayImage)
  await page.getByRole("button", { name: "M", exact: true }).click()
  await expect(page.getByText("$32.00", { exact: true })).toBeVisible()
  const savedAfterUpdate = (
    await pool.query<{ snapshot: Record<string, unknown> }>(
      "select snapshot from commerce.printify_products where product_id=$1",
      [product.id]
    )
  ).rows[0]?.snapshot
  expect(savedAfterUpdate).toMatchObject({
    title: product.title,
    description: product.description,
    variants: product.variants,
    images: draft.images.map((image) => ({
      ...image,
      src: image.src.includes("clay") ? clayImage : forestImage,
      source_src: image.src,
    })),
  })
  await noOverflow(page)
  await testInfo.attach("published-primary", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  })

  const callbacks = (await providerState(request)).callbacks
  const external = z
    .object({ external: z.object({ id: z.string(), handle: z.url() }) })
    .parse(callbacks[0]?.body).external
  expect(external).toEqual({ id: product.id, handle: `${config.canonicalURL}/shop/${product.id}` })
  const quoteBody = {
    items: [{ productId: product.id, variantId: 101, quantity: 1, expectedUnitAmount: 3000 }],
    requestId: randomUUID(),
    expectedShippingAmount: 500,
  }
  const checkoutReadsBefore = (await providerState(request)).apiReads
  const quote = await request.post("/api/checkout", {
    data: quoteBody,
    headers: { origin: config.canonicalURL },
  })
  // A deliberately wrong shipping total proves the current published product reached
  // hosted-checkout validation, without creating a Stripe session.
  expect(quote.status()).toBe(409)
  expect(await quote.json()).toMatchObject({ code: "SHIPPING_CHANGED" })
  expect((await providerState(request)).apiReads).toEqual(checkoutReadsBefore)
  const capacityBuckets = (
    await pool.query<{ bucket: string }>("select bucket from commerce.checkout_capacity")
  ).rows.map(({ bucket }) => bucket)
  expect(capacityBuckets).toHaveLength(2)
  expect(capacityBuckets).toEqual(expect.arrayContaining(["ingress", expect.stringMatching(/^client:/)]))

  // Printify's Hide/Show actions publish visibility with every content selection disabled.
  const visibilitySelection = { title: false, description: false, variants: false, images: false }
  const visibilityDraft = { ...draft, images: product.images, is_locked: true, visible: false }
  await control(request, "product", visibilityDraft)
  const hide = event("update", 3, visibilitySelection)
  expect((await deliver(request, hide)).status()).toBe(200)
  await expect.poll(() => jobState(hide.id)).toBe("complete")
  expect(await (await request.get("/sitemap.xml")).text()).not.toContain(`/shop/${product.id}`)
  expect(await revisionCount()).toBe(3)
  const hidden = (
    await pool.query<{ active: boolean; snapshot: Record<string, unknown> }>(
      "select active, snapshot from commerce.printify_products where product_id=$1",
      [product.id]
    )
  ).rows[0]
  expect(hidden).toEqual({
    active: false,
    snapshot: { ...savedAfterUpdate, visible: false, storefront_stock: expect.any(Object) },
  })
  await page.goto("/shop")
  await expect(page.getByRole("article")).toHaveCount(0)
  expect((await request.get(`/shop/${product.id}`)).status()).toBe(404)
  const hiddenQuote = await request.post("/api/checkout", {
    data: quoteBody,
    headers: { origin: config.canonicalURL },
  })
  expect(hiddenQuote.status()).toBe(409)
  expect(await hiddenQuote.json()).toMatchObject({ code: "PRODUCT_UNAVAILABLE" })
  const hiddenProvider = await providerState(request)
  expect(hiddenProvider.product).toEqual({ visible: false, is_locked: false })
  expect(hiddenProvider.callbacks.map((callback) => callback.action)).toEqual([
    "publishing_succeeded",
    "publishing_succeeded",
    "publishing_succeeded",
  ])

  await control(request, "product", { ...visibilityDraft, visible: true })
  const show = event("update", 4, visibilitySelection)
  expect((await deliver(request, show)).status()).toBe(200)
  await expect.poll(() => jobState(show.id)).toBe("complete")
  const restoredSitemap = await request.get("/sitemap.xml")
  expect(restoredSitemap.status()).toBe(200)
  expect(await restoredSitemap.text()).toContain(`${config.canonicalURL}/shop/${product.id}`)
  expect(await revisionCount()).toBe(4)
  const shown = (
    await pool.query<{ active: boolean; snapshot: Record<string, unknown> }>(
      "select active, snapshot from commerce.printify_products where product_id=$1",
      [product.id]
    )
  ).rows[0]
  expect(shown).toEqual({
    active: true,
    snapshot: { ...savedAfterUpdate, visible: true, storefront_stock: expect.any(Object) },
  })
  await page.reload()
  await expect(card).toBeVisible()
  await expectHostedImage(card.getByAltText(product.title, { exact: true }), clayImage)
  await card.getByRole("link").click()
  await expect(page.getByRole("heading", { level: 1, name: product.title })).toBeVisible()
  await expect(page.getByText("PRIVATE DRAFT DESCRIPTION")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Clay", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expectHostedImage(page.locator(".product-main-image"), clayImage)
  await page.getByRole("button", { name: "M", exact: true }).click()
  await expect(page.getByText("$32.00", { exact: true })).toBeVisible()
  await noOverflow(page)
  const restoredQuote = await request.post("/api/checkout", {
    data: quoteBody,
    headers: { origin: config.canonicalURL },
  })
  expect(restoredQuote.status()).toBe(409)
  expect(await restoredQuote.json()).toMatchObject({ code: "SHIPPING_CHANGED" })
  expect((await providerState(request)).product).toEqual({ visible: true, is_locked: false })

  await control(request, "product", { ...draft, is_locked: true })
  const deletion = event("delete", 5)
  expect((await deliver(request, deletion)).status()).toBe(200)
  await expect.poll(() => jobState(deletion.id)).toBe("complete")
  expect(await (await request.get("/sitemap.xml")).text()).not.toContain(`/shop/${product.id}`)
  expect(await revisionCount()).toBe(5)
  expect(
    (
      await pool.query<{ active: boolean; snapshot: null }>(
        "select active, snapshot from commerce.printify_products where product_id=$1",
        [product.id]
      )
    ).rows[0]
  ).toEqual({ active: false, snapshot: null })
  await page.goto("/shop")
  await expect(page.getByRole("article")).toHaveCount(0)
  const removed = await request.get(`/shop/${product.id}`)
  expect(removed.status()).toBe(404)
  const rejected = await request.post("/api/checkout", {
    data: quoteBody,
    headers: { origin: config.canonicalURL },
  })
  expect(rejected.status()).toBe(409)
  expect(await rejected.json()).toMatchObject({ code: "PRODUCT_UNAVAILABLE" })
  const final = await providerState(request)
  expect(final.callbacks.map((callback) => callback.action)).toEqual([
    "publishing_succeeded",
    "publishing_succeeded",
    "publishing_succeeded",
    "publishing_succeeded",
    "unpublish",
  ])
  expect(final.unexpected).toEqual([])
})

test("recovers a durably queued publication through the authenticated worker without another webhook", async ({
  page,
  request,
}) => {
  await control(request, "outage", { enabled: true })
  const create = event("create", 4)
  expect((await deliver(request, create)).status()).toBe(200)
  await expect
    .poll(
      async () =>
        (
          await pool.query<{ attempts: number }>(
            "select attempts from commerce.printify_publish_jobs where event_id=$1",
            [create.id]
          )
        ).rows[0]?.attempts
    )
    .toBe(1)
  expect(await jobState(create.id)).toBe("pending")
  expect(await revisionCount()).toBe(0)
  expect((await request.get(workerPath)).status()).toBe(401)
  expect((await providerState(request)).callbacks).toEqual([])

  await control(request, "outage", { enabled: false })
  // Advance only this local fixture's retry clock instead of sleeping through the production backoff.
  await pool.query("update commerce.printify_publish_jobs set next_attempt_at=now() where event_id=$1", [create.id])
  const recovery = await request.get(workerPath, {
    headers: { authorization: `Bearer ${config.cronSecret}` },
  })
  expect(recovery.status()).toBe(200)
  await expect.poll(() => jobState(create.id)).toBe("complete")
  await refreshStock(request)
  expect(await revisionCount()).toBe(1)
  await page.goto("/shop")
  await expect(page.getByRole("article", { name: currentProduct.title })).toBeVisible()
  await noOverflow(page)
  const state = await providerState(request)
  expect(state.callbacks.map((callback) => callback.action)).toEqual(["publishing_succeeded"])
  expect(state.unexpected).toEqual([])
})

test("keeps published images during a failed copy and resumes into the storefront, feed, and structured data", async ({
  page,
  request,
}) => {
  const product = currentProduct
  const create = event("create", 1)
  expect((await deliver(request, create)).status()).toBe(200)
  await expect.poll(() => jobState(create.id)).toBe("complete")
  await refreshStock(request)
  const previous = await merchantFeed(request, page)
  expect(previous.map((item) => item.imageLink)).toEqual([forestImage, clayImage])
  const revised = {
    ...product,
    images: product.images.map((image) => ({ ...image, src: image.src.replace(".png", "-revised.png") })),
  }
  await control(request, "product", revised)
  const forestSource = new URL(revised.images[0]!.src).pathname
  const claySource = new URL(revised.images[1]!.src).pathname
  await control(request, "image-outage", { pathname: claySource })
  const update = event("update", 2)
  expect((await deliver(request, update)).status()).toBe(200)
  await expect
    .poll(
      async () =>
        (await pool.query("select attempts from commerce.printify_publish_jobs where event_id=$1", [update.id])).rows[0]
          ?.attempts
    )
    .toBe(1)
  expect(await jobState(update.id)).toBe("pending")
  expect(await revisionCount()).toBe(1)
  expect((await providerState(request)).callbacks.map((callback) => callback.action)).toEqual(["publishing_succeeded"])
  expect(await merchantFeed(request, page)).toEqual(previous)
  await page.goto(`/shop/${product.id}?color=Forest&size=M`)
  await expectHostedImage(page.locator(".product-main-image"), forestImage)

  await control(request, "image-outage", { pathname: null })
  await pool.query("update commerce.printify_publish_jobs set next_attempt_at=now() where event_id=$1", [update.id])
  const recovery = await request.get(workerPath, { headers: { authorization: `Bearer ${config.cronSecret}` } })
  expect(recovery.status()).toBe(200)
  await expect.poll(() => jobState(update.id)).toBe("complete")
  await refreshStock(request)
  expect(await revisionCount()).toBe(2)
  const forestRevised = await hostedImage(forestSource)
  const clayRevised = await hostedImage(claySource)
  expect(forestRevised).not.toBe(forestImage)
  expect(clayRevised).not.toBe(clayImage)
  const published = await merchantFeed(request, page)
  expect(published.map((item) => ({ color: item.color, image: item.imageLink }))).toEqual([
    { color: "Forest", image: forestRevised },
    { color: "Clay", image: clayRevised },
  ])
  await page.reload()
  await expectHostedImage(page.locator(".product-main-image"), forestRevised)
  const initialHtml = await (await request.get(`/shop/${product.id}`)).text()
  expect(initialHtml).not.toContain("source_src")
  for (const image of revised.images) expect(initialHtml).not.toContain(image.src)
  const structured = z
    .object({ "@graph": z.array(z.object({ "@type": z.string() }).passthrough()) })
    .parse(JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? "null"))
  const group = z
    .object({ hasVariant: z.array(z.object({ sku: z.string(), image: z.array(z.string()) })) })
    .parse(structured["@graph"].find((item) => item["@type"] === "ProductGroup"))
  expect(group.hasVariant).toEqual([
    { sku: `${product.id}-101`, image: [forestRevised] },
    { sku: `${product.id}-102`, image: [clayRevised] },
  ])
  const state = await providerState(request)
  expect(state.imageReads.filter((path) => path === forestSource)).toHaveLength(1)
  expect(state.imageReads.filter((path) => path === claySource)).toHaveLength(2)
  expect(state.imageUploads).toHaveLength(4)
  expect(state.callbacks.map((callback) => callback.action)).toEqual(["publishing_succeeded", "publishing_succeeded"])
  expect(state.unexpected).toEqual([])
  await noOverflow(page)
})

for (const [blueprintId, gender] of [
  [1312, "female"],
  [2679, "female"],
  [3076, "male"],
] as const) {
  test(`feeds use the saved profile for garment ${blueprintId} without republishing`, async ({ request }) => {
    currentProduct.blueprint_id = blueprintId
    await control(request, "product", currentProduct)
    const create = event("create", 1)
    expect((await deliver(request, create)).status()).toBe(200)
    await expect.poll(() => jobState(create.id)).toBe("complete")
    await refreshStock(request)
    const feed = (destination: "google" | "meta") =>
      request.get(`/feeds/${destination}`, { headers: merchantFeedHeaders[destination] })
    const health = () =>
      request.get("/api/internal/printify-publishing/health", {
        headers: { authorization: `Bearer ${config.monitorSecret}` },
      })
    expect((await feed("google")).status()).toBe(503)
    expect(await (await health()).json()).toMatchObject({ issues: ["MERCHANT_CATALOG_INVALID"] })
    await seedCompleteGarment(pool, config.shopId, blueprintId)
    await pool.query("update commerce.garment_models set gender=$3 where shop_id=$1 and blueprint_id=$2", [
      config.shopId,
      blueprintId,
      gender,
    ])
    for (const destination of ["google", "meta"] as const) {
      const response = await feed(destination)
      expect(response.status()).toBe(200)
      expect(await response.text()).toContain(`<g:gender>${gender}</g:gender>`)
    }
    await pool.query(
      "update commerce.garment_models set google_product_category=1604,size_system='EU' where shop_id=$1 and blueprint_id=$2",
      [config.shopId, blueprintId]
    )
    const updated = await feed("google")
    expect(updated.status()).toBe(200)
    const xml = await updated.text()
    expect(xml).toContain("<g:google_product_category>1604</g:google_product_category>")
    expect(xml).toContain("<g:size_system>EU</g:size_system>")
    expect(await (await health()).json()).toMatchObject({ status: "healthy", issues: [] })
    // Hidden snapshots still need a usable profile before a future reveal; feed membership stays separate.
    await pool.query("update commerce.printify_products set hidden_at=now() where shop_id=$1 and product_id=$2", [
      config.shopId,
      currentProduct.id,
    ])
    await pool.query("update commerce.garment_models set gender=null where shop_id=$1 and blueprint_id=$2", [
      config.shopId,
      blueprintId,
    ])
    const hiddenFeed = await feed("google")
    expect(hiddenFeed.status()).toBe(200)
    expect(await hiddenFeed.text()).not.toContain("<item>")
    expect(await (await health()).json()).toMatchObject({ status: "unhealthy", issues: ["MERCHANT_CATALOG_INVALID"] })
    expect(await revisionCount()).toBe(1)
    expect((await providerState(request)).callbacks).toHaveLength(1)
  })
}

test("requires merchant credentials on cache-busting feed requests during a provider outage", async ({
  page,
  request,
}) => {
  await prepareMerchantProduct(request)
  const create = event("create", 1)
  expect((await deliver(request, create)).status()).toBe(200)
  await expect.poll(() => jobState(create.id)).toBe("complete")
  await refreshStock(request)
  await control(request, "outage", { enabled: true })
  try {
    const rejectedHeaders: Record<string, string>[] = [
      {},
      { authorization: "Basic malformed-credentials" },
      { authorization: `Bearer ${config.merchantFeedPassword}` },
      { authorization: `Basic ${Buffer.from("google-merchant:wrong-password").toString("base64")}` },
      { authorization: `Basic ${Buffer.from(`wrong-user:${config.merchantFeedPassword}`).toString("base64")}` },
    ]
    for (const destination of ["google", "meta"] as const) {
      const otherCredentials = merchantFeedHeaders[destination === "google" ? "meta" : "google"]
      for (const headers of [...rejectedHeaders, otherCredentials]) {
        const response = await request.get(`/feeds/${destination}?cache-bust=${randomBytes(8).toString("hex")}`, {
          headers,
        })
        expect(response.status()).toBe(404)
        expect(response.headers()["cache-control"]).toContain("private")
        expect(response.headers()["cache-control"]).toContain("no-store")
        expect(await response.text()).not.toContain("<item>")
      }

      // An upstream outage does not affect a fresh stored feed; auth still runs before catalog reads.
      const authorized = await request.get(`/feeds/${destination}`, { headers: merchantFeedHeaders[destination] })
      expect(authorized.status()).toBe(200)
      expect(authorized.headers()["cache-control"]).toContain("no-store")
    }
    expect((await providerState(request)).unexpected).toEqual([])
  } finally {
    await control(request, "outage", { enabled: false })
  }
  expect(await merchantFeed(request, page)).toHaveLength(2)
})

test("keeps merchant feed IDs, prices, and Meta quantities tied to publication and live availability", async ({
  page,
  request,
}) => {
  const product = await prepareMerchantProduct(request)
  await page.goto("/shop")
  expect(await merchantFeed(request, page)).toEqual([])

  const create = event("create", 1)
  expect((await deliver(request, create)).status()).toBe(200)
  await expect.poll(() => jobState(create.id)).toBe("complete")
  await refreshStock(request)
  const published = await merchantFeed(request, page)
  const metaPublished = published.map((item) => ({ ...item, quantity: "999999" }))
  expect(await merchantFeed(request, page, "meta")).toEqual(metaPublished)
  expect(published).toEqual([
    {
      id: `${product.id}-101`,
      groupId: product.id,
      title: expect.stringContaining(product.title),
      description: expect.stringContaining("Published description for good company."),
      link: `${config.canonicalURL}/shop/${product.id}?color=Forest&size=M`,
      imageLink: forestImage,
      price: "30.00 USD",
      availability: "in_stock",
      color: "Forest",
      size: "M",
    },
    {
      id: `${product.id}-102`,
      groupId: product.id,
      title: expect.stringContaining(product.title),
      description: expect.stringContaining("Published description for good company."),
      link: `${config.canonicalURL}/shop/${product.id}?color=Clay&size=M`,
      imageLink: clayImage,
      price: "32.00 USD",
      availability: "in_stock",
      color: "Clay",
      size: "M",
    },
  ])

  // Exercise the feed's actual link against the isolated server, preserving its full variant selection.
  const landing = new URL(published[1]!.link!)
  await page.goto(`${landing.pathname}${landing.search}`)
  await expect(page.getByRole("heading", { level: 1, name: product.title })).toBeVisible()
  await expect(page.getByRole("button", { name: "Clay", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "M", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator(".product-price")).toHaveText("$32.00")
  await expectHostedImage(page.locator(".product-main-image"), clayImage)
  await expect(page.getByRole("button", { name: "Add to cart", exact: true })).toBeEnabled()
  await noOverflow(page)

  const draft = {
    ...product,
    title: "PRIVATE FEED DRAFT TITLE",
    description: "<p>PRIVATE FEED DRAFT DESCRIPTION</p>",
    is_locked: false,
    variants: product.variants.map((variant) => ({ ...variant, price: 9900 })),
    images: product.images.map((image) => ({ ...image, src: image.src.replace(".png", "-private-draft.png") })),
  }
  await control(request, "product", draft)
  expect(await merchantFeed(request, page)).toEqual(published)
  expect(await merchantFeed(request, page, "meta")).toEqual(metaPublished)

  const stockChange = {
    ...draft,
    variants: draft.variants.map((variant) => ({ ...variant, is_available: variant.id !== 101 })),
  }
  await control(request, "product", stockChange)
  const currentStock = published.map((item) =>
    item.id === `${product.id}-101` ? { ...item, availability: "out_of_stock" } : item
  )
  // Stock must update without a publish event or waiting for the storefront's display cache.
  expect(await merchantFeed(request, page)).toEqual(currentStock)
  const metaCurrentStock = currentStock.map((item) => ({
    ...item,
    quantity: item.id === `${product.id}-101` ? "0" : "999999",
  }))
  expect(await merchantFeed(request, page, "meta")).toEqual(metaCurrentStock)
  await control(request, "product", draft)
  expect(await merchantFeed(request, page, "meta")).toEqual(metaPublished)
  await control(request, "product", stockChange)

  await control(request, "outage", { enabled: true })
  try {
    const stillAvailable = await request.get("/feeds/google", { headers: merchantFeedHeaders.google })
    expect(stillAvailable.status()).toBe(200)
    const failedRefresh = await request.post("/api/internal/catalog-sync/stock", {
      headers: { authorization: `Bearer ${config.cronSecret}` },
    })
    expect(failedRefresh.status()).toBe(500)
    const retained = await request.get("/feeds/google", { headers: merchantFeedHeaders.google })
    expect(retained.status()).toBe(200)
    expect(retained.headers()["cache-control"]).toContain("no-store")
  } finally {
    await control(request, "outage", { enabled: false })
  }
  expect(await merchantFeed(request, page)).toEqual(currentStock)

  const visibilitySelection = { title: false, description: false, variants: false, images: false }
  const hiddenDraft = { ...stockChange, is_locked: true, visible: false }
  await control(request, "product", hiddenDraft)
  const hide = event("update", 2, visibilitySelection)
  expect((await deliver(request, hide)).status()).toBe(200)
  await expect.poll(() => jobState(hide.id)).toBe("complete")
  await refreshStock(request)
  expect(await merchantFeed(request, page)).toEqual([])
  expect(await merchantFeed(request, page, "meta")).toEqual([])

  await control(request, "product", { ...hiddenDraft, visible: true })
  const show = event("update", 3, visibilitySelection)
  expect((await deliver(request, show)).status()).toBe(200)
  await expect.poll(() => jobState(show.id)).toBe("complete")
  await refreshStock(request)
  expect(await merchantFeed(request, page)).toEqual(currentStock)
  expect(await merchantFeed(request, page, "meta")).toEqual(metaCurrentStock)

  // A new unpublish starts locked; the previous Show callback unlocked the provider fixture.
  await control(request, "product", { ...stockChange, visible: true, is_locked: true })
  const deletion = event("delete", 4)
  expect((await deliver(request, deletion)).status()).toBe(200)
  await expect.poll(() => jobState(deletion.id)).toBe("complete")
  await refreshStock(request)
  expect(await merchantFeed(request, page)).toEqual([])
  const removed = await providerState(request)
  expect(removed.callbacks.at(-1)?.action).toBe("unpublish")
  expect(removed.product).toEqual({ visible: false, is_locked: false })
  expect(removed.unexpected).toEqual([])
})

test("pauses only a changed production variant across the Google feed, landing page, and checkout", async ({
  page,
  request,
}) => {
  const product = await prepareMerchantProduct(request)
  const create = event("create", 1)
  expect((await deliver(request, create)).status()).toBe(200)
  await expect.poll(() => jobState(create.id)).toBe("complete")
  await refreshStock(request)
  const published = await merchantFeed(request, page)
  expect(published).toHaveLength(2)
  expect(published.every((item) => item.availability === "in_stock")).toBe(true)

  await control(request, "product", {
    ...product,
    is_locked: false,
    variants: product.variants.map((variant) =>
      variant.id === 101 ? { ...variant, sku: "private-unpublished-production-sku" } : variant
    ),
  })
  expect(await merchantFeed(request, page)).toEqual(
    published.map((item) => (item.id === `${product.id}-101` ? { ...item, availability: "out_of_stock" } : item))
  )

  // Visit only after the production change, so availability is checked without waiting for display-cache expiry.
  const landing = new URL(published[0]!.link!)
  await page.goto(`${landing.pathname}${landing.search}`)
  await expect(page.getByRole("heading", { level: 1, name: product.title })).toBeVisible()
  await expect(page.getByRole("button", { name: "Forest", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "M", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator(".product-price")).toHaveText("$30.00")
  await expect(page.getByRole("button", { name: "This color is unavailable", exact: true })).toBeDisabled()
  const structuredData = z
    .object({ "@graph": z.array(z.object({ "@type": z.string() }).passthrough()) })
    .parse(JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? "null"))
  const group = z
    .object({
      hasVariant: z.array(
        z.object({ sku: z.string(), offers: z.object({ availability: z.string(), price: z.string() }) })
      ),
    })
    .parse(structuredData["@graph"].find((item) => item["@type"] === "ProductGroup"))
  expect(group.hasVariant).toEqual([
    { sku: `${product.id}-101`, offers: { availability: "https://schema.org/OutOfStock", price: "30.00" } },
    { sku: `${product.id}-102`, offers: { availability: "https://schema.org/InStock", price: "32.00" } },
  ])

  const quote = await request.post("/api/checkout", {
    data: {
      items: [{ productId: product.id, variantId: 101, quantity: 1, expectedUnitAmount: 3000 }],
      requestId: randomUUID(),
      expectedShippingAmount: 495,
    },
    headers: { origin: config.canonicalURL },
  })
  expect(quote.status()).toBe(409)
  expect(await quote.json()).toMatchObject({ code: "PRODUCT_CHANGED" })
  expect((await providerState(request)).unexpected).toEqual([])
})

test("refreshes in background and makes zero Printify API requests on cold and repeated page loads", async ({
  page,
  request,
}) => {
  const product = currentProduct
  const create = event("create", 1)
  expect((await deliver(request, create)).status()).toBe(200)
  await expect.poll(() => jobState(create.id)).toBe("complete")
  await refreshStock(request)
  const popularity = await request.post("/api/internal/catalog-sync/popularity", {
    headers: { authorization: `Bearer ${config.cronSecret}` },
  })
  expect(popularity.status()).toBe(200)
  const before = (await providerState(request)).apiReads
  expect(before).toContain(`/v1/shops/${config.shopId}/products.json`)
  expect(before).toContain(`/v1/shops/${config.shopId}/orders.json`)
  await control(request, "outage", { enabled: true })
  for (let visit = 0; visit < 2; visit++) {
    await page.goto("/shop")
    await expect(page.getByRole("article", { name: product.title })).toBeVisible()
    await page.goto(`/shop/${product.id}?color=Forest&size=M`)
    await expect(page.getByRole("button", { name: "Add to cart", exact: true })).toBeEnabled()
    expect((await request.get("/sitemap.xml")).status()).toBe(200)
    for (const destination of ["google", "meta"] as const)
      expect((await request.get(`/feeds/${destination}`, { headers: merchantFeedHeaders[destination] })).status()).toBe(
        200
      )
    await noOverflow(page)
  }
  expect((await providerState(request)).apiReads).toEqual(before)
  // A warm request must not need the observation table. Restore it even if an assertion fails.
  await pool.query("alter table commerce.catalog_refreshes rename to unavailable_catalog_refreshes")
  try {
    await page.goto("/shop")
    await page.getByRole("combobox", { name: /Sort/ }).selectOption("popular")
    await expect(page.getByText("Popularity is taking a breather.", { exact: false })).not.toBeVisible()
    await page.goto(`/shop/${product.id}?color=Forest&size=M`)
    await expect(page.getByRole("button", { name: "Add to cart", exact: true })).toBeEnabled()
    expect((await request.get("/feeds/google", { headers: merchantFeedHeaders.google })).status()).toBe(200)
    expect((await providerState(request)).apiReads).toEqual(before)
  } finally {
    await pool.query("alter table commerce.unavailable_catalog_refreshes rename to catalog_refreshes")
  }
})

test("rejects expired observations and restores availability after a successful refresh", async ({ page, request }) => {
  const product = currentProduct
  const create = event("create", 1)
  expect((await deliver(request, create)).status()).toBe(200)
  await expect.poll(() => jobState(create.id)).toBe("complete")
  await refreshStock(request)
  // Expire the stored observation before the first cache fill; clock-boundary reuse is also covered by unit tests.
  await pool.query("update commerce.catalog_refreshes set observed_at=now()-interval '121 minutes' where kind='stock'")
  await page.goto(`/shop/${product.id}?color=Forest&size=M`)
  await expect(page.getByRole("button", { name: "Currently unavailable" })).toBeDisabled()
  expect((await request.get("/feeds/google", { headers: merchantFeedHeaders.google })).status()).toBe(503)
  await refreshStock(request)
  await page.reload()
  await expect(page.getByRole("button", { name: "Add to cart", exact: true })).toBeEnabled()
  expect((await request.get("/feeds/google", { headers: merchantFeedHeaders.google })).status()).toBe(200)
})

test("checks live checkout stock even when the cached product still appears available", async ({ page, request }) => {
  const product = currentProduct
  const create = event("create", 1)
  expect((await deliver(request, create)).status()).toBe(200)
  await expect.poll(() => jobState(create.id)).toBe("complete")
  await refreshStock(request)
  await page.goto(`/shop/${product.id}?color=Forest&size=M`)
  await expect(page.getByRole("button", { name: "Add to cart", exact: true })).toBeEnabled()
  await control(request, "product", {
    ...product,
    variants: product.variants.map((variant) => ({ ...variant, is_available: variant.id !== 101 })),
  })
  const before = (await providerState(request)).apiReads.length
  await page.reload()
  await expect(page.getByRole("button", { name: "Add to cart", exact: true })).toBeEnabled()
  expect((await providerState(request)).apiReads).toHaveLength(before)
  const quote = await request.post("/api/checkout", {
    data: {
      items: [{ productId: product.id, variantId: 101, quantity: 1, expectedUnitAmount: 3000 }],
      requestId: randomUUID(),
      expectedShippingAmount: 495,
    },
    headers: { origin: config.canonicalURL },
  })
  expect(quote.status()).toBe(409)
  expect(await quote.json()).toMatchObject({ code: "PRODUCT_UNAVAILABLE" })
  expect((await providerState(request)).apiReads.slice(before)).toEqual([
    `/v1/shops/${config.shopId}/products/${product.id}.json`,
  ])
  await refreshStock(request)
  await page.reload()
  await expect(page.getByRole("button", { name: "This color is unavailable", exact: true })).toBeDisabled()
})

test("makes new, re-shown, and re-produced shirts available without a catalog scan", async ({ page, request }) => {
  const product = await prepareMerchantProduct(request)
  const before = (await providerState(request)).apiReads.filter((path) => path.endsWith("/products.json"))
  const assertAvailable = async () => {
    await page.goto(`/shop/${product.id}?color=Forest&size=M`)
    await expect(page.getByRole("button", { name: "Add to cart", exact: true })).toBeEnabled()
    for (const destination of ["google", "meta"] as const) {
      const feed = await request.get(`/feeds/${destination}`, { headers: merchantFeedHeaders[destination] })
      expect(feed.status()).toBe(200)
      expect(await feed.text()).toContain(`${product.id}-101`)
    }
    await page.goto("/shop")
    await page.getByRole("combobox", { name: /Sort/ }).selectOption("popular")
    await expect(page.getByText("Popularity is taking a breather.", { exact: false })).not.toBeVisible()
    const scheduled = await request.get("/api/internal/catalog-sync/stock", {
      headers: { authorization: `Bearer ${config.cronSecret}` },
    })
    expect(await scheduled.json()).toMatchObject({ result: "recent" })
    expect((await providerState(request)).apiReads.filter((path) => path.endsWith("/products.json"))).toEqual(before)
  }
  const create = event("create", 1)
  expect((await deliver(request, create)).status()).toBe(200)
  await expect.poll(() => jobState(create.id)).toBe("complete")
  await assertAvailable()
  const visibility = { title: false, description: false, variants: false, images: false }
  await control(request, "product", { ...product, is_locked: true, visible: false })
  const hide = event("update", 2, visibility)
  expect((await deliver(request, hide)).status()).toBe(200)
  await expect.poll(() => jobState(hide.id)).toBe("complete")
  await control(request, "product", { ...product, is_locked: true, visible: true })
  const show = event("update", 3, visibility)
  expect((await deliver(request, show)).status()).toBe(200)
  await expect.poll(() => jobState(show.id)).toBe("complete")
  await assertAvailable()
  const changed = structuredClone(product)
  changed.print_areas[0]!.placeholders[0]!.images[0]!.scale = 0.8
  await control(request, "product", { ...changed, is_locked: true })
  const update = event("update", 4)
  expect((await deliver(request, update)).status()).toBe(200)
  await expect.poll(() => jobState(update.id)).toBe("complete")
  await assertAvailable()
})

test("a newly published product waits for the owner instead of landing on the site", async ({ page, request }) => {
  const product = currentProduct
  // Undo the beforeEach stand-in, so this journey sees what a genuinely first-time publication does.
  await pool.query("delete from commerce.printify_products where shop_id=$1 and product_id=$2", [
    config.shopId,
    product.id,
  ])

  const create = event("create", 1)
  expect((await deliver(request, create)).status()).toBe(200)
  await expect.poll(() => jobState(create.id)).toBe("complete")
  // Printify published it and acknowledged the lock; that part is unchanged.
  expect((await providerState(request)).callbacks.map((callback) => callback.action)).toEqual(["publishing_succeeded"])
  expect(
    (await pool.query("select active,hidden_at from commerce.printify_products where product_id=$1", [product.id]))
      .rows[0]
  ).toMatchObject({ active: true, hidden_at: expect.anything() })

  // The shop, the crawler and a direct link all agree it is not for sale yet.
  await page.goto("/shop")
  await expect(page.getByRole("article")).toHaveCount(0)
  expect((await request.get(`/shop/${product.id}`)).status()).toBe(404)
  expect(await (await request.get("/sitemap.xml")).text()).not.toContain(`/shop/${product.id}`)
})
