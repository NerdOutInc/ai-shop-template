// @vitest-environment node
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import { googleCopySharedFactsHash } from "@/features/merchant-feed/google-copy-shared-facts-hash"
import { createMerchantFeed } from "@/features/merchant-feed/create-merchant-feed"
import { readGoogleCopyProvenance } from "@/features/merchant-feed/read-google-copy-provenance.server"
import { prepareMerchantProduct } from "@/features/merchant-feed/prepare-merchant-product.server"
import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"
import { randomUUID } from "node:crypto"

import type { Pool } from "pg"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import * as postgresPool from "@/lib/create-postgres-pool.server"

import { applyAllMigrations } from "../../../test/apply-all-migrations"
import { createAdminDatabaseFixture } from "../../../test/create-admin-database-fixture"
import { seedCompleteGarment } from "../../../test/seed-complete-garment"

import type { PublishingEvent } from "./publishing-event"

import { PostgresPublishingStore } from "./postgres-publishing-store.server"
import { listCadenceSlots } from "./list-cadence-slots"
import { PrintifyRequestError } from "./printify-request-error"
import { processPublishingJobs } from "./process-publishing-jobs.server"
import { PublishedImageError } from "./published-image-error"

vi.mock("server-only", () => ({}))
const databaseUrl = process.env.PUBLISHING_TEST_DATABASE_URL
const backfillArtwork = {
  src: `https://catalog.public.blob.vercel-storage.com/published-artwork/v1/${"a".repeat(64)}.webp`,
  revisionId: "34d7df72-f329-45f9-acd5-faa4a0c10e25",
  productionFingerprint: `artwork-v1:${"b".repeat(64)}`,
  sourceSha256: "c".repeat(64),
  sha256: "a".repeat(64),
  width: 900,
  height: 1200,
}

describe("publishing advisory lock recovery", () => {
  it.each(["connecting", "working"])("skips an overlapping worker while this instance is %s", async (phase) => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const client = {
      query: vi.fn(async () => ({ rows: [{ acquired: true }] })),
      release: vi.fn(),
    }
    const connect = vi.fn(async () => {
      if (phase === "connecting") {
        entered.resolve()
        await release.promise
      }
      return client
    })
    const factory = vi
      .spyOn(postgresPool, "createPostgresPool")
      .mockReturnValue({ connect } as unknown as ReturnType<typeof postgresPool.createPostgresPool>)
    const store = new PostgresPublishingStore("postgresql://localhost/test", "123")
    const work = store.withProductLock("product", async () => {
      if (phase === "working") {
        entered.resolve()
        await release.promise
      }
      return "processed"
    })
    await entered.promise
    const competingCallback = vi.fn(async () => "unexpected")
    const competingWork = store.withProductLock("other-product", competingCallback)
    try {
      expect(await Promise.race([competingWork, Promise.resolve("queued")])).toBeNull()
      expect(connect).toHaveBeenCalledTimes(1)
      expect(competingCallback).not.toHaveBeenCalled()
      release.resolve()
      expect(await work).toBe("processed")
      expect(await store.withProductLock("next-product", async () => "next")).toBe("next")
    } finally {
      release.resolve()
      await Promise.allSettled([work, competingWork])
      factory.mockRestore()
    }
  })

  it("surfaces a database connection failure and allows a later worker to retry", async () => {
    const unavailable = new Error("Database connection unavailable")
    const client = {
      query: vi.fn(async () => ({ rows: [{ acquired: true }] })),
      release: vi.fn(),
    }
    const connect = vi.fn().mockRejectedValueOnce(unavailable).mockResolvedValue(client)
    const factory = vi
      .spyOn(postgresPool, "createPostgresPool")
      .mockReturnValue({ connect } as unknown as ReturnType<typeof postgresPool.createPostgresPool>)
    try {
      const store = new PostgresPublishingStore("postgresql://localhost/test", "123")
      const callback = vi.fn(async () => "processed")
      await expect(store.withProductLock("product", callback)).rejects.toBe(unavailable)
      expect(callback).not.toHaveBeenCalled()
      expect(client.release).not.toHaveBeenCalled()
      expect(await store.withProductLock("product", callback)).toBe("processed")
      expect(connect).toHaveBeenCalledTimes(2)
      expect(callback).toHaveBeenCalledTimes(1)
    } finally {
      factory.mockRestore()
    }
  })

  it.each(["acquisition", "release"])("discards a connection after an uncertain lock %s", async (phase) => {
    const client = { query: vi.fn(), release: vi.fn() }
    if (phase === "acquisition") client.query.mockRejectedValueOnce(new Error("Query read timeout"))
    else
      client.query
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockRejectedValueOnce(new Error("Query read timeout"))
    const factory = vi
      .spyOn(postgresPool, "createPostgresPool")
      .mockReturnValue({ connect: vi.fn(async () => client) } as unknown as ReturnType<
        typeof postgresPool.createPostgresPool
      >)
    try {
      const store = new PostgresPublishingStore("postgresql://localhost/test", "123")
      const callback = vi.fn(async () => "processed")
      const work = store.withProductLock("product", callback)
      if (phase === "acquisition") {
        await expect(work).rejects.toThrow("Query read timeout")
        expect(callback).not.toHaveBeenCalled()
      } else expect(await work).toBe("processed")
      expect(client.release).toHaveBeenCalledWith(true)
      client.query.mockResolvedValue({ rows: [{ acquired: true }] })
      expect(await store.withProductLock("product", callback)).toBe("processed")
    } finally {
      factory.mockRestore()
    }
  })
})

describe.skipIf(!databaseUrl)("durable Printify publishing", () => {
  let pool: Pool
  let first: PostgresPublishingStore
  let second: PostgresPublishingStore
  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/store_publishing_test")
      throw new Error("Use an isolated local store_publishing_test database")
    pool = await createAdminDatabaseFixture(databaseUrl!)
    await applyAllMigrations(pool)
    // Each fixture shop explicitly approves the garment before its products can be shown or scheduled.
    for (const shopId of ["123", "9100", "9300"]) await seedCompleteGarment(pool, shopId)
    first = new PostgresPublishingStore(databaseUrl!, "123")
    second = new PostgresPublishingStore(databaseUrl!, "123")
  })
  afterAll(async () => {
    await first?.close()
    await second?.close()
    await pool?.end()
  })

  // Intake defaults hidden_at, so a newly published product is not on the wall yet. A test asserting
  // what a shopper can read has to reveal it first, exactly as the owner does from /admin/products.
  async function reveal(productId: string) {
    expect(await first.setProductHidden(productId, false)).toMatchObject({ status: "saved" })
  }

  // hidden_at and reveal_at are always named: the reveal gate defaults hidden_at to now(), so a
  // seeded row would otherwise arrive hidden and quietly change what every older test asserts.
  // Every snapshot is on blueprint 1317 unless a test says otherwise; `blueprintId: null` leaves the
  // key out altogether, which is a snapshot the garment gate cannot read. added_to_shop_at has no
  // default, so a row seeded here has never been stamped unless the test says when it arrived.
  async function insertProduct(
    shopId: string,
    productId: string,
    active = true,
    visibility: {
      hiddenAt?: string | null
      revealAt?: string | null
      addedToShopAt?: string | null
      blueprintId?: number | null
    } = {}
  ) {
    const blueprintId = visibility.blueprintId === undefined ? 1317 : visibility.blueprintId
    await pool.query(
      `insert into commerce.printify_products (shop_id,product_id,snapshot,active,hidden_at,reveal_at,added_to_shop_at)
         values ($1,$2,$3::jsonb,$4,$5,$6,$7)`,
      [
        shopId,
        productId,
        active
          ? JSON.stringify({
              id: productId,
              shop_id: Number(shopId),
              ...(blueprintId === null ? {} : { blueprint_id: blueprintId }),
            })
          : null,
        active,
        visibility.hiddenAt ?? null,
        visibility.revealAt ?? null,
        visibility.addedToShopAt ?? null,
      ]
    )
  }

  it("reorders the featured lineup while unpublished and newly published products keep their places", async () => {
    const store = new PostgresPublishingStore(databaseUrl!, "456")
    try {
      const otherShop = await first.listProductIds()
      await insertProduct("456", "tee-a")
      await insertProduct("456", "unpublished", false)
      await insertProduct("456", "tee-b")
      await insertProduct("456", "tee-c")
      expect(await store.reorderProducts(["tee-c", "tee-a", "tee-b"])).toBe("saved")
      expect(await store.listProductIds()).toEqual(["tee-c", "tee-a", "tee-b"])
      expect((await store.listProducts()).map((product) => product.id)).toEqual(["tee-c", "tee-a", "tee-b"])
      await pool.query(
        "update commerce.printify_products set snapshot='{\"id\":\"unpublished\",\"shop_id\":456}',active=true where shop_id='456' and product_id='unpublished'"
      )
      expect(await store.listProductIds()).toEqual(["tee-c", "unpublished", "tee-a", "tee-b"])
      await insertProduct("456", "tee-new")
      expect(await store.listProductIds()).toEqual(["tee-c", "unpublished", "tee-a", "tee-b", "tee-new"])
      expect(await first.listProductIds()).toEqual(otherShop)
    } finally {
      await store.close()
    }
  })

  it("refuses a stale or malformed lineup without changing the saved order", async () => {
    const store = new PostgresPublishingStore(databaseUrl!, "789")
    const other = new PostgresPublishingStore(databaseUrl!, "790")
    try {
      await insertProduct("789", "tee-x")
      await insertProduct("789", "tee-y")
      await insertProduct("789", "retired", false)
      await insertProduct("790", "elsewhere")
      for (const stale of [
        ["tee-y"],
        ["tee-y", "tee-x", "tee-x"],
        ["tee-y", "tee-y"],
        ["tee-y", "retired"],
        ["tee-y", "elsewhere"],
        ["tee-y", "tee-x", "retired"],
      ])
        expect(await store.reorderProducts(stale)).toBe("changed")
      expect(await store.listProductIds()).toEqual(["tee-x", "tee-y"])
      expect(await other.listProductIds()).toEqual(["elsewhere"])
    } finally {
      await store.close()
      await other.close()
    }
  })

  it("saves one complete lineup when two are saved at once", async () => {
    const store = new PostgresPublishingStore(databaseUrl!, "901")
    const again = new PostgresPublishingStore(databaseUrl!, "901")
    try {
      for (const id of ["one", "two", "three", "four"]) await insertProduct("901", id)
      const orders = [
        ["four", "three", "two", "one"],
        ["two", "four", "one", "three"],
      ]
      expect(await Promise.all([store.reorderProducts(orders[0]!), again.reorderProducts(orders[1]!)])).toEqual([
        "saved",
        "saved",
      ])
      expect(orders).toContainEqual(await store.listProductIds())
      const positions = (
        await pool.query<{ sort_position: string }>(
          "select sort_position from commerce.printify_products where shop_id='901'"
        )
      ).rows.map((row) => row.sort_position)
      expect(new Set(positions).size).toBe(4)
    } finally {
      await store.close()
      await again.close()
    }
  })

  it("resumes completed image uploads after failure without crossing product or shop boundaries", async () => {
    const { event } = publishingFixture()
    const other = publishingFixture()
    const otherShop = new PostgresPublishingStore(databaseUrl!, "456")
    const otherShopEvent = { ...event, id: randomUUID(), shopId: "456" }
    const key = "publication:mockup-source-url"
    const url = "https://catalog.public.blob.vercel-storage.com/mockup.jpg"
    try {
      await first.enqueue(event)
      await first.enqueue(other.event)
      await otherShop.enqueue(otherShopEvent)
      await expect(
        first.withProductLock(event.productId, async (record) => {
          expect(await record.imageUploads.read(key)).toBeNull()
          await record.imageUploads.save(key, url)
          throw new Error("Next upload interrupted")
        })
      ).rejects.toThrow("Next upload interrupted")
      await second.withProductLock(event.productId, async (record) => {
        expect(await record.imageUploads.read(key)).toBe(url)
        await record.imageUploads.save(key, url)
        await expect(record.imageUploads.save(key, `${url}?different`)).rejects.toThrow("Conflicting")
        expect(await record.imageUploads.read(key)).toBe(url)
        expect(await record.imageUploads.read("new-publication:mockup-source-url")).toBeNull()
      })
      await first.withProductLock(other.event.productId, async (record) => {
        expect(await record.imageUploads.read(key)).toBeNull()
        await record.imageUploads.save(key, `${url}?other-product`)
      })
      await otherShop.withProductLock(event.productId, async (record) => {
        expect(await record.imageUploads.read(key)).toBeNull()
        await record.imageUploads.save(key, `${url}?other-shop`)
      })
      const rows = await pool.query("select key_hash,url from commerce.published_image_uploads where product_id=$1", [
        event.productId,
      ])
      expect(rows.rows).toHaveLength(2)
      expect(rows.rows.every((row) => /^[0-9a-f]{64}$/.test(row.key_hash))).toBe(true)
    } finally {
      await pool.query("update commerce.printify_publish_jobs set state='complete' where event_id=any($1::text[])", [
        [event.id, other.event.id, otherShopEvent.id],
      ])
      await otherShop.close()
    }
  })

  it("keeps upload receipts private and enables row level security", async () => {
    const result = await pool.query(
      `select relrowsecurity,
         not exists (select 1 from aclexplode(coalesce(relacl,acldefault('r',relowner))) where grantee=0) as public_denied
       from pg_class where oid='commerce.published_image_uploads'::regclass`
    )
    expect(result.rows[0]).toEqual({ relrowsecurity: true, public_denied: true })
  })

  it("defers completed upload progress without consuming failure attempts or reopening finished jobs", async () => {
    const { event } = publishingFixture()
    await first.enqueue(event)
    await first.withProductLock(event.productId, async (record) => {
      await record.retry(event.id, "IMAGE_COPY_FAILED")
      await record.retry(event.id, "IMAGE_COPY_FAILED")
      expect(await record.getJob(event.id)).toMatchObject({ attempts: 2 })
      await record.deferImages(event.id)
      expect(await record.getJob(event.id)).toMatchObject({
        state: "pending",
        attempts: 0,
        failureCode: "IMAGE_COPY_PENDING",
        outcome: null,
        callbackAttempted: false,
      })
      const due = await pool.query(
        "select extract(epoch from next_attempt_at-now())::float as seconds from commerce.printify_publish_jobs where event_id=$1",
        [event.id]
      )
      expect(due.rows[0].seconds).toBeGreaterThan(25)
      expect(due.rows[0].seconds).toBeLessThanOrEqual(30)
      expect((await second.listPending(25)).some((job) => job.eventId === event.id)).toBe(false)
      await record.finish(event.id, "complete", "FINISHED")
      await record.deferImages(event.id)
      expect(await record.getJob(event.id)).toMatchObject({ state: "complete", failureCode: "FINISHED" })
    })
  })

  it("backfills only images, preserving catalog position, published metadata, jobs, and previous revisions", async () => {
    const { event, product } = publishingFixture()
    const snapshot = { ...product, visible: true, external: { id: "published-id" }, custom: { keep: [1, "value"] } }
    await first.enqueue(event)
    await first.withProductLock(event.productId, async (record) => {
      await record.activate(event, snapshot, "saved-production-fingerprint")
      await record.finish(event.id, "complete")
    })
    const before = (await pool.query("select * from commerce.printify_products where product_id=$1", [event.productId]))
      .rows[0]
    const jobs = (await pool.query("select * from commerce.printify_publish_jobs where event_id=$1", [event.id])).rows
    const images = product.images.map((image, index) => ({
      ...image,
      src: `https://catalog.public.blob.vercel-storage.com/${index}.jpg`,
    }))
    await second.withProductLock(event.productId, async (record) => {
      const target = await record.getImageBackfill()
      expect(target).toEqual({ revision: "1", snapshot })
      expect(await record.replaceProductImages(target!.revision, images)).toBe(true)
      expect(await record.replaceProductImages(target!.revision, [])).toBe(false)
    })
    const after = (await pool.query("select * from commerce.printify_products where product_id=$1", [event.productId]))
      .rows[0]
    expect(after).toEqual({ ...before, revision: "2", snapshot: { ...snapshot, images }, updated_at: expect.any(Date) })
    expect(
      (await pool.query("select * from commerce.printify_publish_jobs where event_id=$1", [event.id])).rows
    ).toEqual(jobs)
    expect(
      (
        await pool.query(
          "select revision,event_id,snapshot from commerce.printify_product_revisions where product_id=$1 order by revision",
          [event.productId]
        )
      ).rows
    ).toEqual([
      { revision: "1", event_id: event.id, snapshot },
      { revision: "2", event_id: null, snapshot: { ...snapshot, images } },
    ])
  })

  it("writes and clears only reviewed Google copy with revision history, retaining all unrelated state and legacy output", async () => {
    const { event, product } = publishingFixture()
    const snapshot = { ...product, visible: true, custom: { keep: true } }
    await first.enqueue(event)
    await first.withProductLock(event.productId, async (record) => {
      await record.activate(event, snapshot, "source")
      await record.finish(event.id, "complete")
    })
    const profiles = await first.garments.listFeedProfiles()
    const baseline = createMerchantFeed(
      [prepareMerchantProduct(snapshot, "123", new URL("https://example.com"), profiles).merchantProduct],
      new URL("https://example.com")
    )
    const copy = googleCopyFor(snapshot)
    const before = (await pool.query("select * from commerce.printify_products where product_id=$1", [event.productId]))
      .rows[0]
    expect(await second.updateGoogleMerchantCopy(event.productId, "1", copy)).toEqual({ newRevision: "2" })
    expect(await second.updateGoogleMerchantCopy(event.productId, "1", null)).toBeNull()
    const after = (await pool.query("select * from commerce.printify_products where product_id=$1", [event.productId]))
      .rows[0]
    expect(after).toEqual({
      ...before,
      revision: "2",
      snapshot: { ...snapshot, google_merchant_copy: copy },
      updated_at: expect.any(Date),
    })
    expect(await second.updateGoogleMerchantCopy(event.productId, "2", copy)).toEqual({ newRevision: "2" })
    expect(
      (await pool.query("select * from commerce.printify_products where product_id=$1", [event.productId])).rows[0]
    ).toEqual(after)
    await expect(second.updateGoogleMerchantCopy(event.productId, "2", { ...copy, origin: "human" })).rejects.toThrow(
      "GOOGLE_COPY_ORIGIN_DOWNGRADE"
    )
    await expect(
      second.updateGoogleMerchantCopy(event.productId, "2", { ...copy, content: "x".repeat(5000) })
    ).rejects.toThrow("GOOGLE_COPY_INVALID_APPROVAL")
    expect(await second.updateGoogleMerchantCopy(event.productId, "2", null)).toEqual({ newRevision: "3" })
    await expect(second.updateGoogleMerchantCopy(event.productId, "3", { ...copy, origin: "human" })).rejects.toThrow(
      "GOOGLE_COPY_ORIGIN_DOWNGRADE"
    )
    const cleared = (
      await pool.query("select * from commerce.printify_products where product_id=$1", [event.productId])
    ).rows[0]
    expect(await second.updateGoogleMerchantCopy(event.productId, "3", null)).toEqual({ newRevision: "3" })
    expect(
      (await pool.query("select * from commerce.printify_products where product_id=$1", [event.productId])).rows[0]
    ).toEqual(cleared)
    const restored = (
      await pool.query("select snapshot from commerce.printify_products where product_id=$1", [event.productId])
    ).rows[0].snapshot
    expect(restored).toEqual(snapshot)
    expect(
      createMerchantFeed(
        [prepareMerchantProduct(restored!, "123", new URL("https://example.com"), profiles).merchantProduct],
        new URL("https://example.com")
      )
    ).toBe(baseline)
    expect(
      (
        await pool.query(
          "select revision,event_id,snapshot from commerce.printify_product_revisions where product_id=$1 order by revision",
          [event.productId]
        )
      ).rows
    ).toEqual([
      { revision: "1", event_id: event.id, snapshot },
      { revision: "2", event_id: null, snapshot: { ...snapshot, google_merchant_copy: copy } },
      { revision: "3", event_id: null, snapshot },
    ])
    expect(
      (await pool.query("select state from commerce.printify_publish_jobs where event_id=$1", [event.id])).rows[0].state
    ).toBe("complete")
  })

  it("allows the restricted template runtime to write Google copy while browser roles cannot read its tables", async () => {
    const { event, product } = publishingFixture()
    await first.enqueue(event)
    await first.withProductLock(event.productId, async (record) => {
      await record.activate(event, product, "source")
      await record.finish(event.id, "complete")
    })
    const runtimeUrl = new URL(databaseUrl!)
    runtimeUrl.searchParams.set("options", "-c role=store_app_runtime")
    const runtimeStore = new PostgresPublishingStore(runtimeUrl.href, event.shopId)
    try {
      for (const role of ["anon", "authenticated"]) {
        for (const table of [
          "printify_products",
          "printify_product_revisions",
          "printify_publish_jobs",
          "garment_models",
          "product_gallery_assets",
          "product_galleries",
          "product_gallery_revisions",
          "product_gallery_promotions",
        ]) {
          expect(
            (
              await pool.query("select has_table_privilege($1,$2,'select,insert,update,delete') as allowed", [
                role,
                `commerce.${table}`,
              ])
            ).rows[0].allowed
          ).toBe(false)
        }
      }
      expect(await runtimeStore.updateGoogleMerchantCopy(event.productId, "1", googleCopyFor(product))).toEqual({
        newRevision: "2",
      })
      expect(await runtimeStore.updateGoogleMerchantCopy(event.productId, "2", null)).toEqual({ newRevision: "3" })
    } finally {
      await runtimeStore.close()
    }
  })

  it("continues an audit past invalid snapshots and clears invalid snapshots without parsing them", async () => {
    const { event, product } = publishingFixture()
    const snapshot = { ...product, title: null, google_merchant_copy: { origin: "generated", content: "PRIVATE COPY" } }
    await first.enqueue(event)
    await first.withProductLock(event.productId, async (record) => {
      await record.activate(event, snapshot, "source")
      await record.finish(event.id, "complete")
    })
    const sibling = publishingFixture()
    await first.enqueue(sibling.event)
    await first.withProductLock(sibling.event.productId, async (record) => {
      await record.activate(sibling.event, sibling.product, "source")
      await record.finish(sibling.event.id, "complete")
    })
    const run = (args: string[]) =>
      promisify(execFile)(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "scripts/printify/google-merchant-copy.ts",
          "--shop-id",
          "123",
          ...args,
        ],
        { env: { ...process.env, DATABASE_URL: databaseUrl }, maxBuffer: 1024 * 1024, timeout: 8_000 }
      )
    const audit = parseGoogleCopyCliResult((await run(["--limit", "100"])).stdout)
    expect(audit.results).toContainEqual(
      expect.objectContaining({ productId: event.productId, code: "INVALID_SNAPSHOT" })
    )
    expect(audit.results).toContainEqual(
      expect.objectContaining({ productId: sibling.event.productId, issues: [{ code: "MISSING" }] })
    )
    const proposalDirectory = await mkdtemp(join(tmpdir(), "invalid-google-copy-"))
    const proposalPath = join(proposalDirectory, "approved.json")
    try {
      await writeFile(proposalPath, JSON.stringify(googleCopyFor(product)))
      await expect(
        run([
          "--product-id",
          event.productId,
          "--expected-revision",
          "1",
          "--input",
          proposalPath,
          "--apply",
          "--approved",
        ])
      ).rejects.toMatchObject({ stderr: expect.stringContaining("GOOGLE_COPY_INVALID_SNAPSHOT") })
      expect(
        (await pool.query("select revision from commerce.printify_products where product_id=$1", [event.productId]))
          .rows[0].revision
      ).toBe("1")
    } finally {
      await rm(proposalDirectory, { recursive: true, force: true })
    }
    const cleared = parseGoogleCopyCliResult(
      (await run(["--product-id", event.productId, "--expected-revision", "1", "--clear", "--apply", "--approved"]))
        .stdout
    )
    expect(cleared.newRevision).toBe("2")
    expect(JSON.stringify(cleared)).not.toContain("PRIVATE COPY")
    expect(
      (await pool.query("select snapshot from commerce.printify_products where product_id=$1", [event.productId]))
        .rows[0].snapshot
    ).toEqual({ ...product, title: null })
  }, 30_000)

  it("prints committed revisions and applies the same provenance guard during CLI dry-run", async () => {
    const { event, product } = publishingFixture()
    await first.enqueue(event)
    await first.withProductLock(event.productId, async (record) => {
      await record.activate(event, product, "source")
      await record.finish(event.id, "complete")
    })
    const directory = await mkdtemp(join(tmpdir(), "google-copy-review-"))
    const input = join(directory, "approved.json")
    const run = (args: string[]) =>
      promisify(execFile)(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "scripts/printify/google-merchant-copy.ts",
          "--shop-id",
          "123",
          "--product-id",
          event.productId,
          ...args,
        ],
        { env: { ...process.env, DATABASE_URL: databaseUrl }, maxBuffer: 1024 * 1024, timeout: 8_000 }
      )
    try {
      const copy = googleCopyFor(product)
      await writeFile(input, JSON.stringify(copy))
      const applied = parseGoogleCopyCliResult(
        (await run(["--expected-revision", "1", "--input", input, "--apply", "--approved"])).stdout
      )
      expect(applied.newRevision).toBe("2")
      expect(applied.results[0]?.revision).toBe("1")
      const cleared = parseGoogleCopyCliResult(
        (await run(["--expected-revision", applied.newRevision, "--clear", "--apply", "--approved"])).stdout
      )
      expect(cleared.newRevision).toBe("3")
      await writeFile(
        input,
        JSON.stringify({ ...copy, origin: "human", content: copy.content + " Edited by a human." })
      )
      await expect(run(["--expected-revision", cleared.newRevision, "--input", input])).rejects.toMatchObject({
        stderr: expect.stringContaining("GOOGLE_COPY_ORIGIN_DOWNGRADE"),
      })
      await expect(
        second.updateGoogleMerchantCopy(event.productId, cleared.newRevision, {
          ...copy,
          origin: "human",
          content: copy.content + " Edited by a human.",
        })
      ).rejects.toThrow("GOOGLE_COPY_ORIGIN_DOWNGRADE")
      expect(
        (await pool.query("select revision from commerce.printify_products where product_id=$1", [event.productId]))
          .rows[0].revision
      ).toBe("3")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }, 30_000)

  it("requires fresh approval without carrying old Google origin across unpublish and republish", async () => {
    const { event, product } = publishingFixture()
    const generated = googleCopyFor(product)
    await first.enqueue(event)
    await first.withProductLock(event.productId, async (record) => {
      await record.activate(event, { ...product, google_merchant_copy: generated }, "source")
      await record.finish(event.id, "complete")
    })
    const deletion = {
      ...event,
      id: randomUUID(),
      action: "delete" as const,
      createdAt: new Date(Date.now() + 1000).toISOString(),
    }
    await second.enqueue(deletion)
    await first.withProductLock(event.productId, async (record) => {
      await record.activate(deletion, null, null)
      await record.finish(deletion.id, "complete")
    })
    const publication = { ...event, id: randomUUID(), createdAt: new Date(Date.now() + 2000).toISOString() }
    await second.enqueue(publication)
    await first.withProductLock(event.productId, async (record) => {
      await record.activate(publication, product, "source")
      await record.finish(publication.id, "complete")
    })
    expect(
      (await pool.query("select snapshot from commerce.printify_products where product_id=$1", [event.productId]))
        .rows[0].snapshot.google_merchant_copy
    ).toBeUndefined()
    expect(
      await second.updateGoogleMerchantCopy(event.productId, "3", {
        ...generated,
        origin: "human",
        content: "New explicitly reviewed human copy.",
      })
    ).toEqual({ newRevision: "4" })
  })

  it.each([false, true])("checks the entire lifecycle beyond 101 revisions (generated: %s)", async (generated) => {
    const { event, product } = publishingFixture()
    const copy = googleCopyFor(product)
    await first.enqueue(event)
    await first.withProductLock(event.productId, async (record) => {
      await record.activate(event, generated ? { ...product, google_merchant_copy: copy } : product, "source")
      await record.finish(event.id, "complete")
    })
    await pool.query(
      "insert into commerce.printify_product_revisions(shop_id,product_id,revision,snapshot) select $1,$2,r,$3::jsonb from generate_series(2,250) r",
      [event.shopId, event.productId, JSON.stringify(product)]
    )
    await pool.query("update commerce.printify_products set snapshot=$2::jsonb,revision=250 where product_id=$1", [
      event.productId,
      JSON.stringify(product),
    ])
    if (generated) {
      await expect(
        second.updateGoogleMerchantCopy(event.productId, "250", { ...copy, origin: "human" })
      ).rejects.toThrow("GOOGLE_COPY_ORIGIN_DOWNGRADE")
      expect(await second.updateGoogleMerchantCopy(event.productId, "250", copy)).toEqual({ newRevision: "251" })
    } else {
      expect(await second.updateGoogleMerchantCopy(event.productId, "250", { ...copy, origin: "human" })).toEqual({
        newRevision: "251",
      })
    }
  })

  it("scopes lifecycle history to the requested shop, product and revision", async () => {
    const { event, product } = publishingFixture()
    const generated = { ...product, google_merchant_copy: googleCopyFor(product) }
    await insertProduct(event.shopId, event.productId)
    await insertProduct("456", event.productId)
    await insertProduct(event.shopId, `${event.productId}-other`)
    for (const [shopId, productId, revision, snapshot] of [
      [event.shopId, event.productId, "1", product],
      [event.shopId, event.productId, "2", generated],
      [event.shopId, event.productId, "3", null],
      [event.shopId, event.productId, "4", product],
      ["456", event.productId, "1", generated],
      [event.shopId, `${event.productId}-other`, "1", generated],
    ]) {
      await pool.query(
        "insert into commerce.printify_product_revisions(shop_id,product_id,revision,snapshot) values ($1,$2,$3,$4::jsonb)",
        [shopId, productId, revision, snapshot === null ? null : JSON.stringify(snapshot)]
      )
    }
    expect(await readGoogleCopyProvenance(pool, event.shopId, event.productId, "1")).toBe("unknown")
    expect(await readGoogleCopyProvenance(pool, event.shopId, event.productId, "2")).toBe("generated")
    expect(await readGoogleCopyProvenance(pool, event.shopId, event.productId, "3")).toBe("unknown")
    expect(await readGoogleCopyProvenance(pool, event.shopId, event.productId, "4")).toBe("unknown")
  })

  it.each(["pending", "callback", "inactive"] as const)(
    "guards Google copy apply and clear while %s",
    async (state) => {
      const { event, product } = publishingFixture()
      const snapshot = { ...product, google_merchant_copy: googleCopyFor(product) }
      await first.enqueue(event)
      await first.withProductLock(event.productId, async (record) => {
        await record.activate(event, snapshot, "source")
        await record.finish(event.id, "complete")
      })
      if (state === "inactive")
        await pool.query("update commerce.printify_products set active=false where product_id=$1", [event.productId])
      else {
        const next = { ...event, id: randomUUID(), createdAt: new Date(Date.now() + 1000).toISOString() }
        await second.enqueue(next)
        await pool.query("update commerce.printify_publish_jobs set state=$2 where event_id=$1", [next.id, state])
      }
      expect(await second.updateGoogleMerchantCopy(event.productId, "1", googleCopyFor(product))).toBeNull()
      expect(await second.updateGoogleMerchantCopy(event.productId, "1", null)).toBeNull()
      expect(
        (
          await pool.query("select revision,snapshot from commerce.printify_products where product_id=$1", [
            event.productId,
          ])
        ).rows[0]
      ).toEqual({ revision: "1", snapshot })
      await pool.query("update commerce.printify_publish_jobs set state='complete' where product_id=$1", [
        event.productId,
      ])
    }
  )

  it.each([false, true])("rechecks queued intake under the row lock before Google copy clear=%s", async (clear) => {
    const { event, product } = publishingFixture()
    await first.enqueue(event)
    await first.withProductLock(event.productId, async (record) => {
      await record.activate(event, product, "source")
      await record.finish(event.id, "complete")
    })
    const next = { ...event, id: randomUUID(), createdAt: new Date(Date.now() + 1000).toISOString() }
    const intake = await pool.connect()
    let write: ReturnType<PostgresPublishingStore["updateGoogleMerchantCopy"]> | undefined
    try {
      await intake.query("begin")
      await intake.query(
        "select product_id from commerce.printify_products where shop_id=$1 and product_id=$2 for update",
        [event.shopId, event.productId]
      )
      await intake.query(
        "insert into commerce.printify_publish_jobs (event_id,shop_id,product_id,event_created_at,event) values($1,$2,$3,$4,$5::jsonb)",
        [next.id, next.shopId, next.productId, next.createdAt, JSON.stringify(next)]
      )
      write = second.updateGoogleMerchantCopy(event.productId, "1", clear ? null : googleCopyFor(product))
      await vi.waitFor(async () => {
        const waiting = await pool.query(
          "select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select revision,snapshot,active from commerce.printify_products%for update'"
        )
        expect(waiting.rows).toHaveLength(1)
      })
      await intake.query("commit")
      expect(await write).toBeNull()
    } finally {
      await intake.query("rollback")
      intake.release()
      await write
      await first.withProductLock(event.productId, async (record) => {
        await record.finish(next.id, "complete")
      })
    }
  })

  it("backfills only artwork while retaining source, images, visibility, product order and publication history", async () => {
    const { event, product } = publishingFixture()
    const snapshot = {
      ...product,
      storefront_artwork_enabled: false,
      external: { id: "published-id" },
      custom: { keep: [1, "value"] },
    }
    await first.enqueue(event)
    await first.withProductLock(event.productId, async (record) => {
      await record.activate(event, snapshot, "saved-production-fingerprint")
      await record.finish(event.id, "complete")
    })
    const before = (await pool.query("select * from commerce.printify_products where product_id=$1", [event.productId]))
      .rows[0]
    const jobs = (await pool.query("select * from commerce.printify_publish_jobs where event_id=$1", [event.id])).rows
    await second.withProductLock(event.productId, async (record) => {
      const target = await record.getImageBackfill()
      expect(target).toEqual({ revision: "1", snapshot })
      expect(await record.replaceProductArtwork(target!.revision, backfillArtwork)).toBe(true)
      expect(await record.replaceProductArtwork(target!.revision, backfillArtwork)).toBe(false)
    })
    const updatedSnapshot = { ...snapshot, storefront_artwork: backfillArtwork, storefront_artwork_enabled: true }
    const after = (await pool.query("select * from commerce.printify_products where product_id=$1", [event.productId]))
      .rows[0]
    expect(after).toEqual({ ...before, revision: "2", snapshot: updatedSnapshot, updated_at: expect.any(Date) })
    expect(
      (await pool.query("select * from commerce.printify_publish_jobs where event_id=$1", [event.id])).rows
    ).toEqual(jobs)
    expect(
      (
        await pool.query(
          "select revision,event_id,snapshot from commerce.printify_product_revisions where product_id=$1 order by revision",
          [event.productId]
        )
      ).rows
    ).toEqual([
      { revision: "1", event_id: event.id, snapshot },
      { revision: "2", event_id: null, snapshot: updatedSnapshot },
    ])
  })

  it("rejects invalid artwork before any snapshot mutation", async () => {
    const { event, product } = publishingFixture()
    await first.enqueue(event)
    await first.withProductLock(event.productId, async (record) => {
      await record.activate(event, product, "saved-production-fingerprint")
      await record.finish(event.id, "complete")
      await expect(
        record.replaceProductArtwork("1", { ...backfillArtwork, src: "https://private.example/master.png" })
      ).rejects.toThrow()
      expect(await record.getProduct()).toEqual(product)
    })
  })

  it.each(["pending", "callback"] as const)(
    "skips a backfill when a new %s job arrives during uploads",
    async (state) => {
      const { event, product } = publishingFixture()
      await first.enqueue(event)
      await first.withProductLock(event.productId, async (record) => {
        await record.activate(event, product, "source")
        await record.finish(event.id, "complete")
        const target = await record.getImageBackfill()
        expect(target?.revision).toBe("1")
        const next = { ...event, id: randomUUID(), createdAt: new Date(Date.now() + 1000).toISOString() }
        await second.enqueue(next)
        await pool.query("update commerce.printify_publish_jobs set state=$2 where event_id=$1", [next.id, state])
        expect(await record.getImageBackfill()).toBeNull()
        expect(await record.replaceProductImages(target!.revision, [])).toBe(false)
        expect(await record.replaceProductArtwork(target!.revision, backfillArtwork)).toBe(false)
        expect(await record.getProduct()).toEqual(product)
        await record.finish(next.id, "complete")
      })
      expect(
        (await pool.query("select revision from commerce.printify_products where product_id=$1", [event.productId]))
          .rows[0].revision
      ).toBe("1")
    }
  )

  it.each([false, true])(
    "backfills despite terminal attention with a later completed publication: %s",
    async (publishLater) => {
      const { event, product } = publishingFixture()
      const attention = { ...event, id: randomUUID(), createdAt: new Date(Date.now() + 1000).toISOString() }
      await first.enqueue(event)
      await first.withProductLock(event.productId, async (record) => {
        await record.activate(event, product, "source")
        await record.finish(event.id, "complete")
        await second.enqueue(attention)
        await record.finish(attention.id, "attention", "CALLBACK_STATE_UNCERTAIN")
        if (publishLater) {
          const later = { ...event, id: randomUUID(), createdAt: new Date(Date.now() + 2000).toISOString() }
          await second.enqueue(later)
          await record.activate(later, { ...product, title: "New completed publication" }, "new-source")
          await record.finish(later.id, "complete")
        }
        const terminal = await record.getJob(attention.id)
        const target = await record.getImageBackfill()
        expect(target).not.toBeNull()
        expect(target?.revision).toBe(publishLater ? "2" : "1")
        const images = product.images.map((image) => ({
          ...image,
          src: "https://catalog.public.blob.vercel-storage.com/image.png",
        }))
        expect(await record.replaceProductImages(target!.revision, images)).toBe(true)
        expect(await record.getProduct()).toEqual({ ...target!.snapshot, images })
        expect(await record.getJob(attention.id)).toEqual(terminal)
      })
      expect((await second.readHealth()).openJobProductIds).toContain(event.productId)
    }
  )

  it("retains the published snapshot and stores operator attention without acknowledging a storage configuration failure", async () => {
    const { event, product } = publishingFixture()
    await first.enqueue(event)
    await first.withProductLock(event.productId, async (record) => {
      await record.activate(event, product, "source")
      await record.finish(event.id, "complete")
    })
    const update = { ...event, id: randomUUID(), createdAt: new Date(Date.now() + 1000).toISOString() }
    await first.enqueue(update)
    const client = { request: vi.fn(async () => ({ ...product, title: "New publication" })) }
    const invalidate = vi.fn()
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    await processPublishingJobs(
      {
        store: first,
        client,
        invalidate,
        siteUrl: "https://example.com",
        hostImages: async () => {
          throw new PublishedImageError("IMAGE_STORAGE_CONFIGURATION", false)
        },
      },
      25
    )
    await reveal(event.productId)
    expect(await second.readProduct(event.productId)).toEqual(product)
    expect(client.request).toHaveBeenCalledTimes(1)
    expect(invalidate).not.toHaveBeenCalled()
    expect(
      (
        await pool.query(
          "select state,failure_code,outcome,callback_attempted from commerce.printify_publish_jobs where event_id=$1",
          [update.id]
        )
      ).rows[0]
    ).toEqual({
      state: "attention",
      failure_code: "IMAGE_STORAGE_CONFIGURATION",
      outcome: null,
      callback_attempted: false,
    })
    expect(
      (
        await pool.query("select revision from commerce.printify_product_revisions where product_id=$1", [
          event.productId,
        ])
      ).rows
    ).toEqual([{ revision: "1" }])
    expect((await second.listPending(25)).some((job) => job.eventId === update.id)).toBe(false)
  })

  it.each(["newer publication", "hidden", "deleted"] as const)(
    "does not replace the saved images after the product becomes %s",
    async (change) => {
      const { event, product } = publishingFixture()
      await first.enqueue(event)
      await first.withProductLock(event.productId, async (record) => {
        await record.activate(event, product, "source")
        await record.finish(event.id, "complete")
        const target = await record.getImageBackfill()
        expect(target?.revision).toBe("1")
        const next = { ...event, id: randomUUID(), createdAt: new Date(Date.now() + 1000).toISOString() }
        const changed = change === "deleted" ? null : { ...product, visible: change !== "hidden", title: "New title" }
        await second.enqueue(next)
        await record.activate(next, changed, "new-source")
        await record.finish(next.id, "complete")
        expect(await record.replaceProductImages(target!.revision, [])).toBe(false)
        expect(await record.replaceProductArtwork(target!.revision, backfillArtwork)).toBe(false)
        expect(await record.getProduct()).toEqual(changed)
        if (change !== "newer publication") expect(await record.getImageBackfill()).toBeNull()
      })
    }
  )

  it.each(["images", "artwork"] as const)(
    "rechecks intake after waiting for its product row lock during %s backfill",
    async (kind) => {
      const { event, product } = publishingFixture()
      const next = { ...event, id: randomUUID(), createdAt: new Date(Date.now() + 1000).toISOString() }
      await first.enqueue(event)
      await first.withProductLock(event.productId, async (record) => {
        await record.activate(event, product, "source")
        await record.finish(event.id, "complete")
        const target = await record.getImageBackfill()
        const intake = await pool.connect()
        let replacement: Promise<boolean> | undefined
        try {
          await intake.query("begin")
          await intake.query(
            "select product_id from commerce.printify_products where shop_id=$1 and product_id=$2 for update",
            [event.shopId, event.productId]
          )
          await intake.query(
            "insert into commerce.printify_publish_jobs (event_id,shop_id,product_id,event_created_at,event) values ($1,$2,$3,$4,$5::jsonb)",
            [next.id, next.shopId, next.productId, next.createdAt, JSON.stringify(next)]
          )
          replacement =
            kind === "images"
              ? record.replaceProductImages(target!.revision, [])
              : record.replaceProductArtwork(target!.revision, backfillArtwork)
          await vi.waitFor(async () => {
            const waiting = await pool.query(
              "select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select product_id from commerce.printify_products%for update'"
            )
            expect(waiting.rows).toHaveLength(1)
          })
          await intake.query("commit")
          expect(await replacement).toBe(false)
          expect(await record.getProduct()).toEqual(product)
        } finally {
          await intake.query("rollback")
          intake.release()
          await replacement
          await record.finish(next.id, "complete")
        }
      })
    }
  )

  it("does not create a product or revision while backfilling an absent product", async () => {
    const productId = randomUUID()
    await first.withProductLock(productId, async (record) => {
      expect(await record.getImageBackfill()).toBeNull()
      expect(await record.replaceProductImages("0", [])).toBe(false)
      expect(await record.replaceProductArtwork("0", backfillArtwork)).toBe(false)
    })
    expect(
      (await pool.query("select 1 from commerce.printify_products where product_id=$1", [productId])).rows
    ).toEqual([])
  })

  it("retains a hidden snapshot through callback retry and restores it without publishing an invalid draft", async () => {
    const { event, product } = publishingFixture()
    let live: Record<string, unknown> = { ...product, visible: true }
    let disconnected = false
    const client = {
      request: vi.fn(async (_id: string, action?: string) => {
        if (!action) return live
        if (disconnected) {
          disconnected = false
          throw new PrintifyRequestError("not-sent")
        }
        live = {
          ...live,
          is_locked: false,
          external: { id: event.productId, handle: `https://example.com/shop/${event.productId}` },
        }
        return null
      }),
    }
    const services = {
      store: first,
      client,
      siteUrl: "https://example.com",
      invalidate: vi.fn(),
      hostImages: identityImages,
    }
    await first.enqueue(event)
    await processPublishingJobs(services, 25)
    await reveal(event.productId)
    const before = await first.readProduct(event.productId)
    const hide: PublishingEvent = {
      ...event,
      id: randomUUID(),
      action: "update",
      publishDetails: { title: false, description: false, images: false, variants: false },
      createdAt: new Date(Date.now() + 1000).toISOString(),
    }
    live = { ...live, is_locked: true, visible: false, title: "PRIVATE", variants: undefined, print_areas: null }
    const unavailableStock = {
      observedAt: expect.any(Number),
      fingerprintVersion: "v2",
      products: { [event.productId]: [] },
    }
    disconnected = true
    await first.enqueue(hide)
    await processPublishingJobs(services, 25)
    expect(await second.readProduct(event.productId)).toBeNull()
    expect((await second.listProducts()).some((value) => value.id === event.productId)).toBe(false)
    expect(await second.listProductIds()).not.toContain(event.productId)
    expect(
      (
        await pool.query("select snapshot,active,revision from commerce.printify_products where product_id=$1", [
          event.productId,
        ])
      ).rows[0]
    ).toMatchObject({
      snapshot: { ...before, visible: false, storefront_stock: unavailableStock },
      active: false,
      revision: "2",
    })
    expect(
      (
        await pool.query(
          "select state,outcome,source_fingerprint from commerce.printify_publish_jobs where event_id=$1",
          [hide.id]
        )
      ).rows[0]
    ).toMatchObject({
      state: "callback",
      outcome: "published",
      source_fingerprint: expect.stringMatching(/^visibility-v1:/),
    })
    await pool.query("update commerce.printify_publish_jobs set next_attempt_at=now() where event_id=$1", [hide.id])
    await processPublishingJobs({ ...services, store: second }, 25)
    expect(
      (await pool.query("select state from commerce.printify_publish_jobs where event_id=$1", [hide.id])).rows[0].state
    ).toBe("complete")

    const show = { ...hide, id: randomUUID(), createdAt: new Date(Date.now() + 2000).toISOString() }
    live = { ...live, is_locked: true, visible: true }
    await first.enqueue(show)
    await processPublishingJobs(services, 25)
    expect(await second.readProduct(event.productId)).toEqual({ ...before, storefront_stock: unavailableStock })
    expect(await second.listProductIds()).toContain(event.productId)
    expect(client.request.mock.calls.filter(([, action]) => action === "unpublish")).toHaveLength(0)
    expect(client.request.mock.calls.filter(([, action]) => action === "publishing_succeeded")).toHaveLength(4)
    expect(
      (
        await pool.query(
          "select snapshot from commerce.printify_product_revisions where product_id=$1 order by revision",
          [event.productId]
        )
      ).rows
    ).toEqual([
      { snapshot: before },
      { snapshot: { ...before, visible: false, storefront_stock: unavailableStock } },
      { snapshot: { ...before, storefront_stock: unavailableStock } },
    ])
  })

  it("reads monitoring counts without changing jobs and respects scheduled retry backoff", async () => {
    const before = await first.readHealth()
    const fixtures = Array.from({ length: 5 }, publishingFixture)
    for (const fixture of fixtures) await first.enqueue(fixture.event)
    const ids = fixtures.map((fixture) => fixture.event.id)
    await pool.query("update commerce.printify_publish_jobs set state='attention' where event_id=$1", [ids[0]])
    await pool.query(
      "update commerce.printify_publish_jobs set next_attempt_at=now()-interval '11 minutes' where event_id=$1",
      [ids[1]]
    )
    await pool.query(
      "update commerce.printify_publish_jobs set state='callback',next_attempt_at=now()-interval '9 minutes' where event_id=$1",
      [ids[2]]
    )
    await pool.query(
      "update commerce.printify_publish_jobs set attempts=5,next_attempt_at=now()+interval '1 hour' where event_id=$1",
      [ids[3]]
    )
    await pool.query(
      "update commerce.printify_publish_jobs set state='complete',next_attempt_at=now()-interval '1 day' where event_id=$1",
      [ids[4]]
    )
    const unchanged = await pool.query(
      "select * from commerce.printify_publish_jobs where event_id=any($1::text[]) order by event_id",
      [ids]
    )
    try {
      const health = await second.readHealth()
      expect(health).toMatchObject({
        activeProducts: before.activeProducts,
        attentionJobs: before.attentionJobs + 1,
        overdueJobs: before.overdueJobs + 1,
        openJobProductCount: before.openJobProductCount + 4,
      })
      expect(health.productIds).toEqual(before.productIds)
      for (const fixture of fixtures.slice(0, 4)) expect(health.openJobProductIds).toContain(fixture.product.id)
      expect(health.openJobProductIds).not.toContain(fixtures[4]!.product.id)
      expect(
        (
          await pool.query(
            "select * from commerce.printify_publish_jobs where event_id=any($1::text[]) order by event_id",
            [ids]
          )
        ).rows
      ).toEqual(unchanged.rows)
    } finally {
      await pool.query("update commerce.printify_publish_jobs set state='complete' where event_id=any($1::text[])", [
        ids,
      ])
    }
  })

  it.each(["update", "delete"] as const)(
    "reports a completed publication failure until a newer %s supersedes it",
    async (action) => {
      const before = await first.readHealth()
      const { event, product } = publishingFixture()
      await first.enqueue(event)
      await first.withProductLock(event.productId, async (record) => {
        await record.fail(event, "PUBLICATION_INVALID", "source")
        await record.finish(event.id, "complete")
      })
      expect((await second.readHealth()).failedPublications).toBe(before.failedPublications + 1)
      const next: PublishingEvent = {
        ...event,
        id: randomUUID(),
        action,
        createdAt: new Date(new Date(event.createdAt).getTime() + 1000).toISOString(),
      }
      await first.enqueue(next)
      await first.withProductLock(event.productId, async (record) => {
        await record.activate(next, action === "delete" ? null : product, action === "delete" ? null : "source")
        await record.finish(next.id, "complete", action === "delete" ? "SOURCE_DELETED" : undefined)
      })
      expect((await second.readHealth()).failedPublications).toBe(before.failedPublications)
      expect(
        (
          await pool.query("select outcome,failure_code from commerce.printify_publish_jobs where event_id=$1", [
            event.id,
          ])
        ).rows[0]
      ).toMatchObject({ outcome: "failed", failure_code: "PUBLICATION_INVALID" })
    }
  )

  it("does not acknowledge a visibility request after the desired visibility changes", async () => {
    const { event, product } = publishingFixture()
    await first.enqueue(event)
    await processPublishingJobs(
      {
        store: first,
        client: { request: vi.fn(async () => product) },
        siteUrl: "https://example.com",
        invalidate: vi.fn(),
        hostImages: identityImages,
      },
      25
    )
    const hide: PublishingEvent = {
      ...event,
      id: randomUUID(),
      createdAt: new Date(Date.now() + 1000).toISOString(),
      action: "update",
      publishDetails: {},
    }
    await first.enqueue(hide)
    let reads = 0
    const client = { request: vi.fn(async () => ({ ...product, visible: ++reads > 1 })) }
    await processPublishingJobs(
      { store: first, client, siteUrl: "https://example.com", invalidate: vi.fn(), hostImages: identityImages },
      25
    )
    expect(await second.readProduct(event.productId)).toBeNull()
    expect(client.request).toHaveBeenCalledTimes(2)
    expect(
      (await pool.query("select state,failure_code from commerce.printify_publish_jobs where event_id=$1", [hide.id]))
        .rows[0]
    ).toMatchObject({ state: "attention", failure_code: "SOURCE_CHANGED_BEFORE_CALLBACK" })
  })

  it.each([
    [false, false, "complete"],
    [false, true, "attention"],
    [true, undefined, "attention"],
  ])(
    "reconciles visibility %s only with an explicit matching readback %s",
    async (savedVisibility, liveVisibility, state) => {
      const { event, product } = publishingFixture()
      const visibility: PublishingEvent = { ...event, action: "update", publishDetails: {} }
      await first.enqueue(visibility)
      await first.withProductLock(event.productId, async (record) => {
        await record.activate(visibility, { ...product, visible: savedVisibility }, "visibility-v1:committed")
      })
      const client = {
        request: vi.fn(async () => ({
          ...product,
          is_locked: false,
          visible: liveVisibility,
          external: { id: event.productId, handle: `https://example.com/shop/${event.productId}` },
        })),
      }
      await processPublishingJobs(
        { store: first, client, siteUrl: "https://example.com", invalidate: vi.fn(), hostImages: identityImages },
        25
      )
      expect(
        (await pool.query("select state from commerce.printify_publish_jobs where event_id=$1", [event.id])).rows[0]
          .state
      ).toBe(state)
      expect(client.request).toHaveBeenCalledTimes(1)
    }
  )

  it("deduplicates after restart and rejects conflicting event identity", async () => {
    const { event } = publishingFixture()
    await first.enqueue(event)
    await second.enqueue(event)
    expect(
      (
        await pool.query("select count(*)::int as count from commerce.printify_publish_jobs where event_id=$1", [
          event.id,
        ])
      ).rows[0].count
    ).toBe(1)
    await expect(second.enqueue({ ...event, action: "delete" })).rejects.toThrow("Conflicting")
    await first.withProductLock(event.productId, async (record) => {
      await record.finish(event.id, "superseded")
    })
  })

  it("keeps a committed revision through a lost callback response and reconciles without another POST", async () => {
    const { event, product } = publishingFixture()
    await first.enqueue(event)
    let posts = 0
    let acknowledged = false
    const client = {
      request: vi.fn(async (_id: string, action?: string) => {
        if (!action)
          return acknowledged
            ? {
                ...product,
                is_locked: false,
                external: { id: event.productId, handle: `https://example.com/shop/${event.productId}` },
              }
            : product
        posts++
        acknowledged = true
        if (posts === 1) throw new Error("lost callback response")
        return null
      }),
    }
    await processPublishingJobs(
      { store: first, client, siteUrl: "https://example.com", invalidate: vi.fn(), hostImages: identityImages },
      25
    )
    await reveal(event.productId)
    expect(await second.readProduct(event.productId)).toMatchObject({ title: "Toast" })
    let row = (
      await pool.query("select state,outcome,attempts from commerce.printify_publish_jobs where event_id=$1", [
        event.id,
      ])
    ).rows[0]
    expect(row).toMatchObject({ state: "callback", outcome: "published", attempts: 1 })
    await pool.query("update commerce.printify_publish_jobs set next_attempt_at=now() where event_id=$1", [event.id])
    await processPublishingJobs(
      { store: second, client, siteUrl: "https://example.com", invalidate: vi.fn(), hostImages: identityImages },
      25
    )
    row = (await pool.query("select state from commerce.printify_publish_jobs where event_id=$1", [event.id])).rows[0]
    expect(row.state).toBe("complete")
    expect(
      (
        await pool.query("select count(*)::int as count from commerce.printify_product_revisions where product_id=$1", [
          event.productId,
        ])
      ).rows[0].count
    ).toBe(1)
    expect(client.request.mock.calls.filter(([, action]) => action === "publishing_failed")).toHaveLength(0)
    expect(posts).toBe(1)
  })

  it("preserves the last good snapshot on invalid update and durably reports failure", async () => {
    const { event, product } = publishingFixture()
    await first.enqueue(event)
    const client = { request: vi.fn(async () => product as Record<string, unknown> | null) }
    const services = {
      store: first,
      client,
      siteUrl: "https://example.com",
      invalidate: vi.fn(),
      hostImages: identityImages,
    }
    await processPublishingJobs(services, 25)
    const update = {
      ...event,
      id: randomUUID(),
      createdAt: new Date(Date.now() + 1000).toISOString(),
      action: "update" as const,
    }
    await first.enqueue(update)
    product.images = []
    await processPublishingJobs(services, 25)
    await reveal(event.productId)
    expect((await second.readProduct(event.productId))?.images).toHaveLength(2)
    expect(
      (await pool.query("select state,outcome from commerce.printify_publish_jobs where event_id=$1", [update.id]))
        .rows[0]
    ).toMatchObject({ state: "complete", outcome: "failed" })
    expect(client.request).toHaveBeenCalledWith(event.productId, "publishing_failed", expect.any(Object))
  })

  it("serializes independent workers while intake remains durable", async () => {
    const { event, product } = publishingFixture()
    await first.enqueue(event)
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    const client = {
      request: vi.fn(async (_id: string, action?: string) => {
        if (!action) {
          entered()
          await wait
          return product
        }
        return null
      }),
    }
    const work = processPublishingJobs(
      { store: first, client, siteUrl: "https://example.com", invalidate: vi.fn(), hostImages: identityImages },
      25
    )
    await started
    await expect(second.enqueue(event)).resolves.toBeUndefined()
    expect(
      await processPublishingJobs(
        { store: second, client, siteUrl: "https://example.com", invalidate: vi.fn(), hostImages: identityImages },
        25
      )
    ).toEqual({ processed: 0 })
    release()
    await work
    expect(client.request.mock.calls.filter(([, action]) => action === "publishing_succeeded")).toHaveLength(1)
  })

  it("durably accepts a new delete while a worker awaits Printify and supersedes the old publish", async () => {
    const { event, product } = publishingFixture()
    await first.enqueue(event)
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const client = {
      request: vi.fn(async (_id: string, action?: string) => {
        if (action) return null
        entered.resolve()
        await release.promise
        return product
      }),
    }
    const services = {
      store: first,
      client,
      siteUrl: "https://example.com",
      invalidate: vi.fn(),
      hostImages: identityImages,
    }
    const work = processPublishingJobs(services, 25)
    await entered.promise
    const deletion = {
      ...event,
      id: randomUUID(),
      action: "delete" as const,
      createdAt: new Date(Date.now() + 1000).toISOString(),
    }
    try {
      await second.enqueue(deletion)
      expect((await second.listPending(25)).some((job) => job.eventId === deletion.id)).toBe(true)
      expect(await processPublishingJobs({ ...services, store: second }, 25)).toEqual({ processed: 0 })
    } finally {
      release.resolve()
      await work
    }
    expect(await first.readProduct(event.productId)).toBeNull()
    expect(await first.listProductIds()).not.toContain(event.productId)
    expect(client.request.mock.calls.filter(([, action]) => action)).toHaveLength(0)
    await processPublishingJobs({ ...services, store: second }, 25)
    expect(client.request).toHaveBeenCalledWith(event.productId, "unpublish", {})
    expect(
      (await pool.query("select state from commerce.printify_publish_jobs where event_id=$1", [event.id])).rows[0].state
    ).toBe("superseded")
  })

  it.each(["activate", "fail", "startCallback"] as const)(
    "rechecks event order atomically before %s",
    async (mutation) => {
      const { event, product } = publishingFixture()
      await first.enqueue(event)
      await first.withProductLock(event.productId, async (record) => {
        expect(await record.isCurrent(event)).toBe("current")
        await second.enqueue({
          ...event,
          id: randomUUID(),
          action: "delete",
          createdAt: new Date(Date.now() + 1000).toISOString(),
        })
        const applied =
          mutation === "activate"
            ? await record.activate(event, product, "source")
            : mutation === "fail"
              ? await record.fail(event, "INVALID", "source")
              : await record.startCallback(event)
        expect(applied).toBe(false)
        expect(await record.getJob(event.id)).toMatchObject({
          state: "superseded",
          callbackAttempted: false,
          outcome: null,
        })
      })
      expect(await first.readProduct(event.productId)).toBeNull()
      await pool.query("update commerce.printify_publish_jobs set state='superseded' where product_id=$1", [
        event.productId,
      ])
    }
  )

  it("skips overlapping runs on the same instance while intake remains durable", async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const work = first.withProductLock(randomUUID(), async () => {
      entered.resolve()
      await release.promise
      return "processed"
    })
    await entered.promise
    const { event } = publishingFixture()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const callback = vi.fn(async () => "unexpected")
      expect(await first.withProductLock(randomUUID(), callback)).toBeNull()
      expect(callback).not.toHaveBeenCalled()
      await Promise.race([
        first.enqueue(event),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Intake waited on worker connections")), 1000)
        }),
      ])
      expect(
        await processPublishingJobs(
          {
            store: first,
            client: { request: vi.fn() },
            siteUrl: "https://example.com",
            invalidate: vi.fn(),
            hostImages: identityImages,
          },
          25
        )
      ).toEqual({ processed: 0 })
    } finally {
      clearTimeout(timeout)
      release.resolve()
      expect(await work).toBe("processed")
    }
    expect((await first.listPending(25)).some((job) => job.eventId === event.id)).toBe(true)
    await first.withProductLock(event.productId, async (record) => {
      await record.finish(event.id, "superseded")
    })
  })

  it.each(["not-sent", "rate-limited"] as const)(
    "retries a callback proven %s without rebuilding the revision",
    async (delivery) => {
      const { event, product } = publishingFixture()
      await first.enqueue(event)
      let posts = 0
      const client = {
        request: vi.fn(async (_id: string, action?: string) => {
          if (!action) return product
          if (++posts === 1) throw new PrintifyRequestError(delivery, 120)
          return null
        }),
      }
      const services = {
        store: first,
        client,
        siteUrl: "https://example.com",
        invalidate: vi.fn(),
        hostImages: identityImages,
      }
      await processPublishingJobs(services, 25)
      const row = (
        await pool.query(
          "select state,callback_attempted,next_attempt_at > now()+interval '110 seconds' as delayed from commerce.printify_publish_jobs where event_id=$1",
          [event.id]
        )
      ).rows[0]
      expect(row).toEqual({ state: "callback", callback_attempted: false, delayed: true })
      await pool.query("update commerce.printify_publish_jobs set next_attempt_at=now() where event_id=$1", [event.id])
      await processPublishingJobs({ ...services, store: second }, 25)
      expect(posts).toBe(2)
      expect(
        (
          await pool.query(
            "select count(*)::int as count from commerce.printify_product_revisions where product_id=$1",
            [event.productId]
          )
        ).rows[0].count
      ).toBe(1)
      expect(
        (await pool.query("select state from commerce.printify_publish_jobs where event_id=$1", [event.id])).rows[0]
          .state
      ).toBe("complete")
    }
  )

  it("holds a rejected callback for a configuration or payload correction", async () => {
    const { event, product } = publishingFixture()
    await first.enqueue(event)
    const client = {
      request: vi.fn(async (_id: string, action?: string) => {
        if (action) throw new PrintifyRequestError("rejected")
        return product
      }),
    }
    await processPublishingJobs(
      { store: first, client, siteUrl: "https://example.com", invalidate: vi.fn(), hostImages: identityImages },
      25
    )
    expect(
      (
        await pool.query(
          "select state,failure_code,callback_attempted from commerce.printify_publish_jobs where event_id=$1",
          [event.id]
        )
      ).rows[0]
    ).toEqual({ state: "attention", failure_code: "CALLBACK_REJECTED", callback_attempted: false })
  })

  it.each([
    ["https://EXAMPLE.com/shop/PRODUCT/", true],
    ["https://example.com:443/shop/PRODUCT", true],
    ["https://elsewhere.com/shop/PRODUCT", false],
    ["https://example.com/shop/PRODUCT?unrelated=1", false],
    ["https://user@example.com/shop/PRODUCT", false],
  ])("reconciles a normalized external handle %s only when equivalent", async (handle, confirmed) => {
    const { event, product } = publishingFixture()
    await first.enqueue(event)
    const client = {
      request: vi.fn(async () => ({
        ...product,
        is_locked: false,
        external: { id: event.productId, handle: String(handle).replace("PRODUCT", event.productId) },
      })),
    }
    await first.withProductLock(event.productId, async (record) => {
      await record.activate(event, product, "source")
    })
    await processPublishingJobs(
      { store: first, client, siteUrl: "https://example.com", invalidate: vi.fn(), hostImages: identityImages },
      25
    )
    expect(
      (await pool.query("select state from commerce.printify_publish_jobs where event_id=$1", [event.id])).rows[0].state
    ).toBe(confirmed ? "complete" : "attention")
  })

  it("does not let a delayed publish resurrect an unpublished tombstone", async () => {
    const { event, product } = publishingFixture()
    const deletion = {
      ...event,
      id: randomUUID(),
      createdAt: new Date(Date.now() + 1000).toISOString(),
      action: "delete" as const,
      publishDetails: {},
    }
    await first.enqueue(deletion)
    await second.enqueue(event)
    const client = { request: vi.fn(async (_id: string, action?: string) => (action ? null : product)) }
    await processPublishingJobs(
      { store: first, client, siteUrl: "https://example.com", invalidate: vi.fn(), hostImages: identityImages },
      25
    )
    expect(await first.readProduct(event.productId)).toBeNull()
    expect(
      (await pool.query("select state from commerce.printify_publish_jobs where event_id=$1", [event.id])).rows[0].state
    ).toBe("superseded")
    expect(client.request).toHaveBeenCalledWith(event.productId, "unpublish", {})
    expect(client.request.mock.calls.filter(([, action]) => action === "publishing_succeeded")).toHaveLength(0)
  })

  it("holds equal-timestamp events for review rather than inventing their order", async () => {
    const { event } = publishingFixture()
    await first.enqueue(event)
    await second.enqueue({ ...event, id: randomUUID(), action: "delete" })
    const client = { request: vi.fn() }
    await processPublishingJobs(
      { store: first, client, siteUrl: "https://example.com", invalidate: vi.fn(), hostImages: identityImages },
      25
    )
    expect(client.request).not.toHaveBeenCalled()
    expect(
      (
        await pool.query("select distinct state from commerce.printify_publish_jobs where product_id=$1", [
          event.productId,
        ])
      ).rows
    ).toEqual([{ state: "attention" }])
  })

  it("holds a callback when the source changed, leaving the committed snapshot intact", async () => {
    const { event, product } = publishingFixture()
    await first.enqueue(event)
    let reads = 0
    const client = {
      request: vi.fn(async () => {
        reads++
        return reads === 1 ? product : { ...product, title: "A newer draft" }
      }),
    }
    await processPublishingJobs(
      { store: first, client, siteUrl: "https://example.com", invalidate: vi.fn(), hostImages: identityImages },
      25
    )
    await reveal(event.productId)
    expect((await first.readProduct(event.productId))?.title).toBe("Toast")
    expect(
      (await pool.query("select state,failure_code from commerce.printify_publish_jobs where event_id=$1", [event.id]))
        .rows[0]
    ).toMatchObject({ state: "attention", failure_code: "SOURCE_CHANGED_BEFORE_CALLBACK" })
    expect(client.request).toHaveBeenCalledTimes(2)
  })

  it("never resends an uncertain callback into an indistinguishable new publishing lock", async () => {
    const { event, product } = publishingFixture()
    await first.enqueue(event)
    const client = {
      request: vi.fn(async (_id: string, action?: string) => {
        if (action) throw new Error("response lost")
        return product
      }),
    }
    const services = {
      store: first,
      client,
      siteUrl: "https://example.com",
      invalidate: vi.fn(),
      hostImages: identityImages,
    }
    await processPublishingJobs(services, 25)
    await pool.query("update commerce.printify_publish_jobs set next_attempt_at=now() where event_id=$1", [event.id])
    await processPublishingJobs({ ...services, store: second }, 25)
    expect(client.request.mock.calls.filter(([, action]) => action)).toHaveLength(1)
    expect(
      (await pool.query("select state,failure_code from commerce.printify_publish_jobs where event_id=$1", [event.id]))
        .rows[0]
    ).toMatchObject({ state: "attention", failure_code: "CALLBACK_STATE_UNCERTAIN" })
  })

  it("never callbacks an invalid source that could not be identified", async () => {
    const { event, product } = publishingFixture()
    await first.enqueue(event)
    const client = { request: vi.fn(async () => ({ ...product, variants: undefined })) }
    await processPublishingJobs(
      { store: first, client, siteUrl: "https://example.com", invalidate: vi.fn(), hostImages: identityImages },
      25
    )
    expect(client.request).toHaveBeenCalledTimes(1)
    expect(
      (await pool.query("select state,failure_code from commerce.printify_publish_jobs where event_id=$1", [event.id]))
        .rows[0]
    ).toMatchObject({ state: "attention", failure_code: "INVALID_SOURCE" })
  })

  describe("app-owned reveal gate", () => {
    const shop = "9100"
    let gated: PostgresPublishingStore
    beforeAll(async () => {
      gated = new PostgresPublishingStore(databaseUrl!, shop)
      const hour = 60 * 60 * 1000
      await insertProduct(shop, "shown")
      await insertProduct(shop, "always-hidden", true, { hiddenAt: new Date(Date.now() - hour).toISOString() })
      await insertProduct(shop, "reveals-later", true, {
        hiddenAt: new Date(Date.now() - hour).toISOString(),
        revealAt: new Date(Date.now() + hour).toISOString(),
      })
      await insertProduct(shop, "reveal-passed", true, {
        hiddenAt: new Date(Date.now() - hour).toISOString(),
        revealAt: new Date(Date.now() - hour).toISOString(),
      })
      await insertProduct(shop, "unpublished", false)
    })
    afterAll(async () => {
      await gated?.close()
    })

    // The money path. readProduct is what checkout quotes against, so it carries the whole gate.
    it.each([
      ["shown", true],
      ["reveal-passed", true],
      ["always-hidden", false],
      ["reveals-later", false],
      ["unpublished", false],
    ] as const)("offers %s to shoppers and checkout: %s", async (productId, offered) => {
      expect((await gated.readProduct(productId)) !== null).toBe(offered)
      expect((await gated.listShownProducts()).some((snapshot) => snapshot.id === productId)).toBe(offered)
    })

    // A product waiting for its moment must survive the cache, so the clock can judge it outside.
    it("carries a scheduled product through the cached read with its moment attached", async () => {
      const ids = await gated.listRevealableProductIds()
      expect(ids.map((row) => row.id)).toEqual(["shown", "reveals-later", "reveal-passed"])
      expect(ids.find((row) => row.id === "shown")?.revealAt).toBeNull()
      expect(Date.parse(ids.find((row) => row.id === "reveals-later")!.revealAt!)).toBeGreaterThan(Date.now())
      expect(await gated.readRevealableProduct("reveals-later")).toMatchObject({ revealAt: expect.any(String) })
      // An indefinite hide can never reveal without a write, so it must not occupy a cache entry.
      expect(await gated.readRevealableProduct("always-hidden")).toBeNull()
    })

    // Hiding must never starve the jobs that prepare a product for its reveal.
    it("keeps every active product visible to stock, images, health and the admin page", async () => {
      const everyActive = ["shown", "always-hidden", "reveals-later", "reveal-passed"]
      expect(await gated.listProductIds()).toEqual(everyActive)
      expect((await gated.listProducts()).map((snapshot) => snapshot.id)).toEqual(everyActive)
      expect((await gated.listAdminProducts()).map((row) => row.snapshot.id)).toEqual(everyActive)
      expect(await gated.listAdminProducts()).toMatchObject([
        { hiddenAt: null, revealAt: null },
        { hiddenAt: expect.any(String), revealAt: null },
        { hiddenAt: expect.any(String), revealAt: expect.any(String) },
        { hiddenAt: expect.any(String), revealAt: expect.any(String) },
      ])
    })

    // A hidden product still holds its slot, or restoring one would shuffle the owner's lineup.
    it("still counts a hidden product in the saved lineup", async () => {
      expect(await gated.reorderProducts(["always-hidden", "shown", "reveals-later", "reveal-passed"])).toBe("saved")
      expect(await gated.reorderProducts(["shown"])).toBe("changed")
      expect(await gated.reorderProducts(["shown", "always-hidden", "reveals-later", "reveal-passed"])).toBe("saved")
    })

    it("does not restart the hidden clock on a second hide, and stamps the launch record once", async () => {
      const hiddenAt = async () =>
        (await pool.query("select hidden_at,revealed_at from commerce.printify_products where product_id='shown'"))
          .rows[0]
      expect(await gated.setProductHidden("shown", true)).toMatchObject({ status: "saved" })
      const first = await hiddenAt()
      expect(await gated.setProductHidden("shown", true)).toMatchObject({ status: "saved" })
      expect((await hiddenAt()).hidden_at).toEqual(first.hidden_at)

      expect(await gated.setProductHidden("shown", false)).toMatchObject({ status: "saved" })
      const revealed = await hiddenAt()
      expect(revealed.hidden_at).toBeNull()
      expect(revealed.revealed_at).not.toBeNull()
      expect(await gated.setProductHidden("shown", false)).toMatchObject({ status: "saved" })
      expect((await hiddenAt()).revealed_at).toEqual(revealed.revealed_at)
    })

    // A timed reveal writes nothing, so the tee a drop launched still looks hidden-since-intake with
    // no launch record. Hiding it has to read as "came off the wall today", never as "never shown".
    it("settles a product the clock revealed when the owner hides it", async () => {
      const read = async () =>
        (
          await pool.query<{ hidden_at: Date; reveal_at: Date | null; revealed_at: Date | null }>(
            "select hidden_at,reveal_at,revealed_at from commerce.printify_products where shop_id=$1 and product_id='reveal-passed'",
            [shop]
          )
        ).rows[0]!
      const before = await read()
      expect(await gated.readProduct("reveal-passed")).not.toBeNull()

      expect(await gated.setProductHidden("reveal-passed", true)).toMatchObject({ status: "saved" })
      const hidden = await read()
      expect(await gated.readProduct("reveal-passed")).toBeNull()
      // The launch record is the moment it actually went live, and the hide clock starts now.
      expect(hidden.revealed_at).toEqual(before.reveal_at)
      expect(hidden.hidden_at.getTime()).toBeGreaterThan(before.hidden_at.getTime())
      expect(hidden.reveal_at).toBeNull()

      // Still idempotent afterwards, and showing it again keeps the original launch record.
      expect(await gated.setProductHidden("reveal-passed", true)).toMatchObject({ status: "saved" })
      expect((await read()).hidden_at).toEqual(hidden.hidden_at)
      expect(await gated.setProductHidden("reveal-passed", false)).toMatchObject({ status: "saved" })
      expect((await read()).revealed_at).toEqual(before.reveal_at)
    })

    it("dates the launch record from the reveal when the owner shows a product the clock already revealed", async () => {
      const moment = new Date(Date.now() - 2 * 60 * 60 * 1000)
      await insertProduct(shop, "reveal-passed-shown", true, {
        hiddenAt: new Date(moment.getTime() - 1000).toISOString(),
        revealAt: moment.toISOString(),
      })
      expect(await gated.setProductHidden("reveal-passed-shown", false)).toMatchObject({ status: "saved" })
      expect(
        (await pool.query("select revealed_at from commerce.printify_products where product_id='reveal-passed-shown'"))
          .rows[0].revealed_at
      ).toEqual(moment)
    })

    // added_to_shop_at is the other end of the launch record: the LATEST arrival, which Newest sorts
    // by and the New badge reads. Compared to the microsecond, because two quick writes can share a
    // millisecond and a JavaScript Date would round a restamp away.
    async function arrivalMicros(productId: string) {
      const { micros } = (
        await pool.query<{ micros: string | null }>(
          `select (extract(epoch from added_to_shop_at)*1000000)::bigint::text as micros
             from commerce.printify_products where shop_id=$1 and product_id=$2`,
          [shop, productId]
        )
      ).rows[0]!
      return micros === null ? null : BigInt(micros)
    }
    async function databaseMicros() {
      return BigInt(
        (
          await pool.query<{ micros: string }>(
            "select (extract(epoch from clock_timestamp())*1000000)::bigint::text as micros"
          )
        ).rows[0]!.micros
      )
    }
    async function save(productId: string, hidden: boolean) {
      const saved = await gated.setProductHidden(productId, hidden)
      if (typeof saved === "string") throw new Error(`${productId} was not saved: ${saved}`)
      return saved
    }

    // Both ways a product is off the wall today: hidden until the owner says so, or waiting for a
    // drop. Showing either by hand is its arrival, now, and never the drop it skipped.
    it.each([
      ["an indefinitely hidden", null],
      ["a scheduled", new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()],
    ] as const)(
      "stamps the arrival when the owner shows %s product, and a repeat Show keeps it",
      async (state, revealAt) => {
        const productId = `arrives-${state.split(" ").at(-1)}`
        await insertProduct(shop, productId, true, {
          hiddenAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          revealAt,
        })
        const before = await databaseMicros()
        const shown = await save(productId, false)
        const after = await databaseMicros()
        const stamp = await arrivalMicros(productId)
        expect(stamp).toBeGreaterThanOrEqual(before)
        expect(stamp).toBeLessThanOrEqual(after)
        // Every reader carries the same moment: the saved answer, the admin page and the storefront.
        expect(shown.addedToShopAt).toBe(new Date(Number(stamp! / 1000n)).toISOString())
        expect((await gated.listAdminProducts()).find((row) => row.snapshot.id === productId)?.addedToShopAt).toBe(
          shown.addedToShopAt
        )
        expect(await gated.readRevealableProduct(productId)).toMatchObject({
          addedToShopAt: shown.addedToShopAt,
          revealAt: null,
        })

        // A double-click or a stale tab must not make a tee that is already up the newest in the shop.
        expect((await save(productId, false)).addedToShopAt).toBe(shown.addedToShopAt)
        expect(await arrivalMicros(productId)).toBe(stamp)
      }
    )

    // A moment far from every other column, so a reader handing on the launch record or the reveal
    // instead of the arrival cannot pass by landing in the same millisecond.
    it("hands every reader the stored arrival, and leaves it alone when a product already up is shown", async () => {
      const arrived = "2026-09-01T12:00:00.000Z"
      await insertProduct(shop, "already-up", true, { addedToShopAt: arrived })
      expect((await gated.listAdminProducts()).find((row) => row.snapshot.id === "already-up")).toMatchObject({
        revealedAt: null,
        addedToShopAt: arrived,
      })
      expect(await gated.readRevealableProduct("already-up")).toMatchObject({ revealAt: null, addedToShopAt: arrived })
      expect(await save("already-up", false)).toMatchObject({ hiddenAt: null, addedToShopAt: arrived })
      expect(await gated.readRevealableProduct("already-up")).toMatchObject({ addedToShopAt: arrived })
    })

    // Hiding keeps the arrival, so the undo runbook's raw `hidden_at = null` puts a tee back where it
    // was. Showing it again by hand is a new arrival: the tee the owner put back most recently is
    // the newest one, even if it has been on the wall before.
    it("keeps the arrival through a hide, and restamps it when the owner shows the product again", async () => {
      await insertProduct(shop, "comes-back", true, { hiddenAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
      await save("comes-back", false)
      const firstArrival = await arrivalMicros("comes-back")

      const hidden = await save("comes-back", true)
      expect(hidden.hiddenAt).not.toBeNull()
      expect(await arrivalMicros("comes-back")).toBe(firstArrival)
      expect((await save("comes-back", true)).addedToShopAt).toBe(hidden.addedToShopAt)
      expect(await arrivalMicros("comes-back")).toBe(firstArrival)
      // Off the wall the storefront cannot see it, but the admin page still says when it last arrived.
      expect(await gated.readRevealableProduct("comes-back")).toBeNull()
      expect((await gated.listAdminProducts()).find((row) => row.snapshot.id === "comes-back")?.addedToShopAt).toBe(
        hidden.addedToShopAt
      )

      await save("comes-back", false)
      expect(await arrivalMicros("comes-back")).toBeGreaterThan(firstArrival!)
    })

    // A timed reveal writes nothing when its moment passes. Until the owner's next hide or show, the
    // row keeps whatever stamp it had before and readers take the reveal instead. That write then
    // settles the arrival from the moment the tee really went live, never from the click, because
    // both branches overwrite the reveal_at readers were taking it from.
    it.each([
      // First arrival is its scheduled reveal, before any explicit Show action.
      ["shows", "never stamped", false, null],
      // Stamped on an earlier visit, before the hide that queued this drop. The later moment has to
      // win on both branches, which is what separates greatest() from keeping the stamp it had.
      ["shows", "stamped on an earlier visit", false, "2026-01-01T00:00:00.000Z"],
      ["hides", "stamped on an earlier visit", true, "2026-01-01T00:00:00.000Z"],
    ] as const)(
      "settles the arrival of a product the clock revealed when the owner %s it (%s)",
      async (verb, _history, hidden, earlier) => {
        const productId = `clock-arrived-${verb}-${earlier === null ? "unstamped" : "stamped"}`
        const moment = new Date(Date.now() - 2 * 60 * 60 * 1000)
        await insertProduct(shop, productId, true, {
          hiddenAt: new Date(moment.getTime() - 60 * 60 * 1000).toISOString(),
          revealAt: moment.toISOString(),
          addedToShopAt: earlier,
        })
        // The raw stamp and the reveal, both: settling the pair is the storefront's job until a write.
        expect(await gated.readRevealableProduct(productId)).toMatchObject({
          addedToShopAt: earlier,
          revealAt: moment.toISOString(),
        })

        const saved = await save(productId, hidden)
        expect(saved).toMatchObject({ revealAt: null, addedToShopAt: moment.toISOString() })
        expect(await arrivalMicros(productId)).toBe(BigInt(moment.getTime()) * 1000n)
      }
    )

    it("clears a pending reveal when the owner shows the product by hand", async () => {
      expect(await gated.setProductHidden("reveals-later", false)).toMatchObject({ status: "saved" })
      expect(
        (await pool.query("select reveal_at from commerce.printify_products where product_id='reveals-later'")).rows[0]
          .reveal_at
      ).toBeNull()
    })

    it.each(["unpublished", "never-seen"])("reports %s as missing rather than silently doing nothing", async (id) => {
      expect(await gated.setProductHidden(id, true)).toBe("missing")
    })

    it("refuses a reveal date on a product nothing is hiding", async () => {
      await expect(
        pool.query("update commerce.printify_products set reveal_at=now() where product_id='shown'")
      ).rejects.toThrow("printify_products_reveal_while_hidden")
    })
  })

  describe("garment gate", () => {
    const shop = "9300"
    const hour = 60 * 60 * 1000
    const hiddenAt = new Date(Date.now() - hour).toISOString()
    let gated: PostgresPublishingStore

    // 1317 is complete (seeded in the outer beforeAll). 9002 has a row the owner never finished, and
    // 9001 has no row at all; to the writers those are one answer.
    beforeAll(async () => {
      gated = new PostgresPublishingStore(databaseUrl!, shop)
      await pool.query(
        `insert into commerce.garment_models (shop_id,blueprint_id,manufacturer,model,category_slug,gender)
           values ($1,9002,'Bella+Canvas','3001','t-shirts','unisex')`,
        [shop]
      )
      await insertProduct(shop, "hidden-no-garment", true, { hiddenAt, blueprintId: 9001 })
      await insertProduct(shop, "hidden-unfinished-garment", true, { hiddenAt, blueprintId: 9002 })
      await insertProduct(shop, "hidden-no-blueprint", true, { hiddenAt, blueprintId: null })
      await insertProduct(shop, "hidden-complete", true, { hiddenAt })
      // On the wall on an unfinished garment: the state a republish or a Printify-side change can
      // still produce, and the one the gate must not make worse to live with.
      await insertProduct(shop, "selling-unfinished-garment", true, { blueprintId: 9002 })
    })
    afterAll(async () => {
      await gated?.close()
    })
    // These tests share the rows above, and several leave one changed on the way to
    // their point. Putting that back HERE, rather than as each test's last line, is what stops one
    // failed assertion from skipping the tidy-up and failing four innocent tests after it.
    afterEach(async () => {
      await pool.query(
        `update commerce.printify_products set hidden_at=null,reveal_at=null
          where shop_id=$1 and product_id='selling-unfinished-garment'`,
        [shop]
      )
      await pool.query(
        "update commerce.printify_products set hidden_at=$2,reveal_at=null where shop_id=$1 and product_id='hidden-complete'",
        [shop, hiddenAt]
      )
    })

    async function row(productId: string) {
      return (
        await pool.query(
          "select hidden_at,reveal_at,revealed_at,updated_at,revision from commerce.printify_products where shop_id=$1 and product_id=$2",
          [shop, productId]
        )
      ).rows[0]
    }
    // Deterministic, not a sleep: the other transaction is known to be queued behind the row lock.
    async function waitUntilBlockedOn(fragment: string) {
      for (let attempt = 0; attempt < 150; attempt++) {
        const waiting = await pool.query(
          "select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like $1",
          [`%${fragment}%`]
        )
        if (waiting.rows.length) return
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      throw new Error(`Nothing ever waited on ${fragment}`)
    }

    it.each(["hidden-no-garment", "hidden-unfinished-garment", "hidden-no-blueprint"])(
      "refuses to show %s and leaves the row exactly as it was",
      async (productId) => {
        const before = await row(productId)
        expect(await gated.setProductHidden(productId, false)).toBe("garment-incomplete")
        expect(await row(productId)).toEqual(before)
        expect(await gated.readProduct(productId)).toBeNull()
      }
    )

    it("shows a hidden product once its garment is complete", async () => {
      expect(await gated.setProductHidden("hidden-complete", false)).toMatchObject({ status: "saved" })
      expect(await gated.readProduct("hidden-complete")).not.toBeNull()
      expect(await gated.setProductHidden("hidden-complete", true)).toMatchObject({ status: "saved" })
    })

    // Taking a product off the wall must work on the worst day, whatever state its garment is in.
    it("still hides a product whose garment is unfinished", async () => {
      expect(await gated.setProductHidden("selling-unfinished-garment", true)).toMatchObject({ status: "saved" })
      expect(await gated.readProduct("selling-unfinished-garment")).toBeNull()
      // ...and that was a one-way door: it is a hidden product on an unfinished garment now.
      expect(await gated.setProductHidden("selling-unfinished-garment", false)).toBe("garment-incomplete")
    })

    // Only the hidden -> shown TRANSITION is gated. "Show" on a tee shoppers can already buy
    // protects nothing by failing, so it stays the idempotent no-op it always was.
    it("keeps showing an already-shown product idempotent when its garment is unfinished", async () => {
      expect(await gated.readProduct("selling-unfinished-garment")).not.toBeNull()
      expect(await gated.setProductHidden("selling-unfinished-garment", false)).toMatchObject({ status: "saved" })
      expect(await gated.readProduct("selling-unfinished-garment")).not.toBeNull()
    })

    // THE RACE the row locks exist for. The garment editor holds the garment `for update`; a Show
    // that arrives now must WAIT, and when the editor commits an unfinished garment the Show must see
    // that, not the complete garment its snapshot started with.
    it("refuses a show that was waiting while the garment became unfinished", async () => {
      await seedCompleteGarment(pool, shop, 9003)
      await insertProduct(shop, "racing-tee", true, { hiddenAt, blueprintId: 9003 })
      const editor = await pool.connect()
      let show: ReturnType<PostgresPublishingStore["setProductHidden"]>
      try {
        await editor.query("begin")
        await editor.query(
          "select complete from commerce.garment_models where shop_id=$1 and blueprint_id=9003 for update",
          [shop]
        )
        show = gated.setProductHidden("racing-tee", false)
        await waitUntilBlockedOn("garment_models where shop_id=$1 and blueprint_id=$2 and complete for share")
        await editor.query(
          "update commerce.garment_models set category_slug=null where shop_id=$1 and blueprint_id=9003",
          [shop]
        )
        await editor.query("commit")
      } catch (error) {
        await editor.query("rollback").catch(() => undefined)
        throw error
      } finally {
        editor.release()
      }
      expect(await show).toBe("garment-incomplete")
      expect(await gated.readProduct("racing-tee")).toBeNull()
      expect((await row("racing-tee")).hidden_at).not.toBeNull()
    })
  })

  describe("published product weekly schedule", () => {
    const featuredBy = "11111111-1111-4111-8111-111111111111"
    const future = () => new Date(Date.now() + 7 * 86_400_000).toISOString()
    const later = () => new Date(Date.now() + 14 * 86_400_000).toISOString()
    const hiddenAt = "2026-01-01T00:00:00.000Z"
    const schedule = (productIds: string[], liveAt = future()) =>
      first.productSchedule.schedule({ productIds, liveAt, featuredBy })
    async function visibility(id: string) {
      return (
        await pool.query(
          "select hidden_at,reveal_at from commerce.printify_products where shop_id='123' and product_id=$1",
          [id]
        )
      ).rows[0]
    }

    it.each(["expired", "superseded"] as const)(
      "does not report an %s historical assignment as current when removing a product",
      async (state) => {
        const shop = state === "expired" ? "9400" : "9401"
        const store = new PostgresPublishingStore(databaseUrl!, shop)
        const id = randomUUID()
        const currentBoundary = listCadenceSlots({ from: new Date(Date.now() - 15 * 86_400_000), count: 3 })
          .filter((instant) => instant.getTime() <= Date.now())
          .at(-1)!
          .getTime()
        const liveAt = new Date(currentBoundary - (state === "expired" ? 60_000 : 0)).toISOString()
        try {
          await insertProduct(shop, id)
          await pool.query(
            "insert into commerce.product_week_schedule (shop_id,product_id,live_at,featured_by) values ($1,$2,$3,$4)",
            [shop, id, liveAt, featuredBy]
          )
          if (state === "superseded") {
            const currentId = randomUUID()
            await insertProduct(shop, currentId)
            await pool.query(
              "insert into commerce.product_week_schedule (shop_id,product_id,live_at,featured_by) values ($1,$2,$3,$4)",
              [shop, currentId, new Date(currentBoundary + 1).toISOString(), featuredBy]
            )
          }
          // Persistence still returns this recent historical row; only the current-week resolver
          // knows that it expired or that another product's later feature superseded it.
          expect(await store.productSchedule.list()).toContainEqual(expect.objectContaining({ productId: id, liveAt }))
          expect(await store.productSchedule.remove(id)).toMatchObject({
            outcome: "unscheduled",
            entries: [],
            products: [{ productId: id, hiddenAt: null, revealAt: null }],
          })
          expect(await store.readProduct(id)).not.toBeNull()
        } finally {
          await store.close()
        }
      }
    )

    it("queues multiple products together without hiding one already in the shop", async () => {
      const hidden = randomUUID()
      const shown = randomUUID()
      await insertProduct("123", hidden, true, { hiddenAt })
      await insertProduct("123", shown)
      const liveAt = future()
      expect(await schedule([hidden, shown], liveAt)).toMatchObject({
        status: "saved",
        entries: expect.arrayContaining([
          expect.objectContaining({ productId: hidden, liveAt }),
          expect.objectContaining({ productId: shown, liveAt }),
        ]),
      })
      expect((await visibility(hidden)).reveal_at.toISOString()).toBe(liveAt)
      expect((await visibility(shown)).reveal_at).toBeNull()
      expect(await first.readProduct(hidden)).toBeNull()
      expect(await first.readProduct(shown)).not.toBeNull()
      expect((await first.readRevealableProduct(hidden))?.revealAt).toBe(liveAt)
      expect(await first.productSchedule.remove(hidden)).toMatchObject({
        outcome: "removed",
        entries: [],
        products: [{ productId: hidden, hiddenAt, revealAt: null }],
      })
      expect(await first.productSchedule.remove(shown)).toMatchObject({
        outcome: "removed",
        entries: [],
        products: [{ productId: shown, hiddenAt: null, revealAt: null }],
      })
      expect(await first.productSchedule.remove(hidden)).toMatchObject({ outcome: "unscheduled", entries: [] })
      expect(await first.readProduct(hidden)).toBeNull()
      expect((await visibility(hidden)).reveal_at).toBeNull()
      expect(await first.readProduct(shown)).not.toBeNull()
    })

    it("refuses an unpublished or incomplete member without partially scheduling the batch", async () => {
      const ready = randomUUID()
      const incomplete = randomUUID()
      const unpublished = randomUUID()
      await insertProduct("123", ready, true, { hiddenAt })
      await insertProduct("123", incomplete, true, { hiddenAt, blueprintId: null })
      await insertProduct("123", unpublished, false)
      expect(await schedule([ready, incomplete])).toEqual({ status: "garment-incomplete", productIds: [incomplete] })
      expect(await schedule([ready, unpublished])).toEqual({ status: "missing", productIds: [unpublished] })
      expect((await visibility(ready)).reveal_at).toBeNull()
      expect((await first.productSchedule.list()).some((entry) => entry.productId === ready)).toBe(false)
    })

    it("refuses the whole batch when a garment becomes incomplete while scheduling waits for its lock", async () => {
      const ready = randomUUID()
      const racing = randomUUID()
      await seedCompleteGarment(pool, "123", 9006)
      await insertProduct("123", ready, true, { hiddenAt })
      await insertProduct("123", racing, true, { hiddenAt, blueprintId: 9006 })
      const editor = await pool.connect()
      let pending: ReturnType<typeof schedule> | undefined
      try {
        await editor.query("begin")
        await editor.query(
          "select complete from commerce.garment_models where shop_id='123' and blueprint_id=9006 for update"
        )
        pending = schedule([ready, racing])
        await vi.waitFor(async () => {
          const waiting = await pool.query(
            "select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%blueprint_id=any($2::int[])%for share'"
          )
          expect(waiting.rows.length).toBeGreaterThan(0)
        })
        await editor.query(
          "update commerce.garment_models set category_slug=null where shop_id='123' and blueprint_id=9006"
        )
        await editor.query("commit")
        expect(await pending).toEqual({ status: "garment-incomplete", productIds: [racing] })
        expect((await visibility(ready)).reveal_at).toBeNull()
        expect((await visibility(racing)).reveal_at).toBeNull()
        expect(
          (await first.productSchedule.list()).filter((entry) => [ready, racing].includes(entry.productId))
        ).toEqual([])
      } finally {
        await editor.query("rollback").catch(() => undefined)
        editor.release()
        await pending
      }
    })

    it("moves one upcoming assignment and answers a retry with the same entry", async () => {
      const id = randomUUID()
      await insertProduct("123", id, true, { hiddenAt })
      await schedule([id])
      const liveAt = later()
      const moved = await schedule([id], liveAt)
      expect(moved.status).toBe("saved")
      const retried = await schedule([id], liveAt)
      expect(retried.status).toBe("saved")
      if (moved.status !== "saved" || retried.status !== "saved") throw new Error("Expected the saved schedule")
      expect(retried.entries).toEqual(moved.entries)
      expect(retried.products).toEqual(moved.products)
      expect(retried.now).toBeGreaterThanOrEqual(moved.now)
      expect((await first.productSchedule.list()).filter((entry) => entry.productId === id)).toEqual(
        moved.status === "saved" ? moved.entries : []
      )
      expect((await visibility(id)).reveal_at.toISOString()).toBe(liveAt)
    })

    it("serializes concurrent moves so membership and the reveal always agree", async () => {
      const id = randomUUID()
      await insertProduct("123", id, true, { hiddenAt })
      const dates = [future(), later()]
      const results = await Promise.all([
        schedule([id], dates[0]),
        second.productSchedule.schedule({ productIds: [id], liveAt: dates[1]!, featuredBy }),
      ])
      expect(results.every((result) => result.status === "saved")).toBe(true)
      const entries = (await first.productSchedule.list()).filter((entry) => entry.productId === id)
      expect(entries).toHaveLength(1)
      expect((await visibility(id)).reveal_at.toISOString()).toBe(entries[0]!.liveAt)
    })

    it("keeps future membership when shown immediately, and restores its reveal when hidden again", async () => {
      const id = randomUUID()
      await insertProduct("123", id, true, { hiddenAt })
      const liveAt = future()
      await schedule([id], liveAt)
      expect(await first.setProductHidden(id, false)).toMatchObject({ status: "saved" })
      expect(await first.readProduct(id)).not.toBeNull()
      expect((await first.productSchedule.list()).find((entry) => entry.productId === id)?.liveAt).toBe(liveAt)
      expect(await first.setProductHidden(id, true)).toMatchObject({ status: "saved" })
      expect(await first.readProduct(id)).toBeNull()
      expect((await visibility(id)).reveal_at.toISOString()).toBe(liveAt)
      await first.productSchedule.remove(id)
      expect((await visibility(id)).reveal_at).toBeNull()
      expect(await first.readProduct(id)).toBeNull()
    })

    it("hides a queued product on an incomplete garment without creating an unsafe reveal", async () => {
      const id = randomUUID()
      await insertProduct("123", id, true, { blueprintId: null })
      const liveAt = future()
      expect(await schedule([id], liveAt)).toMatchObject({ status: "saved" })
      const result = await first.setProductHidden(id, true)
      expect(result).toMatchObject({ status: "saved", revealAt: null })
      expect(await first.readProduct(id)).toBeNull()
      expect((await first.productSchedule.list()).find((entry) => entry.productId === id)?.liveAt).toBe(liveAt)
      // Completing setup does not silently turn the preserved assignment into a reveal.
      await pool.query(
        "update commerce.printify_products set snapshot=jsonb_set(snapshot,'{blueprint_id}','1317') where shop_id='123' and product_id=$1",
        [id]
      )
      expect((await visibility(id)).reveal_at).toBeNull()
      expect(await schedule([id], liveAt)).toMatchObject({ status: "saved" })
      expect((await visibility(id)).reveal_at.toISOString()).toBe(liveAt)
    })

    it("hides a queued product before a concurrent garment editor releases its row lock", async () => {
      const id = randomUUID()
      const liveAt = future()
      await insertProduct("123", id)
      expect(await schedule([id], liveAt)).toMatchObject({ status: "saved" })
      const editor = await pool.connect()
      let hiding: ReturnType<PostgresPublishingStore["setProductHidden"]> | undefined
      let deadline: ReturnType<typeof setTimeout> | undefined
      try {
        await editor.query("begin")
        await editor.query(
          "select blueprint_id from commerce.garment_models where shop_id='123' and blueprint_id=1317 for update"
        )
        hiding = first.setProductHidden(id, true)
        const result = await Promise.race([
          hiding,
          new Promise<never>((_resolve, reject) => {
            deadline = setTimeout(() => reject(new Error("Hide waited for the garment editor's row lock")), 2000)
          }),
        ])
        // These reads happen while the editor still owns FOR UPDATE: Hide has already committed.
        expect(result).toMatchObject({ status: "saved", hiddenAt: expect.any(String), revealAt: null })
        expect(await first.readProduct(id)).toBeNull()
        expect((await first.productSchedule.list()).find((entry) => entry.productId === id)?.liveAt).toBe(liveAt)
        await editor.query("rollback")
        // Once the complete garment is available, an explicit reschedule safely restores the reveal.
        expect(await schedule([id], liveAt)).toMatchObject({ status: "saved" })
        expect((await visibility(id)).reveal_at.toISOString()).toBe(liveAt)
      } finally {
        if (deadline !== undefined) clearTimeout(deadline)
        await editor.query("rollback").catch(() => undefined)
        editor.release()
        await hiding
      }
    })

    it("keeps a clock-revealed product selling after its feature ends or its next feature is removed", async () => {
      const id = randomUUID()
      const past = new Date(Date.now() - 60_000).toISOString()
      await insertProduct("123", id, true, { hiddenAt, revealAt: past })
      await pool.query(
        "insert into commerce.product_week_schedule(shop_id,product_id,live_at,featured_by) values ('123',$1,$2,$3)",
        [id, past, featuredBy]
      )
      expect(await first.readProduct(id)).not.toBeNull()
      await schedule([id])
      await first.productSchedule.remove(id)
      expect((await visibility(id)).reveal_at.toISOString()).toBe(past)
      expect(await first.readProduct(id)).not.toBeNull()
      expect((await first.productSchedule.list()).filter((entry) => entry.productId === id)).toHaveLength(1)
      expect(await first.setProductHidden(id, true)).toMatchObject({ status: "saved" })
      expect(await first.readProduct(id)).toBeNull()
    })

    it("rejects a past deadline without changing visibility", async () => {
      const id = randomUUID()
      await insertProduct("123", id, true, { hiddenAt })
      expect(await schedule([id], new Date(Date.now() - 1000).toISOString())).toEqual({
        status: "past",
        productIds: [id],
      })
      expect((await visibility(id)).reveal_at).toBeNull()
    })

    it("normalizes caller precision and removes a matching reveal without losing microseconds", async () => {
      const id = randomUUID()
      await insertProduct("123", id, true, { hiddenAt })
      const liveAt = future()
      const precise = liveAt.replace("Z", "123Z")
      expect(await schedule([id], precise)).toMatchObject({
        status: "saved",
        entries: [expect.objectContaining({ liveAt })],
      })
      // Postgres timestamps can retain more precision than JS Date. Removal matches timestamps in SQL.
      await pool.query(
        "update commerce.product_week_schedule set live_at=$2 where shop_id='123' and product_id=$1 and ended_at is null",
        [id, precise]
      )
      await pool.query("update commerce.printify_products set reveal_at=$2 where shop_id='123' and product_id=$1", [
        id,
        precise,
      ])
      await first.productSchedule.remove(id)
      expect((await visibility(id)).reveal_at).toBeNull()
      expect(await first.readProduct(id)).toBeNull()
    })

    it.each(["move", "remove"])(
      "does not withdraw an arrived reveal when a %s waits across its deadline",
      async (operation) => {
        const id = randomUUID()
        const blocker = await pool.connect()
        let pending: Promise<unknown> | undefined
        try {
          await insertProduct("123", id, true, { hiddenAt })
          await blocker.query("begin")
          const due = (
            await blocker.query<{ reveal_at: Date }>(
              "update commerce.printify_products set reveal_at=clock_timestamp()+interval '200 milliseconds' where shop_id='123' and product_id=$1 returning reveal_at",
              [id]
            )
          ).rows[0]!.reveal_at.toISOString()
          await blocker.query(
            "insert into commerce.product_week_schedule(shop_id,product_id,live_at,featured_by) values ('123',$1,$2,$3)",
            [id, due, featuredBy]
          )
          // Publish the schedule, then hold its product while the mutation takes its own transaction snapshot.
          await blocker.query("commit")
          await blocker.query("begin")
          await blocker.query(
            "select product_id from commerce.printify_products where shop_id='123' and product_id=$1 for update",
            [id]
          )
          pending = operation === "move" ? schedule([id], later()) : first.productSchedule.remove(id)
          let waiting = false
          for (let attempt = 0; attempt < 100; attempt++) {
            const activity = await pool.query(
              "select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select product_id from commerce.printify_products%'"
            )
            if (activity.rows.length) {
              waiting = true
              break
            }
            await new Promise((resolve) => setTimeout(resolve, 5))
          }
          expect(waiting).toBe(true)
          await blocker.query(
            "select pg_sleep(greatest(0,extract(epoch from ($1::timestamptz-clock_timestamp())))+0.02)",
            [due]
          )
          await blocker.query("commit")
          const receipt = await pending
          expect(receipt).toMatchObject({
            now: expect.any(Number),
            entries: expect.arrayContaining([expect.objectContaining({ productId: id, liveAt: due })]),
            products: [expect.objectContaining({ productId: id, hiddenAt, revealAt: due })],
            ...(operation === "remove" ? { outcome: "current" } : { status: "saved" }),
          })
          expect(await first.readProduct(id)).not.toBeNull()
          expect((await visibility(id)).reveal_at.toISOString()).toBe(due)
          expect(
            (await first.productSchedule.list()).filter((entry) => entry.productId === id).map((entry) => entry.liveAt)
          ).toContain(due)
        } finally {
          await blocker.query("rollback").catch(() => undefined)
          blocker.release()
          await pending
        }
      }
    )

    it("grants the runtime role policy-backed reads and writes while denying browser roles", async () => {
      const client = await pool.connect()
      try {
        await client.query("begin")
        for (const role of ["anon", "authenticated"])
          expect(
            (
              await client.query(
                "select has_table_privilege($1,'commerce.product_week_schedule','select,insert,update,delete') as allowed",
                [role]
              )
            ).rows[0].allowed
          ).toBe(false)
        await client.query("set local role store_app_runtime")
        expect(
          (await client.query("select count(*)::int as count from commerce.product_week_schedule")).rows[0].count
        ).toBeGreaterThanOrEqual(0)
        const id = randomUUID()
        await client.query("reset role")
        await client.query("insert into commerce.printify_products(shop_id,product_id) values ('123',$1)", [id])
        await client.query("set local role store_app_runtime")
        const saved = await client.query(
          "insert into commerce.product_week_schedule(shop_id,product_id,live_at,featured_by) values ('123',$1,$2,$3) returning id",
          [id, future(), featuredBy]
        )
        expect(saved.rowCount).toBe(1)
        expect(
          (
            await client.query("update commerce.product_week_schedule set ended_at=now() where id=$1 returning id", [
              saved.rows[0].id,
            ])
          ).rowCount
        ).toBe(1)
        expect(
          (
            await client.query(
              "select has_table_privilege(current_user,'commerce.product_week_schedule','delete') as allowed"
            )
          ).rows[0].allowed
        ).toBe(false)
      } finally {
        await client.query("rollback").catch(() => undefined)
        client.release()
      }
    })
  })

  it("enforces private tables and row security", async () => {
    const rows = (
      await pool.query(
        "select c.relname,c.relrowsecurity,has_schema_privilege('public',n.oid,'usage') as public_usage from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='commerce' and c.relkind='r'"
      )
    ).rows
    // Named rather than counted, so adding a commerce table is a deliberate act that says which one.
    expect(rows.map((row) => row.relname).toSorted()).toEqual([
      "catalog_refreshes",
      "checkout_capacity",
      "checkout_orders",
      "design_product_artwork",
      "drop_email_deliveries",
      "drop_emails",
      "drop_signup_confirmation_budget",
      "drop_signup_confirmations",
      "drop_subscribers",
      "garment_models",
      "order_shipping_alerts",
      "printify_product_revisions",
      "printify_products",
      "printify_publish_jobs",
      "product_galleries",
      "product_gallery_assets",
      "product_gallery_promotions",
      "product_gallery_revisions",
      "product_week_schedule",
      "public_request_attempts",
      "published_image_uploads",
      "shop_categories",
      "store_identity",
      "weekly_hero_assets",
      "weekly_heroes",
    ])
    expect(rows.every((row) => row.relrowsecurity && !row.public_usage)).toBe(true)
  })

  it("grants product galleries append-only runtime access scoped to known products", async () => {
    const tables = [
      "product_gallery_assets",
      "product_galleries",
      "product_gallery_revisions",
      "product_gallery_promotions",
    ]
    const allowed = async (role: string, table: string, privilege: string) =>
      (await pool.query("select has_table_privilege($1,$2,$3) as allowed", [role, `commerce.${table}`, privilege]))
        .rows[0].allowed
    for (const table of tables) {
      for (const role of ["anon", "authenticated"])
        expect(await allowed(role, table, "select,insert,update,delete")).toBe(false)
      expect(await allowed("store_app_runtime", table, "select")).toBe(true)
      expect(await allowed("store_app_runtime", table, "insert")).toBe(true)
      expect(await allowed("store_app_runtime", table, "update")).toBe(table === "product_galleries")
      expect(await allowed("store_app_runtime", table, "delete")).toBe(false)
    }

    const productId = randomUUID()
    const assetId = randomUUID()
    const actor = randomUUID()
    const sha256 = "c".repeat(64)
    const manifest = JSON.stringify({ version: 1 })
    const client = await pool.connect()
    const asset = (product: string, id: string) =>
      client.query(
        `insert into commerce.product_gallery_assets(id,shop_id,product_id,pathname,sha256,content_type,bytes,width,height,created_by)
         values ($1,'123',$2,$3,$4,'image/jpeg',100,1200,1500,$5)`,
        [id, product, `product-galleries/v1/${id}.jpg`, sha256, actor]
      )
    const rejected = async (statement: () => Promise<unknown>, message: string) => {
      await client.query("savepoint attempt")
      await expect(statement()).rejects.toThrow(message)
      await client.query("rollback to savepoint attempt")
    }
    try {
      await client.query("begin")
      await client.query("insert into commerce.printify_products(shop_id,product_id) values ('123',$1)", [productId])
      // The owner role still meets the foreign key, so an unknown product is refused below the policies too.
      await rejected(() => asset(randomUUID(), randomUUID()), "foreign key")
      await client.query("set local role store_app_runtime")
      await rejected(() => asset(randomUUID(), randomUUID()), "row-level security")
      await asset(productId, assetId)
      await client.query(
        "insert into commerce.product_galleries(shop_id,product_id,revision,draft_manifest,updated_by) values ('123',$1,$2,$3,$4)",
        [productId, randomUUID(), manifest, actor]
      )
      await client.query(
        "insert into commerce.product_gallery_revisions(shop_id,product_id,revision,action,manifest,created_by) values ('123',$1,$2,'save',$3,$4)",
        [productId, randomUUID(), manifest, actor]
      )
      await client.query(
        "insert into commerce.product_gallery_promotions(shop_id,product_id,asset_id,host,url,sha256) values ('123',$1,$2,'store.example',$3,$4)",
        [productId, assetId, `https://store.example/published-product-photos/v1/${sha256}.jpg`, sha256]
      )
      await rejected(
        () =>
          client.query(
            "insert into commerce.product_gallery_promotions(shop_id,product_id,asset_id,host,url,sha256) values ('123',$1,$2,'store.example',$3,$4)",
            [productId, randomUUID(), `https://store.example/published-product-photos/v1/${sha256}.jpg`, sha256]
          ),
        "foreign key"
      )
      expect(
        (
          await client.query(
            "update commerce.product_galleries set active_manifest=draft_manifest where product_id=$1 returning product_id",
            [productId]
          )
        ).rowCount
      ).toBe(1)
      await rejected(
        () =>
          client.query("update commerce.product_gallery_revisions set action='restore' where product_id=$1", [
            productId,
          ]),
        "permission denied"
      )
      await rejected(
        () => client.query("delete from commerce.product_galleries where product_id=$1", [productId]),
        "permission denied"
      )
      for (const table of tables)
        expect(
          (await client.query(`select count(*)::int as count from commerce.${table} where product_id=$1`, [productId]))
            .rows[0].count
        ).toBe(1)
    } finally {
      await client.query("rollback").catch(() => undefined)
      client.release()
    }
  })

  it("removes an unpublished product even when Printify is unavailable", async () => {
    const { event, product } = publishingFixture()
    await first.enqueue(event)
    await processPublishingJobs(
      {
        store: first,
        client: { request: vi.fn(async () => product) },
        siteUrl: "https://example.com",
        invalidate: vi.fn(),
        hostImages: identityImages,
      },
      25
    )
    const deletion = {
      ...event,
      id: randomUUID(),
      action: "delete" as const,
      createdAt: new Date(Date.now() + 1000).toISOString(),
    }
    await first.enqueue(deletion)
    await processPublishingJobs(
      {
        store: first,
        client: {
          request: vi.fn(async () => {
            throw new Error("offline")
          }),
        },
        siteUrl: "https://example.com",
        invalidate: vi.fn(),
        hostImages: identityImages,
      },
      25
    )
    expect(await second.readProduct(event.productId)).toBeNull()
    expect(
      (await pool.query("select state,outcome from commerce.printify_publish_jobs where event_id=$1", [deletion.id]))
        .rows[0]
    ).toMatchObject({ state: "callback", outcome: "unpublished" })
  })
})

function publishingFixture() {
  const productId = randomUUID()
  const event: PublishingEvent = {
    id: randomUUID(),
    productId,
    shopId: "123",
    createdAt: new Date().toISOString(),
    action: "create",
    publishDetails: { title: true, description: true, images: true, variants: true },
  }
  const product = {
    id: productId,
    shop_id: 123,
    title: "Toast",
    description: "Good company",
    is_locked: true,
    visible: true,
    blueprint_id: 1317,
    print_provider_id: 99,
    created_at: "2026-09-01T12:00:00Z",
    print_areas: [
      {
        variant_ids: [101, 102],
        placeholders: [
          { position: "front", images: [{ id: "art-v1", imageId: "volatile-a", x: 0.5, y: 0.5, scale: 1, angle: 0 }] },
        ],
      },
    ],
    variants: [
      { id: 101, sku: "green-m", price: 3000, is_enabled: true, is_available: true, options: [1, 3] },
      { id: 102, sku: "grey-m", price: 3200, is_enabled: true, is_available: true, options: [2, 3] },
    ],
    options: [
      {
        name: "Colors",
        type: "color",
        values: [
          { id: 1, title: "Forest", colors: ["#254b41"] },
          { id: 2, title: "Grey", colors: ["#888888"] },
        ],
      },
      { name: "Sizes", type: "size", values: [{ id: 3, title: "M" }] },
    ],
    images: [
      { src: "https://images.printify.com/grey.png", variant_ids: [102], is_default: false },
      { src: "https://images.printify.com/forest.png", variant_ids: [101], is_default: true },
    ],
  }
  return { event, product }
}

async function identityImages({ snapshot }: { snapshot: Record<string, unknown> }) {
  return { snapshot, complete: true }
}

function googleCopyFor(snapshot: ReturnType<typeof publishingFixture>["product"]) {
  const product = normalizeCatalogProduct(snapshot)
  const production = parsePrintifyProduct(snapshot, { productId: snapshot.id, shopId: "123" })!
  return {
    version: 1 as const,
    origin: "generated" as const,
    content: "A geometric graphic T-shirt.",
    shared_facts_hash: googleCopySharedFactsHash(product, {
      googleProductCategory: 212,
      gender: "unisex",
      ageGroup: "adult",
      sizeSystem: "US",
    }),
    reviewed_variants: product.variants.map((v) => ({
      id: v.id,
      fingerprint: production.variants.find((p) => p.id === v.id)!.fingerprint,
      label: production.variants.find((p) => p.id === v.id)!.label,
      color: v.color!,
      size: v.size!,
    })),
  }
}

function parseGoogleCopyCliResult(stdout: string) {
  return JSON.parse(stdout) as {
    newRevision: string
    results: { productId: string; revision: string; code?: string }[]
  }
}
