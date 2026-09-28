// @vitest-environment node
import { randomUUID } from "node:crypto"
import type { Pool } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { applyAllMigrations } from "../../../test/apply-all-migrations"
import { createAdminDatabaseFixture } from "../../../test/create-admin-database-fixture"
import { createRuntimeLoginPool } from "../../../test/create-runtime-login-pool"
import { orderAlertFixture } from "../../../test/order-alert-fixture"
import type { AlertOrder } from "./order-alert"
import { processOrderAlerts } from "./process-order-alerts.server"
vi.mock("server-only", () => ({}))

const databaseUrl = process.env.SHIPPING_TEST_DATABASE_URL

describe.skipIf(!databaseUrl)("durable owner reminder outbox", () => {
  let database: Pool
  let runtime: Pool
  const checkShipment = vi.fn()
  const checkPayment = vi.fn()
  const send = vi.fn()
  const now = new Date("2026-09-14T16:00:00Z") // Business day 8, excluding Labor Day.
  const run = (at = now) =>
    processOrderAlerts({
      pool: runtime,
      shopId: "123",
      from: "orders@example.com",
      siteUrl: "https://example.com",
      now: at,
      checkShipment,
      checkPayment,
      send,
    })
  async function seed(change?: (order: AlertOrder) => void) {
    const order = orderAlertFixture()
    order.request_id = randomUUID()
    order.snapshot.requestId = order.request_id
    change?.(order)
    await database.query(
      `insert into commerce.checkout_orders(request_id,snapshot,payment,session_id,printify_order_id,state,created_at)
      values($1,$2,$3,$4,$5,$6,$7)`,
      [
        order.request_id,
        order.snapshot,
        order.payment,
        `${order.session_id}-${order.request_id}`,
        `${order.printify_order_id}-${order.request_id}`,
        order.state,
        order.payment.paidAt,
      ]
    )
    return order
  }
  beforeAll(async () => {
    database = await createAdminDatabaseFixture(databaseUrl!)
    await applyAllMigrations(database)
    runtime = await createRuntimeLoginPool(database, databaseUrl!)
  })
  beforeEach(async () => {
    await database.query("truncate commerce.checkout_orders cascade")
    checkShipment
      .mockReset()
      .mockResolvedValue({ complete: false, summary: "Not shipped", items: [], needsAttention: false })
    checkPayment.mockReset().mockResolvedValue("paid")
    send.mockReset().mockResolvedValue("resend-receipt")
  })
  afterAll(async () => {
    await runtime?.end()
    await database?.end()
  })

  it("alerts on day 8, once per business day, then reminds the next day", async () => {
    await seed()
    expect(await run(new Date("2026-09-11T16:00:00Z"))).toMatchObject({ sent: 0 })
    expect(checkShipment).not.toHaveBeenCalled()
    expect(await run()).toMatchObject({ sent: 1, errors: 0 })
    expect(await run(new Date("2026-09-14T18:00:00Z"))).toMatchObject({ sent: 0 })
    expect(await run(new Date("2026-09-15T16:00:00Z"))).toMatchObject({ sent: 1 })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0]?.[0].to).toEqual(["support@fixture.example"])
  })
  it("ignores tests, unpaid orders and other shops", async () => {
    await seed((o) => {
      o.payment.livemode = false
    })
    await seed((o) => {
      o.state = "simulated"
    })
    await seed((o) => {
      o.snapshot.shopId = "999"
    })
    const unpaid = await seed()
    await database.query("update commerce.checkout_orders set payment=null where request_id=$1", [unpaid.request_id])
    expect(await run()).toMatchObject({ checked: 0, sent: 0 })
    expect(checkPayment).not.toHaveBeenCalled()
  })
  it.each(["shipped", "refunded"])("stops after verified %s", async (reason) => {
    const order = await seed()
    if (reason === "shipped")
      checkShipment.mockResolvedValue({ complete: true, items: [], summary: "Shipped", needsAttention: false })
    else checkPayment.mockResolvedValue("refunded")
    expect(await run()).toMatchObject({ checked: 1, sent: 0 })
    expect(await run(new Date("2026-09-15T16:00:00Z"))).toMatchObject({ checked: 0 })
    const stored = await database.query(
      "select completed_reason from commerce.order_shipping_alerts where request_id=$1",
      [order.request_id]
    )
    expect(stored.rows[0].completed_reason).toBe(reason)
  })
  it.each(["partial_refund", "disputed", "unknown"])("still asks the owner to review %s", async (state) => {
    await seed()
    checkPayment.mockResolvedValue(state)
    expect(await run()).toMatchObject({ sent: 1 })
  })

  it("retries ambiguous sends with an identical body and key despite changing provider state", async () => {
    const order = await seed()
    send.mockRejectedValueOnce(new Error("connection lost"))
    expect(await run()).toMatchObject({ errors: 1 })
    checkShipment.mockResolvedValue({ complete: false, summary: "Status changed", items: [], needsAttention: true })
    expect(await run(new Date("2026-09-14T18:00:00Z"))).toMatchObject({ sent: 1 })
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0])
    expect(send.mock.calls[0]?.[1]).toBe(`order-shipping/${order.request_id}/2026-09-14`)
  })
  it("does not send a second daily reminder after an overnight retry succeeds", async () => {
    await seed()
    send.mockRejectedValueOnce(new Error("connection lost"))
    await run(new Date("2026-09-14T20:00:00Z"))
    await run(new Date("2026-09-15T14:00:00Z"))
    await run(new Date("2026-09-15T16:00:00Z"))
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0])
  })
  it("does not retry a stale key after Resend's deduplication window", async () => {
    await seed()
    send.mockRejectedValueOnce(new Error("connection lost"))
    await run()
    await run(new Date("2026-09-15T17:00:00Z"))
    expect(send.mock.calls[1]?.[1]).not.toBe(send.mock.calls[0]?.[1])
    expect(send.mock.calls[1]?.[0].text).toContain("2026-09-15T17:00:00.000Z")
  })
  it("cancels a pending email when the order ships before retry", async () => {
    await seed()
    send.mockRejectedValueOnce(new Error("connection lost"))
    await run()
    checkShipment.mockResolvedValue({ complete: true, items: [], summary: "Shipped", needsAttention: false })
    await run(new Date("2026-09-14T18:00:00Z"))
    expect(send).toHaveBeenCalledTimes(1)
  })
  it("serializes overlapping runs", async () => {
    await seed()
    let release!: () => void
    let reached!: () => void
    const arrived = new Promise<void>((resolve) => {
      reached = resolve
    })
    send.mockImplementationOnce(async () => {
      reached()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return "receipt"
    })
    const first = run()
    await arrived
    try {
      expect(await run()).toMatchObject({ reason: "already_running", sent: 0 })
    } finally {
      release()
    }
    await first
    expect(send).toHaveBeenCalledTimes(1)
  })
  it("skips holidays, weekends and before 9am in the configured store time zone", async () => {
    await seed()
    for (const at of ["2026-09-07T16:00:00Z", "2026-09-12T16:00:00Z", "2026-09-14T08:00:00Z"])
      expect(await run(new Date(at))).toMatchObject({ reason: "outside_business_hours", checked: 0 })
  })
  it("keeps the outbox private and works through the restricted runtime role", async () => {
    await seed()
    await run()
    const { rows } = await database.query(
      `select relrowsecurity from pg_class where oid='commerce.order_shipping_alerts'::regclass`
    )
    expect(rows[0].relrowsecurity).toBe(true)
    const privileges =
      await database.query(`select has_table_privilege('anon','commerce.order_shipping_alerts','SELECT') as anon,
      has_table_privilege('authenticated','commerce.order_shipping_alerts','SELECT') as authenticated`)
    expect(privileges.rows[0]).toEqual({ anon: false, authenticated: false })
    expect((await runtime.query("select count(*) from commerce.order_shipping_alerts")).rows[0].count).toBe("1")
  })
})
