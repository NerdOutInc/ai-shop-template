// @vitest-environment node
import { Pool } from "pg"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { attachPostgresPoolLifecycle } from "./attach-postgres-pool-lifecycle.server"

vi.mock("server-only", () => ({}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("VERCEL_URL", "pool-test.vercel.app")
  vi.stubEnv("VERCEL_REGION", "iad1")
})

afterEach(async () => {
  await vi.runOnlyPendingTimersAsync()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function requestContext(deadline?: number) {
  const settled: boolean[] = []
  vi.stubGlobal(Symbol.for("@vercel/request-context"), {
    get: () => ({
      deadline,
      waitUntil: (promise: Promise<unknown>) => {
        const index = settled.push(false) - 1
        void promise.then(() => (settled[index] = true))
      },
    }),
  })
  return settled
}

describe("independent Postgres cleanup waits", () => {
  it("initializing an unused pool cannot cancel another request's cleanup", async () => {
    const first = new Pool({ idleTimeoutMillis: 5_000 })
    attachPostgresPoolLifecycle(first)
    const firstRequest = requestContext()
    first.emit("release")
    await vi.advanceTimersByTimeAsync(1_000)
    const secondRequest = requestContext()
    const second = new Pool({ idleTimeoutMillis: 5_000 })
    attachPostgresPoolLifecycle(second)
    await vi.advanceTimersByTimeAsync(1)
    expect(firstRequest).toEqual([false])
    expect(secondRequest).toEqual([])
    await vi.advanceTimersByTimeAsync(4_099)
    expect(firstRequest).toEqual([true])
    await Promise.all([first.end(), second.end()])
  })

  it("a shorter pool timeout cannot shorten an earlier pool's cleanup", async () => {
    const long = new Pool({ idleTimeoutMillis: 30_000 })
    const short = new Pool({ idleTimeoutMillis: 5_000 })
    attachPostgresPoolLifecycle(long)
    attachPostgresPoolLifecycle(short)
    const longRequest = requestContext()
    long.emit("release")
    await vi.advanceTimersByTimeAsync(1_000)
    const shortRequest = requestContext()
    short.emit("release")
    await vi.advanceTimersByTimeAsync(5_100)
    expect(longRequest).toEqual([false])
    expect(shortRequest).toEqual([true])
    await vi.advanceTimersByTimeAsync(24_000)
    expect(longRequest).toEqual([true])
    await Promise.all([long.end(), short.end()])
  })

  it("a late request cannot shorten another request's cleanup on the same pool", async () => {
    const pool = new Pool({ idleTimeoutMillis: 5_000 })
    attachPostgresPoolLifecycle(pool)
    const firstRequest = requestContext()
    pool.emit("release")
    await vi.advanceTimersByTimeAsync(1_000)
    const lateRequest = requestContext(Date.now() + 1_500)
    pool.emit("release")
    await vi.advanceTimersByTimeAsync(600)
    expect(firstRequest).toEqual([false])
    expect(lateRequest).toEqual([false])
    await vi.advanceTimersByTimeAsync(3_500)
    expect(firstRequest).toEqual([true])
    expect(lateRequest).toEqual([false])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(lateRequest).toEqual([true])
    await pool.end()
  })

  it("does not register cleanup waits outside a deployed function", async () => {
    vi.stubEnv("VERCEL_REGION", "")
    const request = requestContext()
    const pool = new Pool({ idleTimeoutMillis: 5_000 })
    attachPostgresPoolLifecycle(pool)
    pool.emit("release")
    expect(request).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    await pool.end()
  })
})
