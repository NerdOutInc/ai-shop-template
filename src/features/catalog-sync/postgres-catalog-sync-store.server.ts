import "server-only"

import type { Pool } from "pg"

import { createPostgresPool } from "@/lib/create-postgres-pool.server"

type RefreshKind = "stock" | "popularity"
type Observation = { payload: unknown; observed_at: Date }

export class PostgresCatalogSyncStore {
  private readonly pool
  private readonly workerPool
  private readonly busy = new Set<RefreshKind>()

  constructor(
    connectionString: string,
    private readonly shopId: string,
    private readonly sharedPools?: { requests: Pool; worker: Pool }
  ) {
    if (!/^[1-9]\d*$/.test(shopId)) throw new Error("A Printify shop is required")
    this.pool = sharedPools?.requests ?? createPostgresPool(connectionString, 1)
    this.workerPool = sharedPools?.worker ?? createPostgresPool(connectionString, 2)
  }

  async read(kind: RefreshKind): Promise<Observation | null> {
    const result = await this.pool.query<Observation>(
      "select payload, observed_at from commerce.catalog_refreshes where shop_id=$1 and kind=$2",
      [this.shopId, kind]
    )
    return result.rows[0] ?? null
  }

  async refresh(kind: RefreshKind, fetchPayload: () => Promise<unknown>, options: { force?: boolean } = {}) {
    if (this.busy.has(kind)) return "busy" as const
    this.busy.add(kind)
    let client
    let discard = false
    const lock = `catalog-refresh:${this.shopId}:${kind}`
    try {
      client = await this.workerPool.connect()
      discard = true
      const acquired = await client.query<{ acquired: boolean }>(
        "select pg_try_advisory_lock(hashtextextended($1,0)) as acquired",
        [lock]
      )
      discard = false
      if (!acquired.rows[0]?.acquired) return "busy" as const
      try {
        // Match the scheduled cadence with a minute of tolerance for delivery jitter.
        const previous = await client.query<{ recent: boolean }>(
          "select observed_at > now() - $3 * interval '1 second' as recent from commerce.catalog_refreshes where shop_id=$1 and kind=$2",
          [this.shopId, kind, (kind === "stock" ? 29 : 359) * 60]
        )
        if (!options.force && previous.rows[0]?.recent) return "recent" as const
        // Age starts before the scan, so slow or interrupted work cannot extend stale stock's life.
        const observedAt = new Date()
        const payload = await fetchPayload()
        // One atomic replacement; failed/partial scans never replace the last complete observation.
        await client.query(
          `insert into commerce.catalog_refreshes (shop_id,kind,payload,observed_at) values ($1,$2,$3::jsonb,$4)
           on conflict (shop_id,kind) do update set payload=excluded.payload,observed_at=excluded.observed_at
           where commerce.catalog_refreshes.observed_at < excluded.observed_at`,
          [this.shopId, kind, JSON.stringify(payload), observedAt]
        )
        return "updated" as const
      } finally {
        try {
          await client.query("select pg_advisory_unlock(hashtextextended($1,0))", [lock])
        } catch {
          discard = true
        }
      }
    } finally {
      client?.release(discard)
      this.busy.delete(kind)
    }
  }

  async close() {
    if (!this.sharedPools) await Promise.all([this.pool.end(), this.workerPool.end()])
  }
}
