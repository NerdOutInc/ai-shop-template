import "server-only"

import type { Pool } from "pg"

import { createPostgresPool } from "@/lib/create-postgres-pool.server"

import { CheckoutError } from "./checkout-error"
import type { CheckoutOrder, OrderStore, StoredOrder } from "./checkout-order"

type OrderRow = {
  snapshot: CheckoutOrder
  payment: StoredOrder["payment"]
  session_id: string | null
  checkout_url: string | null
  state: StoredOrder["state"]
  printify_order_id: string | null
  failure_code: string | null
}

function normalize(row?: OrderRow): StoredOrder | null {
  return row
    ? {
        order: row.snapshot,
        payment: row.payment,
        sessionId: row.session_id,
        checkoutUrl: row.checkout_url,
        state: row.state,
        printifyOrderId: row.printify_order_id,
        failureCode: row.failure_code,
      }
    : null
}

export class PostgresOrderStore implements OrderStore {
  private readonly pool: Pool

  constructor(
    connectionString: string,
    private readonly sharedPool?: Pool
  ) {
    try {
      this.pool = sharedPool ?? createPostgresPool(connectionString)
    } catch {
      throw new CheckoutError("NOT_CONFIGURED", "Checkout is unavailable while we finish connecting the shop.")
    }
  }

  async withLock<T>(requestId: string, callback: Parameters<OrderStore["withLock"]>[1]): Promise<T> {
    const client = await this.pool.connect()
    let acquired = false
    let destroy = false
    try {
      const lock = await client.query<{ acquired: boolean }>(
        "select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired",
        [requestId]
      )
      acquired = lock.rows[0]?.acquired === true
      if (!acquired)
        throw new CheckoutError("ORDER_BUSY", "Your order is being processed. Please try again in a moment.", 409)
      // Autocommit each phase before contacting a provider. Rolling back the phase after a timeout could order twice.
      return (await callback({
        ensureCommerceIdentity: async (identity) => {
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(identity) || identity.length > 80) {
            throw new CheckoutError(
              "COMMERCE_IDENTITY_INVALID",
              "Checkout is unavailable while we check the store settings."
            )
          }
          // A singleton INSERT elects the first identity across concurrent serverless instances.
          // Runtime has no UPDATE or DELETE privilege, so a rebrand cannot replace the winner.
          await client.query(
            "insert into commerce.store_identity (singleton, identity) values (true, $1) on conflict (singleton) do nothing",
            [identity]
          )
          const result = await client.query<{ identity: string }>(
            "select identity from commerce.store_identity where singleton"
          )
          if (result.rows[0]?.identity !== identity) {
            throw new CheckoutError(
              "COMMERCE_IDENTITY_CHANGED",
              "Checkout is unavailable while we check the store settings."
            )
          }
        },
        get: async () =>
          normalize(
            (await client.query<OrderRow>("select * from commerce.checkout_orders where request_id = $1", [requestId]))
              .rows[0]
          ),
        insert: async (order) => {
          await client.query("insert into commerce.checkout_orders (request_id, snapshot) values ($1, $2::jsonb)", [
            requestId,
            JSON.stringify(order),
          ])
        },
        saveShippingAddress: async (address) => {
          // Capture the paid Session's destination once before any provider call. Recovery must use the same address.
          const result = await client.query(
            `update commerce.checkout_orders
             set snapshot = jsonb_set(snapshot, '{shippingAddress}', $2::jsonb), updated_at = now()
             where request_id = $1 and snapshot->>'shippingMode' = 'flat_rate'
               and state = 'pending' and not (snapshot ? 'shippingAddress')`,
            [requestId, JSON.stringify(address)]
          )
          if (result.rowCount === 1) return
          const existing = await client.query<{ matches: boolean }>(
            `select snapshot->>'shippingMode' = 'flat_rate' and snapshot->'shippingAddress' = $2::jsonb as matches
             from commerce.checkout_orders where request_id = $1`,
            [requestId, JSON.stringify(address)]
          )
          if (existing.rows[0]?.matches !== true)
            throw new CheckoutError("SHIPPING_ADDRESS_CONFLICT", "Your delivery details need our attention.")
        },
        savePayment: async (payment) => {
          // Keep the first verified capture even if a later webhook contains changed customer details.
          const result = await client.query(
            `update commerce.checkout_orders set payment = $2::jsonb, updated_at = now()
             where request_id = $1 and payment is null`,
            [requestId, JSON.stringify(payment)]
          )
          if (result.rowCount === 1) return
          const existing = await client.query<{ matches: boolean }>(
            `select (payment - 'customerName' - 'customerEmail') =
               ($2::jsonb - 'customerName' - 'customerEmail') as matches
             from commerce.checkout_orders where request_id = $1`,
            [requestId, JSON.stringify(payment)]
          )
          if (existing.rows[0]?.matches !== true)
            throw new CheckoutError("PAYMENT_CAPTURE_CONFLICT", "Your recorded payment needs our attention.")
        },
        update: async (patch) => {
          const columns = {
            sessionId: "session_id",
            checkoutUrl: "checkout_url",
            state: "state",
            printifyOrderId: "printify_order_id",
            failureCode: "failure_code",
          } as const
          const entries = Object.entries(patch) as [keyof typeof columns, unknown][]
          if (!entries.length) return
          const result = await client.query(
            `update commerce.checkout_orders set ${entries.map(([key], index) => `${columns[key]} = $${index + 2}`).join(", ")}, updated_at = now() where request_id = $1`,
            [requestId, ...entries.map(([, value]) => value)]
          )
          if (result.rowCount !== 1) throw new CheckoutError("ORDER_MISSING", "We could not locate this order.")
        },
      })) as T
    } finally {
      if (acquired) {
        try {
          await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [requestId])
        } catch {
          destroy = true
        }
      }
      client.release(destroy)
    }
  }

  async findBySession(sessionId: string) {
    return normalize(
      (await this.pool.query<OrderRow>("select * from commerce.checkout_orders where session_id = $1", [sessionId]))
        .rows[0]
    )
  }

  async close() {
    if (!this.sharedPool) await this.pool.end()
  }
}
