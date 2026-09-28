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
