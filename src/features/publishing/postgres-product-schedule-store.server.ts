import "server-only"

import type { Pool, PoolClient } from "pg"

import type { ProductScheduleEntry, ProductScheduleReceipt } from "./product-schedule-entry"
import { resolveProductWeek } from "./resolve-product-week"

import { productVisibilitySql } from "./product-visibility-sql"

type ScheduleRow = { id: string; product_id: string; live_at: Date }

function entry(row: ScheduleRow): ProductScheduleEntry {
  return { id: row.id, productId: row.product_id, liveAt: row.live_at.toISOString() }
}

/** Shares the publishing request pool and locks products before garments, like the visibility editor. */
export class PostgresProductScheduleStore {
  constructor(
    private readonly pool: Pool,
    private readonly shopId: string
  ) {}

  async list(): Promise<ProductScheduleEntry[]> {
    return this.listWith(this.pool)
  }

  private async listWith(client: Pool | PoolClient): Promise<ProductScheduleEntry[]> {
    const result = await client.query<ScheduleRow>(
      `select schedule.id,schedule.product_id,schedule.live_at
         from commerce.product_week_schedule schedule
         join commerce.printify_products product using (shop_id,product_id)
        where schedule.shop_id=$1 and schedule.ended_at is null and product.active
          and schedule.live_at>now()-interval '8 days'
        order by schedule.live_at,product.sort_position,product.product_id`,
      [this.shopId]
    )
    return result.rows.map(entry)
  }

  private async receipt(client: PoolClient, productIds: readonly string[]): Promise<ProductScheduleReceipt> {
    const clock = await client.query<{ now: Date }>("select clock_timestamp() as now")
    const now = clock.rows[0]!.now.getTime()
    const entries = await this.listWith(client)
    const current = resolveProductWeek(entries, now)
    const products = await client.query<{
      product_id: string
      hidden_at: Date | null
      reveal_at: Date | null
      revealed_at: Date | null
    }>(
      `select product_id,hidden_at,reveal_at,revealed_at from commerce.printify_products
         where shop_id=$1 and product_id=any($2::text[]) and active order by product_id`,
      [this.shopId, [...productIds]]
    )
    return {
      now,
      entries: entries.filter(
        (entry) =>
          productIds.includes(entry.productId) && (Date.parse(entry.liveAt) > now || entry.liveAt === current?.liveAt)
      ),
      products: products.rows.map((product) => ({
        productId: product.product_id,
        hiddenAt: product.hidden_at?.toISOString() ?? null,
        revealAt: product.reveal_at?.toISOString() ?? null,
        revealedAt: product.revealed_at?.toISOString() ?? null,
      })),
    }
  }

  async schedule(input: {
    productIds: readonly string[]
    liveAt: string
    featuredBy: string
  }): Promise<
    | ({ status: "saved" } & ProductScheduleReceipt)
    | { status: "missing" | "garment-incomplete" | "past"; productIds: string[] }
  > {
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      // node-postgres Date reads preserve milliseconds. Store the same precision so a removal can
      // match its own reveal even if an API caller supplied finer timestamp fractions.
      const liveAt = new Date(input.liveAt).toISOString()
      const ids = [...new Set(input.productIds)].sort()
      await client.query(
        `select product_id from commerce.printify_products where shop_id=$1 and product_id=any($2::text[])
           and active order by product_id for update`,
        [this.shopId, ids]
      )
      const products = (
        await client.query<{ product_id: string; blueprint_id: number | null; hidden_now: boolean }>(
          `select product_id,blueprint_id,(${productVisibilitySql.hiddenAtWrite}) as hidden_now
             from commerce.printify_products where shop_id=$1 and product_id=any($2::text[]) and active
             order by product_id`,
          [this.shopId, ids]
        )
      ).rows
      const missing = ids.filter((id) => !products.some((product) => product.product_id === id))
      if (missing.length || !ids.length) {
        await client.query("rollback")
        return { status: "missing", productIds: missing }
      }
      const complete = (
        await client.query<{ blueprint_id: number }>(
          `select blueprint_id from commerce.garment_models where shop_id=$1 and complete
             and blueprint_id=any($2::int[]) order by blueprint_id for share`,
          [this.shopId, products.filter((product) => product.hidden_now).map((product) => product.blueprint_id)]
        )
      ).rows.map((row) => row.blueprint_id)
      const incomplete = products
        .filter(
          (product) => product.hidden_now && (product.blueprint_id === null || !complete.includes(product.blueprint_id))
        )
        .map((product) => product.product_id)
      if (incomplete.length) {
        await client.query("rollback")
        return { status: "garment-incomplete", productIds: incomplete }
      }
      // A row/garment lock may have waited across the deadline. Reject that moment before writing.
      const future = await client.query<{ future: boolean }>("select $1::timestamptz > clock_timestamp() as future", [
        liveAt,
      ])
      if (!future.rows[0]?.future) {
        await client.query("rollback")
        return { status: "past", productIds: ids }
      }
      // Product locks serialize every schedule writer, so there is one upcoming row per product
      // without a time-dependent index predicate. Current features remain while next week is queued.
      await client.query(
        `update commerce.product_week_schedule set ended_at=now(),updated_at=now()
           where shop_id=$1 and product_id=any($2::text[]) and ended_at is null and live_at>clock_timestamp() and live_at<>$3`,
        [this.shopId, ids, liveAt]
      )
      await client.query(
        `insert into commerce.product_week_schedule (shop_id,product_id,live_at,featured_by)
           select $1,product_id,$3,$4 from unnest($2::text[]) product_id
           on conflict (shop_id,product_id,live_at) where ended_at is null
           do update set updated_at=now()
           returning id`,
        [this.shopId, ids, liveAt, input.featuredBy]
      )
      await client.query(
        `update commerce.printify_products set reveal_at=$3,updated_at=now()
           where shop_id=$1 and product_id=any($2::text[]) and active and ${productVisibilitySql.hiddenAtWrite}`,
        [this.shopId, ids, liveAt]
      )
      const receipt = await this.receipt(client, ids)
      await client.query("commit")
      return { status: "saved", ...receipt }
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  /** Removing a future feature undoes only its own future reveal; an on-sale product stays on sale. */
  async remove(
    productId: string
  ): Promise<ProductScheduleReceipt & { outcome: "removed" | "current" | "unscheduled" }> {
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      await client.query(
        "select product_id from commerce.printify_products where shop_id=$1 and product_id=$2 for update",
        [this.shopId, productId]
      )
      const removed = await client.query<{ removed_count: number }>(
        `with removed as (
           update commerce.product_week_schedule set ended_at=now(),updated_at=now()
            where shop_id=$1 and product_id=$2 and ended_at is null and live_at>clock_timestamp()
            returning live_at
         ), cleared as (
          update commerce.printify_products set reveal_at=null,updated_at=now()
          where shop_id=$1 and product_id=$2 and reveal_at in (select live_at from removed)
            and reveal_at>clock_timestamp() returning product_id
         )
         select count(*)::int as removed_count from removed`,
        [this.shopId, productId]
      )
      const receipt = await this.receipt(client, [productId])
      await client.query("commit")
      return {
        ...receipt,
        outcome:
          removed.rows[0]!.removed_count > 0
            ? "removed"
            : receipt.entries.some((entry) => Date.parse(entry.liveAt) <= receipt.now)
              ? "current"
              : "unscheduled",
      }
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}
