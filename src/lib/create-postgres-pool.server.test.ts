// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"

import { createPostgresPool } from "./create-postgres-pool.server"

vi.mock("server-only", () => ({}))

const databaseUrl = process.env.CHECKOUT_TEST_DATABASE_URL

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe.skipIf(!databaseUrl)("Postgres pool suspension", () => {
  it("drains released connections before suspension while keeping an active session usable", async () => {
    const url = new URL(databaseUrl!)
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/store_commerce_test")
      throw new Error("Use an isolated local store_commerce_test database")
    const pending: Promise<unknown>[] = []
    vi.stubEnv("VERCEL_URL", "pool-test.vercel.app")
    vi.stubEnv("VERCEL_REGION", "iad1")
    vi.stubGlobal(Symbol.for("@vercel/request-context"), {
      get: () => ({ waitUntil: (promise: Promise<unknown>) => pending.push(promise) }),
    })
    const pool = createPostgresPool(databaseUrl!)
    const held = await pool.connect()
    const idle = await pool.connect()
    let released = false
    let idleReleased = false
    try {
      await held.query("select pg_advisory_lock(94666001)")
      expect((await idle.query("select pg_try_advisory_lock(94666001) as acquired")).rows[0].acquired).toBe(false)
      vi.useFakeTimers()
      idle.release()
      idleReleased = true
      expect(pending).toHaveLength(1)
      let readyToSuspend = false
      void pending[0]!.then(() => (readyToSuspend = true))
      await vi.advanceTimersByTimeAsync(4_999)
      expect(readyToSuspend).toBe(false)
      expect(pool.totalCount).toBe(2)
      await vi.advanceTimersByTimeAsync(101)
      expect(readyToSuspend).toBe(true)
      expect(pool.totalCount).toBe(1)
      // A checked-out connection can hold a session lock across provider I/O.
      expect((await held.query("select pg_advisory_unlock(94666001) as unlocked")).rows[0].unlocked).toBe(true)
      held.release()
      released = true
      await vi.advanceTimersByTimeAsync(5_100)
      await Promise.all(pending)
      expect(pool.totalCount).toBe(0)
      expect((await pool.query("select 1 as healthy")).rows[0].healthy).toBe(1)
    } finally {
      if (!released) held.release(true)
      if (!idleReleased) idle.release(true)
      await pool.end()
    }
  })
})
