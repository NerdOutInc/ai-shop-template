// @vitest-environment node
import { Pool } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { applyAllMigrations } from "../../../test/apply-all-migrations"
import { createAdminDatabaseFixture } from "../../../test/create-admin-database-fixture"

import { PostgresCatalogSyncStore } from "./postgres-catalog-sync-store.server"
vi.mock("server-only", () => ({}))
const databaseUrl = process.env.CATALOG_TEST_DATABASE_URL

describe.skipIf(!databaseUrl)("durable catalog observations", () => {
  let pool: Pool
  let runtime: Pool
  let first: PostgresCatalogSyncStore
  let second: PostgresCatalogSyncStore
  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/store_catalog_test")
      throw new Error("Use the isolated local store_catalog_test database")
    pool = await createAdminDatabaseFixture(databaseUrl!)
    await applyAllMigrations(pool)
    // A separate login inherits the real runtime grants/policies without ALTER ROLE races with other suites.
    await pool.query(
      "do $$ begin create role store_catalog_test_login login inherit password 'catalog-fixture'; exception when duplicate_object then null; end $$"
    )
    await pool.query("grant store_app_runtime to store_catalog_test_login")
    url.username = "store_catalog_test_login"
    url.password = "catalog-fixture"
    runtime = new Pool({ connectionString: url.toString() })
    first = new PostgresCatalogSyncStore(url.toString(), "123")
    second = new PostgresCatalogSyncStore(url.toString(), "123")
  })
  beforeEach(async () => {
    await pool.query("truncate commerce.catalog_refreshes")
  })
  afterAll(async () => {
    await Promise.all([first?.close(), second?.close(), runtime?.end(), pool?.end()])
  })
  it("persists across store instances using the restricted runtime role", async () => {
    expect(await first.refresh("stock", async () => ({ products: { shirt: [] } }))).toBe("updated")
    expect(await second.read("stock")).toMatchObject({
      payload: { products: { shirt: [] } },
      observed_at: expect.any(Date),
    })
    expect((await runtime.query("select count(*)::int as count from commerce.catalog_refreshes")).rows[0].count).toBe(1)
  })
  it("keeps the last complete observation when a scan fails", async () => {
    await first.refresh("popularity", async () => ({ shirt: 3 }))
    await pool.query("update commerce.catalog_refreshes set observed_at=now()-interval '6 hours'")
    const previous = await second.read("popularity")
    await expect(
      first.refresh("popularity", async () => {
        throw new Error("scan interrupted")
      })
    ).rejects.toThrow("scan interrupted")
    expect(await second.read("popularity")).toEqual(previous)
    expect(await second.refresh("popularity", async () => ({ shirt: 4 }))).toBe("updated")
  })
  it("excludes overlapping workers across instances while page reads remain available", async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const job = first.refresh("stock", async () => {
      entered.resolve()
      await release.promise
      return { products: {} }
    })
    await entered.promise
    try {
      const duplicate = vi.fn(async () => ({}))
      expect(await second.refresh("stock", duplicate, { force: true })).toBe("busy")
      expect(await first.refresh("stock", duplicate)).toBe("busy")
      expect(await first.read("stock")).toBeNull()
      expect(duplicate).not.toHaveBeenCalled()
      expect(await second.refresh("popularity", async () => ({ shirt: 1 }))).toBe("updated")
    } finally {
      release.resolve()
      await job
    }
  })
  it("deduplicates close cron deliveries without refetching and isolates shops", async () => {
    await first.refresh("stock", async () => ({ products: {} }))
    const duplicate = vi.fn(async () => ({}))
    expect(await second.refresh("stock", duplicate)).toBe("recent")
    expect(duplicate).not.toHaveBeenCalled()
    const other = new PostgresCatalogSyncStore(databaseUrl!, "456")
    try {
      expect(await other.read("stock")).toBeNull()
    } finally {
      await other.close()
    }
  })
  it.each([
    ["stock", 28, 30],
    ["popularity", 358, 360],
  ] as const)(
    "skips early %s deliveries but refreshes on the next scheduled tick",
    async (kind, earlyMinutes, nextMinutes) => {
      await first.refresh(kind, async () => ({ version: 1 }))
      const refresh = vi.fn(async () => ({ version: 2 }))
      await pool.query("update commerce.catalog_refreshes set observed_at=now()-$1 * interval '1 minute'", [
        earlyMinutes,
      ])
      expect(await second.refresh(kind, refresh)).toBe("recent")
      expect(refresh).not.toHaveBeenCalled()
      await pool.query("update commerce.catalog_refreshes set observed_at=now()-$1 * interval '1 minute'", [
        nextMinutes,
      ])
      expect(await second.refresh(kind, refresh)).toBe("updated")
      expect(refresh).toHaveBeenCalledOnce()
      expect((await first.read(kind))?.payload).toEqual({ version: 2 })
    }
  )
  it("allows a forced stock refresh without editing its timestamp", async () => {
    await first.refresh("stock", async () => ({ products: {} }))
    const replacement = vi.fn(async () => ({ products: { shirt: [] } }))
    expect(await second.refresh("stock", replacement)).toBe("recent")
    expect(await second.refresh("stock", replacement, { force: true })).toBe("updated")
    expect(replacement).toHaveBeenCalledOnce()
    expect((await first.read("stock"))?.payload).toEqual({ products: { shirt: [] } })
  })
  it("denies browser roles access and allows only the runtime operations", async () => {
    for (const role of ["anon", "authenticated"]) {
      const result = await pool.query(
        "select has_table_privilege($1, 'commerce.catalog_refreshes', 'select,insert,update,delete') as allowed",
        [role]
      )
      expect(result.rows[0].allowed).toBe(false)
    }
    await expect(runtime.query("delete from commerce.catalog_refreshes")).rejects.toThrow(/permission denied/)
    expect(
      (await pool.query("select relrowsecurity from pg_class where oid='commerce.catalog_refreshes'::regclass")).rows[0]
        .relrowsecurity
    ).toBe(true)
  })
})
