import "server-only"

import { createHash } from "node:crypto"

import { Pool } from "pg"

import { attachPostgresPoolLifecycle } from "@/lib/attach-postgres-pool-lifecycle.server"
import { postgresConnectionConfig } from "@/lib/postgres-connection-config.server"

import { CheckoutError } from "./checkout-error"
import { checkoutClientKey } from "./checkout-client-key.server"
import { parseCheckoutCapacityLimits } from "./parse-checkout-capacity-limits"

type Reservation = { bucket: string; intervalMs: number; burst: number; cost: number }

export class PostgresCheckoutCapacity {
  private readonly pool: Pool

  constructor(
    connectionString: string,
    private readonly options: { secret?: string; vercel: boolean; certificate?: string; limits?: string },
    private readonly sharedPool?: Pool
  ) {
    if (sharedPool) {
      this.pool = sharedPool
      return
    }
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
      this.globalReservation("ingress"),
      { bucket: `client:${key}`, intervalMs: 10_000, burst: 6, cost: 1 },
    ])
  }

  async admitStatus(headers: Headers) {
    const key = checkoutClientKey(headers, this.options.secret, this.options.vercel)
    await this.reserve([{ bucket: `status-client:${key}`, intervalMs: 2_000, burst: 10, cost: 1 }])
  }

  async reserveStripeRead(sessionId: string, source: "status" | "checkout" = "checkout") {
    // Charge these together: a repeated Session must not spend another customer's shared allowance.
    const sessionKey = createHash("sha256").update(sessionId).digest("hex")
    await this.reserve([
      ...(source === "status" ? [this.globalReservation("status")] : []),
      this.globalReservation("stripeRead", "stripe-read"),
      { bucket: `session:${sessionKey}`, intervalMs: 4_000, burst: 1, cost: 1 },
    ])
  }

  async reserveProviderReads(count: number) {
    if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("Invalid checkout read reservation")
    // One budget per database, not per token/shop/deployment: leave capacity for fulfillment and publishing.
    await this.reserve([{ ...this.globalReservation("providerRead", "provider"), cost: count }])
  }

  private globalReservation(
    name: keyof ReturnType<typeof parseCheckoutCapacityLimits>,
    bucket: string = name
  ): Reservation {
    // Parse only on public admission; malformed tuning must not block signed payment webhooks.
    const { perMinute, burst } = parseCheckoutCapacityLimits(this.options.limits)[name]
    return { bucket, intervalMs: 60_000 / perMinute, burst, cost: 1 }
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
           values ($1, clock_timestamp() + $2 * interval '1 millisecond', clock_timestamp() + $2 * interval '1 millisecond' + interval '10 minutes')
           on conflict (bucket) do update set
             available_at = greatest(commerce.checkout_capacity.available_at, clock_timestamp()) + $2 * interval '1 millisecond',
             expires_at = greatest(commerce.checkout_capacity.available_at, clock_timestamp()) + $2 * interval '1 millisecond' + interval '10 minutes'
           where greatest(commerce.checkout_capacity.available_at, clock_timestamp()) + $2 * interval '1 millisecond'
             <= clock_timestamp() + $3 * interval '1 millisecond'
           returning bucket`,
          [bucket, intervalMs * cost, intervalMs * burst]
        )
        if (result.rowCount !== 1)
          throw new CheckoutError("CHECKOUT_RATE_LIMITED", "Checkout is busy. Please wait a minute and try again.", 429)
      }
      // Retain debt until fully refilled, plus ten idle minutes, even with slow configured budgets.
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
    if (!this.sharedPool) await this.pool.end()
  }
}
