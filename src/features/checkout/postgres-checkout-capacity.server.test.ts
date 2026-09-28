// @vitest-environment node
import { Pool } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { applyAllMigrations } from "../../../test/apply-all-migrations"
import { createAdminDatabaseFixture } from "../../../test/create-admin-database-fixture"

import { PostgresCheckoutCapacity } from "./postgres-checkout-capacity.server"

vi.mock("server-only", () => ({}))
const databaseUrl = process.env.CHECKOUT_CAPACITY_TEST_DATABASE_URL
const headers = (number: number) => new Headers({ "x-vercel-forwarded-for": `192.0.2.${number}` })

describe.skipIf(!databaseUrl)("durable checkout capacity", () => {
  let pool: Pool
  let replicas: PostgresCheckoutCapacity[]
  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/store_capacity_test")
      throw new Error("Use an isolated local store_capacity_test database")
    pool = await createAdminDatabaseFixture(databaseUrl!)
    await applyAllMigrations(pool)
    // All reservations run under the actual application role, not a superuser bypass.
    url.searchParams.set("options", "-c role=store_app_runtime")
    replicas = Array.from(
      { length: 4 },
      () =>
        new PostgresCheckoutCapacity(url.toString(), {
          secret: "capacity-test-secret-not-for-deployment",
          vercel: true,
        })
    )
  })
  beforeEach(async () => {
    await pool.query("truncate commerce.checkout_capacity")
  })
  afterAll(async () => {
    await Promise.all(replicas?.map((replica) => replica.close()) ?? [])
    await pool?.end()
  })

  it("allows six concurrent retries across replicas and denies the rest atomically", async () => {
    const results = await Promise.allSettled(Array.from({ length: 24 }, (_, i) => replicas[i % 4]!.admit(headers(1))))
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(6)
    for (const result of results.filter((result) => result.status === "rejected"))
      expect(result.reason).toMatchObject({ code: "CHECKOUT_RATE_LIMITED", status: 429 })
    expect((await pool.query("select count(*)::int as count from commerce.checkout_capacity")).rows[0].count).toBe(2)
    // Denials did not debit shared capacity; an unrelated customer still fits.
    await expect(replicas[1]!.admit(headers(2))).resolves.toBeUndefined()
  })

  it("bounds a distributed burst and does not persist denied client identities", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 45 }, (_, i) => replicas[i % 4]!.admit(headers(i + 1)))
    )
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(30)
    expect((await pool.query("select count(*)::int as count from commerce.checkout_capacity")).rows[0].count).toBe(31)
  })

  it("reserves weighted provider work across replicas and keeps charges after provider failure", async () => {
    const results = await Promise.allSettled(replicas.map((replica) => replica.reserveProviderReads(10)))
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2)
    await expect(replicas[0]!.reserveProviderReads(20)).rejects.toMatchObject({ status: 429 })
    // Advancing the database's persisted schedule models refill without host clock dependence.
    await pool.query("update commerce.checkout_capacity set available_at = clock_timestamp() - interval '1 second'")
    await expect(replicas[2]!.reserveProviderReads(20)).resolves.toBeUndefined()
  })

  it("shares status limits across replicas while allowing distinct customers and later polls", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 16 }, (_, i) => replicas[i % 4]!.admitStatus(headers(1)))
    )
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(10)
    await expect(replicas[0]!.admitStatus(headers(2))).resolves.toBeUndefined()
    await pool.query("update commerce.checkout_capacity set available_at = clock_timestamp() - interval '1 second'")
    await expect(replicas[1]!.admitStatus(headers(1))).resolves.toBeUndefined()
  })

  it("coordinates public Stripe reads independently of request IDs and client networks", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 16 }, (_, i) => replicas[i % 4]!.reserveStripeRead(`cs_live_customer${i}`, "status"))
    )
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(10)
  })

  it("does not let unknown-session traffic spend the shared status or Stripe budgets", async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => replicas[i % 4]!.admitStatus(headers(Math.floor(i / 10) + 1)))
    )
    const buckets = (await pool.query<{ bucket: string }>("select bucket from commerce.checkout_capacity")).rows
    expect(buckets).toHaveLength(2)
    expect(buckets.every(({ bucket }) => bucket.startsWith("status-client:"))).toBe(true)
    await expect(replicas[0]!.admitStatus(headers(3))).resolves.toBeUndefined()
    await expect(replicas[0]!.reserveStripeRead("cs_live_payingCustomer", "status")).resolves.toBeUndefined()
  })

  it("caps one session across replicas and both public paths without debiting rejected shared work", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        replicas[i % 4]!.reserveStripeRead("cs_live_oneCustomer", i % 2 ? "status" : "checkout")
      )
    )
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
    // Nine unrelated customers still fit the ten-read burst after the twelve-request storm.
    await Promise.all(
      Array.from({ length: 9 }, (_, i) => replicas[i % 4]!.reserveStripeRead(`cs_live_other${i}`, "status"))
    )
    await expect(replicas[0]!.reserveStripeRead("cs_live_overBudget", "status")).rejects.toMatchObject({ status: 429 })
    const buckets = (await pool.query<{ bucket: string }>("select bucket from commerce.checkout_capacity")).rows
    expect(buckets.some(({ bucket }) => bucket.includes("cs_live"))).toBe(false)
    await pool.query("update commerce.checkout_capacity set available_at=clock_timestamp()-interval '1 second'")
    await expect(replicas[1]!.reserveStripeRead("cs_live_oneCustomer", "status")).resolves.toBeUndefined()
  })

  it("applies configured shared budgets while keeping client and session ceilings", async () => {
    const runtimeUrl = new URL(databaseUrl!)
    runtimeUrl.searchParams.set("options", "-c role=store_app_runtime")
    const tuned = new PostgresCheckoutCapacity(runtimeUrl.toString(), {
      secret: "capacity-test-secret-not-for-deployment",
      vercel: true,
      limits: JSON.stringify({
        ingress: { burst: 2 },
        status: { burst: 2 },
        stripeRead: { burst: 3 },
        providerRead: { burst: 25 },
      }),
    })
    try {
      await tuned.admit(headers(1))
      await tuned.admit(headers(2))
      await expect(tuned.admit(headers(3))).rejects.toMatchObject({ status: 429 })
      await tuned.reserveStripeRead("cs_live_tuned1", "status")
      await tuned.reserveStripeRead("cs_live_tuned2", "status")
      await expect(tuned.reserveStripeRead("cs_live_tuned3", "status")).rejects.toMatchObject({ status: 429 })
      await tuned.reserveStripeRead("cs_live_tuned3")
      await expect(tuned.reserveStripeRead("cs_live_tuned4")).rejects.toMatchObject({ status: 429 })
      await tuned.reserveProviderReads(20)
      await tuned.reserveProviderReads(5)
      await expect(tuned.reserveProviderReads(1)).rejects.toMatchObject({ status: 429 })
      await pool.query("update commerce.checkout_capacity set available_at=clock_timestamp()-interval '1 second'")
      await expect(tuned.reserveProviderReads(20)).resolves.toBeUndefined()
    } finally {
      await tuned.close()
    }
  })

  it("retains configurable budget debt beyond ten idle minutes", async () => {
    const runtimeUrl = new URL(databaseUrl!)
    runtimeUrl.searchParams.set("options", "-c role=store_app_runtime")
    const slow = new PostgresCheckoutCapacity(runtimeUrl.toString(), {
      secret: "capacity-test-secret-not-for-deployment",
      vercel: true,
      limits: JSON.stringify({ providerRead: { perMinute: 1, burst: 20 } }),
    })
    try {
      await slow.reserveProviderReads(20)
      await pool.query(
        "update commerce.checkout_capacity set available_at=available_at-interval '10 minutes', expires_at=expires_at-interval '10 minutes'"
      )
      // Another admitted path performs cleanup after half the twenty-minute refill horizon.
      await replicas[0]!.admit(headers(1))
      await expect(slow.reserveProviderReads(20)).rejects.toMatchObject({ status: 429 })
      await expect(slow.reserveProviderReads(10)).resolves.toBeUndefined()
    } finally {
      await slow.close()
    }
  })

  it("expires old identities without holding database locks across provider work", async () => {
    await replicas[0]!.admit(headers(1))
    await pool.query("update commerce.checkout_capacity set expires_at = clock_timestamp() - interval '1 second'")
    await replicas[1]!.admit(headers(2))
    const rows = (await pool.query("select bucket from commerce.checkout_capacity")).rows
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => !row.bucket.includes("192.0.2"))).toBe(true)
  })

  it("denies browser database roles access to admission state", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const client = await pool.connect()
      try {
        await client.query(`set role ${role}`)
        await expect(client.query("select * from commerce.checkout_capacity")).rejects.toMatchObject({ code: "42501" })
      } finally {
        await client.query("reset role")
        client.release()
      }
    }
  })
})
