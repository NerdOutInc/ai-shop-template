import "server-only"

import { Pool } from "pg"

import { attachPostgresPoolLifecycle } from "@/lib/attach-postgres-pool-lifecycle.server"
import { postgresConnectionConfig } from "@/lib/postgres-connection-config.server"

import { CheckoutError } from "./checkout-error"
import { checkoutClientKey } from "./checkout-client-key.server"

type Reservation = { bucket: string; intervalMs: number; burst: number; cost: number }

export class PostgresCheckoutCapacity {
  private readonly pool: Pool

  constructor(
    connectionString: string,
    private readonly options: { secret?: string; vercel: boolean; certificate?: string }
  ) {
    this.pool = new Pool({
      ...postgresConnectionConfig(connectionString, options.certificate),
      max: 1,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 8_000,
      query_timeout: 10_000,
    })
    attachPostgresPoolLifecycle(this.pool)
    this.pool.on("error", () => console.error("Checkout capacity database unavailable"))
  }

  async admit(headers: Headers) {
    const key = checkoutClientKey(headers, this.options.secret, this.options.vercel)
    await this.reserve([
      { bucket: "ingress", intervalMs: 1_000, burst: 30, cost: 1 },
      { bucket: `client:${key}`, intervalMs: 10_000, burst: 6, cost: 1 },
    ])
  }

  async reserveProviderReads(count: number) {
    if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("Invalid checkout read reservation")
    // One budget per database, not per token/shop/deployment: leave capacity for fulfillment and publishing.
    await this.reserve([{ bucket: "provider", intervalMs: 500, burst: 20, cost: count }])
  }

  private async reserve(reservations: Reservation[]) {
    const client = await this.pool.connect()
    let destroy = false
    try {
      await client.query("begin")
      await client.query("set local lock_timeout = '2s'")
      await client.query("set local statement_timeout = '5s'")
      // Stable order prevents deadlocks. Denied clients roll back the global debit as well.
      for (const { bucket, intervalMs, burst, cost } of reservations) {
        const result = await client.query(
          `insert into commerce.checkout_capacity (bucket, available_at, expires_at)
           values ($1, clock_timestamp() + $2 * interval '1 millisecond', clock_timestamp() + interval '10 minutes')
           on conflict (bucket) do update set
             available_at = greatest(commerce.checkout_capacity.available_at, clock_timestamp()) + $2 * interval '1 millisecond',
             expires_at = clock_timestamp() + interval '10 minutes'
           where greatest(commerce.checkout_capacity.available_at, clock_timestamp()) + $2 * interval '1 millisecond'
             <= clock_timestamp() + $3 * interval '1 millisecond'
           returning bucket`,
          [bucket, intervalMs * cost, intervalMs * burst]
        )
        if (result.rowCount !== 1)
          throw new CheckoutError("CHECKOUT_RATE_LIMITED", "Checkout is busy. Please wait a minute and try again.", 429)
      }
      // Cleanup is bounded by admitted traffic; rejected identities never leave a new row behind.
      await client.query(`delete from commerce.checkout_capacity where bucket in (
        select bucket from commerce.checkout_capacity where expires_at < clock_timestamp()
        order by expires_at limit 100 for update skip locked
      )`)
      await client.query("commit")
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

  async close() {
    await this.pool.end()
  }
}
