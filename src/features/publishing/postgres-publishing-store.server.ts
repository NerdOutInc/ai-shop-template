import "server-only"

import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"

import type { PoolClient } from "pg"

import { readGoogleCopyProvenance } from "@/features/merchant-feed/read-google-copy-provenance.server"
import { validateGoogleCopyApproval } from "@/features/merchant-feed/validate-google-copy-approval"
import { WeeklyHeroStore } from "@/features/weekly-heroes/weekly-hero-store.server"
import { createPostgresPool } from "@/lib/create-postgres-pool.server"

import { PostgresGarmentStore } from "./postgres-garment-store.server"
import { PostgresProductScheduleStore } from "./postgres-product-schedule-store.server"
import { productVisibilitySql } from "./product-visibility-sql"
import { publishedArtworkSchema } from "./published-artwork-schema"
import type { PublishingEvent } from "./publishing-event"
import type { PublishingHealthSnapshot } from "./publishing-health"
import type { PublishingJob, PublishingRecord, PublishingStore } from "./publishing-store"

// node-postgres parses timestamptz into a Date, and unstable_cache JSON-serializes whatever it is
// handed. Normalizing here keeps the shape identical on both sides of the cache, so one comparator
// works at every seam instead of a declared string type quietly holding a Date.
function isoOrNull(value: Date | null) {
  return value === null ? null : value.toISOString()
}

export class PostgresPublishingStore implements PublishingStore {
  private readonly pool
  private readonly workerPool
  private workerBusy = false
  /**
   * Categories and garment setup. Its own class so this one does not grow by another third, but
   * built on this store's request pool and shop: no extra pool, and the garment gate in
   * setProductHidden and product scheduling meet its editor on row locks in the same database.
   */
  readonly garments: PostgresGarmentStore
  readonly productSchedule: PostgresProductScheduleStore
  readonly weeklyHeroes: WeeklyHeroStore

  constructor(
    connectionString: string,
    private readonly shopId: string
  ) {
    if (!/^[1-9]\d*$/.test(shopId)) throw new Error("A Printify shop is required")
    // Keep the same three-connection budget, reserving intake capacity during provider I/O.
    this.pool = createPostgresPool(connectionString, 2)
    this.workerPool = createPostgresPool(connectionString, 1)
    this.garments = new PostgresGarmentStore(this.pool, shopId)
    this.productSchedule = new PostgresProductScheduleStore(this.pool, shopId)
    this.weeklyHeroes = new WeeklyHeroStore(this.pool, shopId)
  }

  async enqueue(event: PublishingEvent) {
    if (event.shopId !== this.shopId) throw new Error("Publishing shop mismatch")
    const existing = await this.pool.query<{ matches: boolean }>(
      "select event = $2::jsonb as matches from commerce.printify_publish_jobs where event_id=$1",
      [event.id, JSON.stringify(event)]
    )
    if (existing.rows.length) {
      if (!existing.rows[0]?.matches) throw new Error("Conflicting publishing event identity")
      return
    }
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      await client.query(
        "insert into commerce.printify_products (shop_id, product_id) values ($1,$2) on conflict do nothing",
        [this.shopId, event.productId]
      )
      // Intake competes only with short database changes, never the worker's network calls.
      await client.query(
        "select product_id from commerce.printify_products where shop_id=$1 and product_id=$2 for update",
        [this.shopId, event.productId]
      )
      await client.query(
        "insert into commerce.printify_publish_jobs (event_id,shop_id,product_id,event_created_at,event) values ($1,$2,$3,$4,$5::jsonb) on conflict (event_id) do nothing",
        [event.id, this.shopId, event.productId, event.createdAt, JSON.stringify(event)]
      )
      const saved = await client.query<{ matches: boolean }>(
        "select event = $2::jsonb as matches from commerce.printify_publish_jobs where event_id=$1",
        [event.id, JSON.stringify(event)]
      )
      if (!saved.rows[0]?.matches) throw new Error("Conflicting publishing event identity")
      await client.query("commit")
    } catch (error) {
      await client.query("rollback")
      throw error
    } finally {
      client.release()
    }
  }

  private async currentEvent(client: PoolClient, productId: string, event: PublishingEvent) {
    const rows = (
      await client.query<{ event_id: string; event_created_at: Date }>(
        "select event_id,event_created_at from commerce.printify_publish_jobs where shop_id=$1 and product_id=$2 and event_created_at >= $3 and event_id <> $4",
        [this.shopId, productId, event.createdAt, event.id]
      )
    ).rows
    if (rows.some((row) => row.event_created_at.getTime() > new Date(event.createdAt).getTime()))
      return "superseded" as const
    return rows.length ? ("ambiguous" as const) : ("current" as const)
  }

  private async mutateCurrent(
    client: PoolClient,
    productId: string,
    event: PublishingEvent,
    mutation: () => Promise<void>
  ) {
    await client.query("begin")
    try {
      await client.query(
        "select product_id from commerce.printify_products where shop_id=$1 and product_id=$2 for update",
        [this.shopId, productId]
      )
      // Recheck under the same row lock as intake, closing the read/commit ordering race.
      const current = await this.currentEvent(client, productId, event)
      if (current === "current") await mutation()
      else
        await client.query(
          "update commerce.printify_publish_jobs set state=$4,failure_code=$5,updated_at=now() where shop_id=$1 and product_id=$2 and event_id=$3",
          [
            this.shopId,
            productId,
            event.id,
            current === "superseded" ? "superseded" : "attention",
            current === "ambiguous" ? "EVENT_ORDER_AMBIGUOUS" : null,
          ]
        )
      await client.query("commit")
      return current === "current"
    } catch (error) {
      await client.query("rollback")
      throw error
    }
  }

  async listPending(limit: number) {
    const result = await this.pool.query<{ event_id: string; product_id: string }>(
      "select event_id,product_id from commerce.printify_publish_jobs where shop_id=$1 and state in ('pending','callback') and next_attempt_at <= now() order by next_attempt_at,event_created_at limit $2",
      [this.shopId, Math.max(1, Math.min(25, limit))]
    )
    return result.rows.map((row) => ({ eventId: row.event_id, productId: row.product_id }))
  }

  async readHealth(): Promise<PublishingHealthSnapshot> {
    const client = await this.pool.connect()
    let destroy = false
    try {
      await client.query("begin read only")
      await client.query("set local statement_timeout = '5s'")
      const row = (
        await client.query<{
          active_products: number
          attention_jobs: number
          overdue_jobs: number
          product_ids: string[]
          open_job_product_ids: string[]
          open_job_product_count: number
          failed_publications: number
        }>(
          `select
            (select count(*)::int from commerce.printify_products where shop_id=$1 and active) as active_products,
            count(*) filter (where state='attention')::int as attention_jobs,
            count(*) filter (where state in ('pending','callback') and next_attempt_at < now()-interval '10 minutes')::int as overdue_jobs,
            array(select product_id from commerce.printify_products where shop_id=$1 and active order by sort_position,product_id limit 100) as product_ids,
            array(select distinct product_id from commerce.printify_publish_jobs where shop_id=$1 and state in ('pending','callback','attention') order by product_id limit 500) as open_job_product_ids,
            count(distinct product_id)::int as open_job_product_count,
            (select count(*)::int from commerce.printify_publish_jobs failed
              where failed.shop_id=$1 and failed.state='complete' and failed.outcome='failed'
              and not exists (select 1 from commerce.printify_publish_jobs newer
                where newer.shop_id=failed.shop_id and newer.product_id=failed.product_id
                and newer.event_created_at > failed.event_created_at)) as failed_publications
          from commerce.printify_publish_jobs where shop_id=$1 and state in ('pending','callback','attention')`,
          [this.shopId]
        )
      ).rows[0]
      if (!row) throw new Error("Publishing health is unavailable")
      await client.query("commit")
      return {
        activeProducts: row.active_products,
        attentionJobs: row.attention_jobs,
        overdueJobs: row.overdue_jobs,
        productIds: row.product_ids,
        openJobProductIds: row.open_job_product_ids,
        openJobProductCount: row.open_job_product_count,
        failedPublications: row.failed_publications,
      }
    } catch (error) {
      try {
        await client.query("rollback")
      } catch {
        destroy = true
      }
      throw error
    } finally {
      client.release(destroy)
    }
  }

  async withProductLock<T>(productId: string, callback: (record: PublishingRecord) => Promise<T>): Promise<T | null> {
    // Admission must be synchronous: overlapping runs should skip, not queue behind provider I/O.
    if (this.workerBusy) return null
    this.workerBusy = true
    let client: PoolClient | undefined
    const key = `printify-publish:${this.shopId}:${productId}`
    let acquired = false
    let destroy = false
    try {
      client = await this.workerPool.connect()
      try {
        acquired =
          (
            await client.query<{ acquired: boolean }>(
              "select pg_try_advisory_lock(hashtextextended($1,0)) as acquired",
              [key]
            )
          ).rows[0]?.acquired === true
      } catch (error) {
        // A lost acquisition response can still leave a session lock held on the server.
        destroy = true
        throw error
      }
      if (!acquired) return null
      return await callback(this.record(client, productId))
    } finally {
      try {
        if (client) {
          if (acquired) {
            try {
              await client.query("select pg_advisory_unlock(hashtextextended($1,0))", [key])
            } catch {
              destroy = true
            }
          }
          client.release(destroy)
        }
      } finally {
        this.workerBusy = false
      }
    }
  }

  async updateGoogleMerchantCopy(
    productId: string,
    expectedRevision: string,
    approvedCopy: unknown | null
  ): Promise<{ newRevision: string } | null> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(productId) || !/^[1-9]\d*$/.test(expectedRevision))
      throw new Error("GOOGLE_COPY_INVALID_TARGET")
    const client = await this.pool.connect()
    const scope = [this.shopId, productId]
    try {
      await client.query("begin")
      const target = (
        await client.query<{ revision: string; snapshot: Record<string, unknown>; active: boolean }>(
          "select revision,snapshot,active from commerce.printify_products where shop_id=$1 and product_id=$2 for update",
          scope
        )
      ).rows[0]
      const pending =
        (
          await client.query(
            "select 1 from commerce.printify_publish_jobs where shop_id=$1 and product_id=$2 and state in ('pending','callback') limit 1",
            scope
          )
        ).rows.length > 0
      if (!target?.active || !target.snapshot || target.revision !== expectedRevision || pending) {
        await client.query("rollback")
        return null
      }
      let copy = null
      if (approvedCopy !== null) {
        const profiles = await this.garments.listFeedProfiles(client)
        const profile =
          typeof target.snapshot.blueprint_id === "number" ? profiles.get(target.snapshot.blueprint_id) : undefined
        if (!profile) throw new Error("GOOGLE_COPY_UNSUPPORTED_BLUEPRINT")
        const provenance = await readGoogleCopyProvenance(client, this.shopId, productId, target.revision)
        copy = validateGoogleCopyApproval(approvedCopy, target.snapshot, this.shopId, profile, provenance).copy
      }
      // Idempotent requests still pass the revision, job and approval guards above.
      if (
        copy === null
          ? !Object.hasOwn(target.snapshot, "google_merchant_copy")
          : isDeepStrictEqual(copy, target.snapshot.google_merchant_copy)
      ) {
        await client.query("commit")
        return { newRevision: target.revision }
      }
      const row = (
        await client.query<{ revision: string; snapshot: Record<string, unknown> }>(
          `update commerce.printify_products set snapshot=case when $4::jsonb is null
          then snapshot-'google_merchant_copy' else jsonb_set(snapshot,'{google_merchant_copy}',$4::jsonb) end,
          revision=revision+1,updated_at=now() where shop_id=$1 and product_id=$2 and revision=$3 returning revision,snapshot`,
          [...scope, expectedRevision, copy === null ? null : JSON.stringify(copy)]
        )
      ).rows[0]!
      await client.query(
        "insert into commerce.printify_product_revisions (shop_id,product_id,revision,event_id,snapshot) values ($1,$2,$3,null,$4::jsonb)",
        [...scope, row.revision, JSON.stringify(row.snapshot)]
      )
      await client.query("commit")
      return { newRevision: row.revision }
    } catch (error) {
      await client.query("rollback")
      throw error
    } finally {
      client.release()
    }
  }

  private record(client: PoolClient, productId: string): PublishingRecord {
    const scope = [this.shopId, productId]
    return {
      imageUploads: {
        read: async (key) =>
          (
            await client.query<{ url: string }>(
              "select url from commerce.published_image_uploads where shop_id=$1 and product_id=$2 and key_hash=$3",
              [...scope, createHash("sha256").update(key).digest("hex")]
            )
          ).rows[0]?.url ?? null,
        save: async (key, url) => {
          const saved = await client.query<{ url: string }>(
            `insert into commerce.published_image_uploads (shop_id,product_id,key_hash,url) values ($1,$2,$3,$4)
             on conflict (shop_id,product_id,key_hash) do update set url=excluded.url
             where published_image_uploads.url=excluded.url returning url`,
            [...scope, createHash("sha256").update(key).digest("hex"), url]
          )
          if (!saved.rows.length) throw new Error("Conflicting published image receipt")
        },
      },
      getJob: async (eventId) => {
        const row = (
          await client.query<{
            event: PublishingEvent
            state: PublishingJob["state"]
            attempts: number
            outcome: PublishingJob["outcome"]
            source_fingerprint: string | null
            callback_attempted: boolean
            failure_code: string | null
          }>("select * from commerce.printify_publish_jobs where shop_id=$1 and product_id=$2 and event_id=$3", [
            ...scope,
            eventId,
          ])
        ).rows[0]
        return row
          ? {
              event: row.event,
              state: row.state,
              attempts: row.attempts,
              outcome: row.outcome,
              sourceFingerprint: row.source_fingerprint,
              callbackAttempted: row.callback_attempted,
              failureCode: row.failure_code,
            }
          : null
      },
      isCurrent: (event) => this.currentEvent(client, productId, event),
      getProduct: async () =>
        (
          await client.query<{ snapshot: Record<string, unknown> | null }>(
            "select snapshot from commerce.printify_products where shop_id=$1 and product_id=$2",
            scope
          )
        ).rows[0]?.snapshot ?? null,
      getImageBackfill: async () =>
        (
          await client.query<{ revision: string; snapshot: Record<string, unknown> }>(
            `select revision,snapshot from commerce.printify_products product
             where shop_id=$1 and product_id=$2 and active
             and not exists (select 1 from commerce.printify_publish_jobs job
               where job.shop_id=product.shop_id and job.product_id=product.product_id
               and job.state in ('pending','callback'))`,
            scope
          )
        ).rows[0] ?? null,
      replaceProductImages: async (expectedRevision, images) => {
        if (!Array.isArray(images)) throw new Error("Published images must be an array")
        await client.query("begin")
        try {
          // Intake may arrive during uploads. Lock its product row before checking the saved revision and jobs.
          await client.query(
            "select product_id from commerce.printify_products where shop_id=$1 and product_id=$2 for update",
            scope
          )
          const updated = await client.query<{ revision: string; snapshot: Record<string, unknown> }>(
            `update commerce.printify_products product
             set snapshot=jsonb_set(snapshot,'{images}',$4::jsonb),revision=revision+1,updated_at=now()
             where shop_id=$1 and product_id=$2 and revision=$3 and active
             and not exists (select 1 from commerce.printify_publish_jobs job
               where job.shop_id=product.shop_id and job.product_id=product.product_id
               and job.state in ('pending','callback'))
             returning revision,snapshot`,
            [...scope, expectedRevision, JSON.stringify(images)]
          )
          const row = updated.rows[0]
          if (row)
            await client.query(
              "insert into commerce.printify_product_revisions (shop_id,product_id,revision,event_id,snapshot) values ($1,$2,$3,null,$4::jsonb)",
              [...scope, row.revision, JSON.stringify(row.snapshot)]
            )
          await client.query("commit")
          return row !== undefined
        } catch (error) {
          await client.query("rollback")
          throw error
        }
      },
      replaceProductArtwork: async (expectedRevision, artwork) => {
        const verifiedArtwork = publishedArtworkSchema.parse(artwork)
        await client.query("begin")
        try {
          // Intake can arrive while the derivative uploads; serialize the final check with intake.
          await client.query(
            "select product_id from commerce.printify_products where shop_id=$1 and product_id=$2 for update",
            scope
          )
          const updated = await client.query<{ revision: string; snapshot: Record<string, unknown> }>(
            `update commerce.printify_products product
             set snapshot=jsonb_set(jsonb_set(snapshot,'{storefront_artwork}',$4::jsonb),'{storefront_artwork_enabled}','true'::jsonb),
               revision=revision+1,updated_at=now()
             where shop_id=$1 and product_id=$2 and revision=$3 and active
             and not exists (select 1 from commerce.printify_publish_jobs job
               where job.shop_id=product.shop_id and job.product_id=product.product_id
               and job.state in ('pending','callback'))
             returning revision,snapshot`,
            [...scope, expectedRevision, JSON.stringify(verifiedArtwork)]
          )
          const row = updated.rows[0]
          if (row)
            await client.query(
              "insert into commerce.printify_product_revisions (shop_id,product_id,revision,event_id,snapshot) values ($1,$2,$3,null,$4::jsonb)",
              [...scope, row.revision, JSON.stringify(row.snapshot)]
            )
          await client.query("commit")
          return row !== undefined
        } catch (error) {
          await client.query("rollback")
          throw error
        }
      },
      activate: (event, snapshot, sourceFingerprint) =>
        this.mutateCurrent(client, productId, event, async () => {
          // Publication and its pending callback become durable together; callbacks never roll this back.
          const updated = await client.query<{ revision: string }>(
            "update commerce.printify_products set snapshot=$3::jsonb,active=$4,revision=revision+1,updated_at=now() where shop_id=$1 and product_id=$2 returning revision",
            [
              ...scope,
              snapshot === null ? null : JSON.stringify(snapshot),
              snapshot !== null && snapshot.visible !== false,
            ]
          )
          const revision = updated.rows[0]?.revision
          if (!revision) throw new Error("Publishing product missing")
          await client.query(
            "insert into commerce.printify_product_revisions (shop_id,product_id,revision,event_id,snapshot) values ($1,$2,$3,$4,$5::jsonb)",
            [...scope, revision, event.id, snapshot === null ? null : JSON.stringify(snapshot)]
          )
          await client.query(
            "update commerce.printify_publish_jobs set state='callback',outcome=$4,source_fingerprint=$5,attempts=0,failure_code=null,next_attempt_at=now(),updated_at=now() where shop_id=$1 and product_id=$2 and event_id=$3",
            [...scope, event.id, snapshot === null ? "unpublished" : "published", sourceFingerprint]
          )
        }),
      fail: (event, code, fingerprint) =>
        this.mutateCurrent(client, productId, event, async () => {
          await client.query(
            "update commerce.printify_publish_jobs set state='callback',outcome='failed',source_fingerprint=$5,failure_code=$4,attempts=0,next_attempt_at=now(),updated_at=now() where shop_id=$1 and product_id=$2 and event_id=$3",
            [...scope, event.id, code, fingerprint]
          )
        }),
      finish: async (eventId, state, code) => {
        await client.query(
          "update commerce.printify_publish_jobs set state=$4,failure_code=coalesce($5,failure_code),updated_at=now() where shop_id=$1 and product_id=$2 and event_id=$3",
          [...scope, eventId, state, code ?? null]
        )
      },
      retry: async (eventId, code, retryAfterSeconds = 0) => {
        await client.query(
          "update commerce.printify_publish_jobs set attempts=attempts+1, failure_code=$4,next_attempt_at=now()+least(3600,greatest($5,30*power(2,least(attempts,7))))*interval '1 second', updated_at=now() where shop_id=$1 and product_id=$2 and event_id=$3",
          [...scope, eventId, code, retryAfterSeconds]
        )
      },
      deferImages: async (eventId) => {
        await client.query(
          "update commerce.printify_publish_jobs set attempts=0,failure_code='IMAGE_COPY_PENDING',next_attempt_at=now()+interval '30 seconds',updated_at=now() where shop_id=$1 and product_id=$2 and event_id=$3 and state='pending'",
          [...scope, eventId]
        )
      },
      startCallback: (event) =>
        this.mutateCurrent(client, productId, event, async () => {
          await client.query(
            "update commerce.printify_publish_jobs set callback_attempted=true,updated_at=now() where shop_id=$1 and product_id=$2 and event_id=$3",
            [...scope, event.id]
          )
        }),
      rejectCallback: async (eventId) => {
        await client.query(
          "update commerce.printify_publish_jobs set callback_attempted=false,updated_at=now() where shop_id=$1 and product_id=$2 and event_id=$3",
          [...scope, eventId]
        )
      },
    }
  }

  /** Gated: every checkout quote resolves products through this. The display read is readRevealableProduct. */
  async readProduct(productId: string) {
    return (
      (
        await this.pool.query<{ snapshot: Record<string, unknown> }>(
          `select snapshot from commerce.printify_products
             where shop_id=$1 and product_id=$2 and ${productVisibilitySql.shown}`,
          [this.shopId, productId]
        )
      ).rows[0]?.snapshot ?? null
    )
  }

  /**
   * Ungated on purpose. The stock refresh, the image backfill and the publishing health check all
   * read every active product, because a hidden product still needs its stock observed, its
   * mockups on Blob and its snapshot validated BEFORE it reveals.
   */
  async listProducts() {
    return (
      await this.pool.query<{ snapshot: Record<string, unknown> }>(
        "select snapshot from commerce.printify_products where shop_id=$1 and active order by sort_position,product_id",
        [this.shopId]
      )
    ).rows.map((row) => row.snapshot)
  }

  /** Gated sibling of listProducts, for the merchant feeds. */
  async listShownProducts() {
    return (
      await this.pool.query<{ snapshot: Record<string, unknown> }>(
        `select snapshot from commerce.printify_products
           where shop_id=$1 and ${productVisibilitySql.shown} order by sort_position,product_id`,
        [this.shopId]
      )
    ).rows.map((row) => row.snapshot)
  }

  /** Ungated on purpose; see listProducts. */
  async listProductIds() {
    return (
      await this.pool.query<{ product_id: string }>(
        "select product_id from commerce.printify_products where shop_id=$1 and active order by sort_position,product_id",
        [this.shopId]
      )
    ).rows.map((row) => row.product_id)
  }

  /**
   * The cached storefront reads take these two. They apply the write-driven half of the gate in SQL
   * and hand back revealAt so the caller can finish it against a live clock outside the cache.
   */
  async readRevealableProduct(productId: string) {
    const row = (
      await this.pool.query<{
        snapshot: Record<string, unknown>
        reveal_at: Date | null
        added_to_shop_at: Date | null
      }>(
        `select snapshot,reveal_at,added_to_shop_at from commerce.printify_products
           where shop_id=$1 and product_id=$2 and ${productVisibilitySql.revealable}`,
        [this.shopId, productId]
      )
    ).rows[0]
    return row
      ? {
          snapshot: row.snapshot,
          revealAt: isoOrNull(row.reveal_at),
          addedToShopAt: isoOrNull(row.added_to_shop_at),
        }
      : null
  }

  async listRevealableProductIds() {
    return (
      await this.pool.query<{ product_id: string; reveal_at: Date | null }>(
        `select product_id,reveal_at from commerce.printify_products
           where shop_id=$1 and ${productVisibilitySql.revealable} order by sort_position,product_id`,
        [this.shopId]
      )
    ).rows.map((row) => ({ id: row.product_id, revealAt: isoOrNull(row.reveal_at) }))
  }

  /** Every active product with the owner's own decision attached, for the admin Products page. */
  async listAdminProducts() {
    return (
      await this.pool.query<{
        snapshot: Record<string, unknown>
        hidden_at: Date | null
        reveal_at: Date | null
        revealed_at: Date | null
        added_to_shop_at: Date | null
      }>(
        `select snapshot,hidden_at,reveal_at,revealed_at,added_to_shop_at from commerce.printify_products
           where shop_id=$1 and active order by sort_position,product_id`,
        [this.shopId]
      )
    ).rows.map((row) => ({
      snapshot: row.snapshot,
      hiddenAt: isoOrNull(row.hidden_at),
      revealAt: isoOrNull(row.reveal_at),
      revealedAt: isoOrNull(row.revealed_at),
      addedToShopAt: isoOrNull(row.added_to_shop_at),
    }))
  }

  async setProductHidden(
    productId: string,
    hidden: boolean
  ): Promise<
    | {
        status: "saved"
        hiddenAt: string | null
        revealAt: string | null
        revealedAt: string | null
        addedToShopAt: string | null
      }
    | "missing"
    | "garment-incomplete"
  > {
    // Hiding is idempotent: a second hide must not restart the "hidden since" clock. Showing clears
    // any pending reveal, and stamps the launch record once so the undo runbook can tell a product
    // that came off the wall from one that was never on it.
    //
    // added_to_shop_at is the other end of that: the LATEST arrival, which Newest sorts by. Only a
    // real hidden -> shown transition stamps it, judged by hiddenAtWrite against the statement's own
    // clock, so a double-click or a stale tab showing a product that is already up cannot make it the
    // newest tee in the shop. Hiding keeps it.
    //
    // A timed reveal writes nothing, so a product the clock put on the wall still carries its old
    // hidden_at and no launch record. Both branches settle that here, from the moment it actually
    // went live: hiding it is a fresh hide of a product shoppers have seen, not a second hide of one
    // they never did. Its arrival is settled the same way, because both branches overwrite the
    // reveal_at that readers were taking it from. SET expressions all read the row as it was before
    // this statement.
    //
    // Hiding never requires garment readiness or waits for its row lock. Restoring a future
    // feature's reveal is best effort: a busy or incomplete garment leaves the assignment intact
    // but the reveal empty. The owner can Show or reschedule when setup is ready.
    // Showing is gated on the garment, but only for a hidden -> shown TRANSITION. A product already
    // on the wall stays idempotent and ungated: refusing to "show" what shoppers can already buy
    // would protect nothing, and would turn a harmless double-click into an error.
    //
    // A transaction rather than `update ... where exists (complete garment)`. Under READ COMMITTED
    // that one statement and the garment editor's "is anything shown?" count can each read the
    // other's pre-commit world and both succeed, leaving a shown product on an incomplete garment.
    // Instead both sides meet on the garment ROW: `for share` when showing, `for update` there
    // (PostgresGarmentStore.saveGarment). If the editor got there first this waits, and the recheck
    // after the wait sees `complete` false and returns no row.
    //
    // LOCK ORDER, which the editor relies on: product row first, garment row second.
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      const product = (
        await client.query<{ blueprint_id: number | null; hidden_now: boolean }>(
          `select blueprint_id,(${productVisibilitySql.hiddenNow}) as hidden_now from commerce.printify_products
             where shop_id=$1 and product_id=$2 and active for update`,
          [this.shopId, productId]
        )
      ).rows[0]
      if (!product) {
        await client.query("rollback")
        return "missing"
      }
      if (hidden) {
        // Read the schedule after locking the product so a concurrent schedule that committed while
        // this waited is included when attempting to restore the reveal.
        const scheduled = (
          await client.query<{ live_at: Date | null }>(
            `select min(live_at) as live_at from commerce.product_week_schedule
               where shop_id=$1 and product_id=$2 and ended_at is null and live_at>clock_timestamp()`,
            [this.shopId, productId]
          )
        ).rows[0]?.live_at
        // Keep Hide and its optional reveal in one transaction. SKIP LOCKED makes a concurrent
        // garment editor harmless to the hide; a row we do obtain stays share-locked until commit,
        // so it cannot become incomplete between this check and restoring the pending reveal.
        const ready = scheduled
          ? await client.query(
              "select 1 from commerce.garment_models where shop_id=$1 and blueprint_id=$2 and complete for share skip locked",
              [this.shopId, product.blueprint_id]
            )
          : null
        const updated = await client.query<{
          hidden_at: Date | null
          reveal_at: Date | null
          revealed_at: Date | null
          added_to_shop_at: Date | null
        }>(
          `update commerce.printify_products set
             revealed_at=case when ${productVisibilitySql.revealedAtWrite} then coalesce(revealed_at,reveal_at) else revealed_at end,
             added_to_shop_at=case when ${productVisibilitySql.revealedAtWrite} then greatest(added_to_shop_at,reveal_at) else added_to_shop_at end,
             hidden_at=case when ${productVisibilitySql.hiddenAtWrite} then hidden_at else clock_timestamp() end,
             reveal_at=case when $3::boolean then (
               select min(live_at) from commerce.product_week_schedule
                where shop_id=$1 and product_id=$2 and ended_at is null and live_at>clock_timestamp()
             ) else null end,updated_at=now()
             where shop_id=$1 and product_id=$2 returning hidden_at,reveal_at,revealed_at,added_to_shop_at`,
          [this.shopId, productId, Boolean(ready?.rows.length)]
        )
        await client.query("commit")
        const row = updated.rows[0]!
        return {
          status: "saved",
          hiddenAt: isoOrNull(row.hidden_at),
          revealAt: isoOrNull(row.reveal_at),
          revealedAt: isoOrNull(row.revealed_at),
          addedToShopAt: isoOrNull(row.added_to_shop_at),
        }
      }
      if (product.hidden_now) {
        // No garment row, an incomplete one and a snapshot with no readable blueprint (null matches
        // nothing) are one answer. A row that does not exist cannot be locked, and need not be:
        // absence refuses, and garments are never deleted, so the only change is towards complete.
        const garment = await client.query(
          "select 1 from commerce.garment_models where shop_id=$1 and blueprint_id=$2 and complete for share",
          [this.shopId, product.blueprint_id]
        )
        if (!garment.rows.length) {
          await client.query("rollback")
          return "garment-incomplete"
        }
      }
      const updated = await client.query<{
        hidden_at: Date | null
        reveal_at: Date | null
        revealed_at: Date | null
        added_to_shop_at: Date | null
      }>(
        `update commerce.printify_products
             set hidden_at=null,reveal_at=null,revealed_at=coalesce(revealed_at,least(reveal_at,now())),
             added_to_shop_at=case
               when ${productVisibilitySql.hiddenAtWrite} then clock_timestamp()
               when ${productVisibilitySql.revealedAtWrite} then greatest(added_to_shop_at,reveal_at)
               else added_to_shop_at end,
             updated_at=now()
             where shop_id=$1 and product_id=$2 and active returning hidden_at,reveal_at,revealed_at,added_to_shop_at`,
        [this.shopId, productId]
      )
      await client.query("commit")
      const row = updated.rows[0]!
      return {
        status: "saved",
        hiddenAt: isoOrNull(row.hidden_at),
        revealAt: isoOrNull(row.reveal_at),
        revealedAt: isoOrNull(row.revealed_at),
        addedToShopAt: isoOrNull(row.added_to_shop_at),
      }
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async reorderProducts(productIds: readonly string[]): Promise<"saved" | "changed"> {
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      const rows = (
        await client.query<{ product_id: string; sort_position: string }>(
          "select product_id,sort_position from commerce.printify_products where shop_id=$1 and active order by product_id for update",
          [this.shopId]
        )
      ).rows
      const active = new Set(rows.map((row) => row.product_id))
      if (
        rows.length !== productIds.length ||
        new Set(productIds).size !== productIds.length ||
        productIds.some((id) => !active.has(id))
      ) {
        await client.query("rollback")
        return "changed"
      }
      // Hand the active rows' existing positions out in the new order. Unpublished rows keep their
      // slots, and intake's identity default still places a newly published product last. Sort after
      // locking: a row lock wait returns the concurrent save's positions in the pre-wait row order.
      const positions = rows
        .map((row) => BigInt(row.sort_position))
        .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map(String)
      await client.query(
        "update commerce.printify_products product set sort_position=ordered.sort_position from unnest($2::text[],$3::bigint[]) as ordered(product_id,sort_position) where product.shop_id=$1 and product.product_id=ordered.product_id",
        [this.shopId, productIds, positions]
      )
      await client.query("commit")
      return "saved"
    } catch (error) {
      await client.query("rollback")
      throw error
    } finally {
      client.release()
    }
  }

  async close() {
    await Promise.all([this.pool.end(), this.workerPool.end()])
  }
}
