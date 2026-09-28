// @vitest-environment node
import { randomUUID } from "node:crypto"

import type { Pool } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { adminOrderFixtures } from "../../../test/admin-order-fixtures"
import { applyAllMigrations } from "../../../test/apply-all-migrations"
import { createAdminDatabaseFixture } from "../../../test/create-admin-database-fixture"
import { createRuntimeLoginPool } from "../../../test/create-runtime-login-pool"

import { listAdminOrders } from "./list-admin-orders.server"

const { filters: adminOrderFilters } = adminOrderFixtures

const { query, requireAdmin, settings } = vi.hoisted(() => ({
  query: vi.fn(),
  requireAdmin: vi.fn(),
  settings: { PRINTIFY_SHOP_ID: "123" },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/features/admin/get-admin-database.server", () => ({ getAdminDatabase: () => ({ query }) }))
vi.mock("@/features/admin/require-admin.server", () => ({ requireAdmin }))
vi.mock("@/lib/env", () => ({ env: settings }))

beforeEach(() => {
  settings.PRINTIFY_SHOP_ID = "123"
  requireAdmin.mockReset().mockResolvedValue({ userId: "admin" })
  query.mockReset()
})

describe("admin orders access and unavailable storage", () => {
  it("does not read any order before authorization succeeds", async () => {
    requireAdmin.mockRejectedValue(new Error("Redirect to sign-in"))
    await expect(listAdminOrders(adminOrderFilters)).rejects.toThrow("Redirect to sign-in")
    expect(query).not.toHaveBeenCalled()
  })

  it("does not read orders without a configured shop", async () => {
    settings.PRINTIFY_SHOP_ID = ""
    expect(await listAdminOrders(adminOrderFilters)).toEqual({ status: "unavailable" })
    expect(query).not.toHaveBeenCalled()
  })

  it("reports storage failures without logging customer data or a database URL", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    query.mockRejectedValue(new Error("postgres://secret:password@private-host.test customer@example.test"))
    expect(await listAdminOrders(adminOrderFilters)).toEqual({ status: "unavailable" })
    expect(warning).toHaveBeenCalledExactlyOnceWith("Admin orders unavailable", { reason: "storage" })
  })
})

const databaseUrl = process.env.ORDERS_TEST_DATABASE_URL

describe.skipIf(!databaseUrl)("admin order database read model", () => {
  let database: Pool
  let runtime: Pool
  const payment = {
    status: "paid",
    paymentIntentId: "pi_orderfixture",
    paidAt: "2026-09-21T18:22:00.000Z",
    livemode: true,
    currency: "usd",
    subtotalAmount: 3400,
    shippingAmount: 500,
    taxAmount: 280,
    totalAmount: 4180,
    customerName: "Jamie Customer",
    customerEmail: "jamie@example.test",
  }
  const attribution = {
    version: 1,
    capturedAt: "2026-09-21T18:00:00.000Z",
    channel: "social",
    source: "instagram",
    referrerHost: "instagram.com",
    utmSource: "instagram",
    utmMedium: "social",
    utmCampaign: "september_send",
    landingPath: "/shop/send-it",
    method: "campaign",
  }

  async function seed({
    shopId = "123",
    capture = payment,
    source = attribution,
    recipient = { firstName: "Robin", lastName: "Recipient" },
    state = "submitted",
    failureCode = null,
    createdAt = "2026-09-21T18:20:00.000Z",
  }: {
    shopId?: string
    capture?: typeof payment | null
    source?: typeof attribution | null
    recipient?: { firstName: string; lastName: string } | null
    state?: string
    failureCode?: string | null
    createdAt?: string
  } = {}) {
    const id = randomUUID()
    await database.query(
      `insert into commerce.checkout_orders(request_id,snapshot,payment,state,failure_code,created_at)
      values($1,$2,$3,$4,$5,$6)`,
      [
        id,
        { shopId, ...(recipient ? { shippingAddress: recipient } : {}), ...(source ? { attribution: source } : {}) },
        capture,
        state,
        failureCode,
        createdAt,
      ]
    )
    return id
  }

  beforeAll(async () => {
    database = await createAdminDatabaseFixture(databaseUrl!)
    await applyAllMigrations(database)
    runtime = await createRuntimeLoginPool(database, databaseUrl!)
  })
  beforeEach(async () => {
    await database.query("truncate commerce.checkout_orders cascade")
    query.mockImplementation(runtime.query.bind(runtime))
  })
  afterAll(async () => {
    await runtime?.end()
    await database?.end()
  })

  it("lists only the configured shop's captured live orders, including failed fulfillment", async () => {
    const paid = await seed({ failureCode: "PRINTIFY_UNAVAILABLE", state: "pending" })
    await seed({ shopId: "other-shop" })
    await seed({ capture: { ...payment, livemode: false }, state: "simulated" })
    await seed({ capture: null })
    const result = await listAdminOrders(adminOrderFilters)
    expect(result).toMatchObject({
      status: "ready",
      hasNextPage: false,
      orders: [
        {
          requestId: paid,
          paymentStatus: "paid",
          totalAmount: 4180,
          fulfillmentState: "pending",
          failureCode: "PRINTIFY_UNAVAILABLE",
          customerName: "Jamie Customer",
          recipientName: "Robin Recipient",
          source: "instagram",
          referrerHost: "instagram.com",
          channel: "social",
          campaign: "september_send",
        },
      ],
    })
    if (result.status !== "ready") throw new Error("Orders were unavailable")
    expect(result.orders).toHaveLength(1)
  })

  it("keeps historical unknowns unknown, without guessing payment from fulfillment", async () => {
    const historical = await seed({ capture: null, source: null, state: "submitted" })
    await seed()
    const result = await listAdminOrders({ ...adminOrderFilters, payment: "unverified", channel: "unknown" })
    expect(result).toMatchObject({
      status: "ready",
      orders: [
        {
          requestId: historical,
          customerName: null,
          recipientName: "Robin Recipient",
          totalAmount: null,
          paymentStatus: "unverified",
          source: null,
          channel: "unknown",
          campaign: null,
          fulfillmentState: "submitted",
        },
      ],
    })
    if (result.status !== "ready") throw new Error("Orders were unavailable")
    expect(result.orders).toHaveLength(1)
  })

  it("combines channel, fulfillment and test filters", async () => {
    const expected = await seed({
      capture: { ...payment, livemode: false },
      state: "simulated",
      failureCode: "TEST_FAILURE",
    })
    await seed({ failureCode: "PRINTIFY_UNAVAILABLE" })
    await seed({ capture: { ...payment, livemode: false }, state: "simulated" })
    const result = await listAdminOrders({
      ...adminOrderFilters,
      channel: "social",
      fulfillment: "attention",
      mode: "test",
    })
    expect(result).toMatchObject({ status: "ready", orders: [{ requestId: expected, testOrder: true }] })
    if (result.status !== "ready") throw new Error("Orders were unavailable")
    expect(result.orders).toHaveLength(1)
  })

  it("finds the exact linked order and still enforces shop scope", async () => {
    const target = await seed({ createdAt: "2026-01-01T12:00:00Z" })
    await Promise.all(Array.from({ length: 28 }, () => seed()))
    const foreign = await seed({ shopId: "other-shop" })
    expect(await listAdminOrders({ ...adminOrderFilters, orderId: target })).toMatchObject({
      status: "ready",
      hasNextPage: false,
      orders: [{ requestId: target }],
    })
    expect(await listAdminOrders({ ...adminOrderFilters, orderId: foreign })).toEqual({
      status: "ready",
      hasNextPage: false,
      orders: [],
    })
  })
  it("paginates equal timestamps deterministically without including the lookahead row", async () => {
    const ids = await Promise.all(Array.from({ length: 28 }, () => seed()))
    const expected = ids.sort().reverse()
    const first = await listAdminOrders(adminOrderFilters)
    const second = await listAdminOrders({ ...adminOrderFilters, page: 2 })
    expect(first).toMatchObject({ status: "ready", hasNextPage: true })
    expect(second).toMatchObject({ status: "ready", hasNextPage: false })
    if (first.status !== "ready" || second.status !== "ready") throw new Error("Orders were unavailable")
    expect(first.orders.map((order) => order.requestId)).toEqual(expected.slice(0, 25))
    expect(second.orders.map((order) => order.requestId)).toEqual(expected.slice(25))
  })
})
