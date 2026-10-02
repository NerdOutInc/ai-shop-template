// @vitest-environment node
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { applyAllMigrations } from "../../../test/apply-all-migrations"
import { Pool } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { createAdminDatabaseFixture } from "../../../test/create-admin-database-fixture"
import { PostgresDropSignupStore } from "./postgres-drop-signup-store.server"
import { processSignupConfirmations } from "./process-signup-confirmations.server"

vi.mock("server-only", () => ({}))
const databaseUrl = process.env.SIGNUP_TEST_DATABASE_URL
const sender = {
  from: "Fixture Store <drops@example.com>",
  replyTo: "support@example.com",
  siteUrl: "https://shop.example",
}

describe.skipIf(!databaseUrl)("drop signup confirmations", () => {
  let pool: Pool
  let runtime: Pool
  let store: PostgresDropSignupStore
  let runtimeConnection: string
  let historical: unknown[]
  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/store_signup_test")
      throw new Error("Use isolated local store_signup_test")
    pool = await createAdminDatabaseFixture(databaseUrl!)
    await applyAllMigrations(pool, async (file) => {
      if (file.endsWith("_drop_signup_confirmations.sql")) {
        await pool.query(`insert into commerce.drop_subscribers (email,source,consent_copy_version,unsubscribed_at)
          values ('legacy@example.com','footer','v2',null), ('stopped@example.com','footer','v2',now())`)
      }
    })
    historical = (
      await pool.query(
        `select subscription_state, confirmed_at, unsubscribed_at is not null as stopped from commerce.drop_subscribers order by email`
      )
    ).rows
    await pool.query(
      "do $$ begin create role store_signup_test_login login inherit password 'signup-fixture'; exception when duplicate_object then null; end $$"
    )
    await pool.query("grant store_app_runtime to store_signup_test_login")
    url.username = "store_signup_test_login"
    url.password = "signup-fixture"
    runtimeConnection = url.toString()
    runtime = new Pool({ connectionString: runtimeConnection })
    store = new PostgresDropSignupStore(runtimeConnection)
  })
  beforeEach(async () => {
    await pool.query("truncate commerce.drop_subscribers, commerce.public_request_attempts cascade")
    await pool.query("update commerce.drop_signup_confirmation_budget set queued_at = '{}', blocked_at = null")
  })
  afterAll(async () => {
    await Promise.all([store?.close(), runtime?.end(), pool?.end()])
  })
  const subscribe = (email = "shopper@example.com", ip: string | null = "203.0.113.7") =>
    store.subscribe(email, "footer", ip, sender)
  const read = async () => (await pool.query("select * from commerce.drop_subscribers order by email")).rows[0]
  const request = async () =>
    (await pool.query("select * from commerce.drop_signup_confirmations order by created_at desc")).rows[0]
  const token = async () => new URL((await request()).message.text.match(/https:\/\/\S+/)[0]).hash.slice(1)

  it("preserves historical eligibility without inventing confirmations, and preserves unsubscribes", () => {
    expect(historical).toEqual([
      { subscription_state: "legacy", confirmed_at: null, stopped: false },
      { subscription_state: "legacy", confirmed_at: null, stopped: true },
    ])
  })
  it("queues pending consent through runtime policies and confirms exactly once", async () => {
    expect(await subscribe()).toEqual(expect.any(String))
    expect(await read()).toMatchObject({
      email: "shopper@example.com",
      subscription_state: "pending",
      confirmed_at: null,
      consent_copy_version: "v3",
      signup_ip: "203.0.113.7",
    })
    const secret = await token()
    expect((await request()).token_hash).not.toBe(secret)
    expect(await store.confirm(secret)).toBe("confirmed")
    const first = await read()
    expect(first).toMatchObject({ subscription_state: "confirmed", unsubscribed_at: null })
    expect(first.confirmed_at).toBeInstanceOf(Date)
    expect(await store.confirm(secret)).toBe("confirmed")
    expect(await read()).toEqual(first)
    expect((await request()).message).toBeNull()
    expect(await subscribe()).toBeNull()
    expect(await read()).toEqual(first)
  })
  it("honors the documented support-removal procedure without changing another subscriber", async () => {
    await store.subscribe("customer@example.com", "footer", "203.0.113.7", sender)
    await store.subscribe("other@example.com", "footer", "203.0.113.8", sender)
    const script = fileURLToPath(new URL("../../../scripts/database/remove-drop-subscriber.psql", import.meta.url))
    const runOperator = (address: string) =>
      new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        const connection = new URL(runtimeConnection)
        const child = spawn(
          process.env.PSQL_BIN ?? "psql",
          ["-X", "--no-readline", "--no-password", "--file", script],
          {
            env: {
              // Do not let a developer's libpq service or host override redirect this local test.
              ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))),
              NODE_ENV: process.env.NODE_ENV,
              PGHOST: connection.hostname,
              PGPORT: connection.port,
              PGDATABASE: connection.pathname.slice(1),
              PGUSER: decodeURIComponent(connection.username),
              PGPASSWORD: decodeURIComponent(connection.password),
            },
            stdio: ["pipe", "pipe", "pipe"],
          }
        )
        let output = ""
        child.stdout.on("data", (data: Buffer) => {
          output += data.toString()
        })
        child.stderr.on("data", (data: Buffer) => {
          output += data.toString()
        })
        child.on("error", reject)
        child.on("close", (code) => resolve({ code, output }))
        child.stdin.end(`${address}\n`)
      })
    const readSubscriber = async (email: string) =>
      (await runtime.query("select * from commerce.drop_subscribers where email = $1", [email])).rows[0]
    const otherBefore = await readSubscriber("other@example.com")

    // Exercise the checked-in prompt and psql literal quoting, not a second copy of its SQL.
    for (const address of ["missing@example.com", "customer@example.com' OR true--", ""]) {
      const result = await runOperator(address)
      expect(result.code, result.output).toBe(0)
      expect(result.output).toContain("No matching subscriber")
      if (address) expect(result.output).not.toContain(address)
    }
    expect(
      (await runtime.query("select email from commerce.drop_subscribers where unsubscribed_at is null")).rows
    ).toHaveLength(2)
    const removal = await runOperator("  CUSTOMER@example.com  ")
    expect(removal.code, removal.output).toBe(0)
    expect(removal.output).toContain("Removal verified")
    expect(removal.output).not.toContain("CUSTOMER@example.com")
    // Both queued payloads initially existed; the removed address's link must be revoked by the trigger.
    const owned = (
      await pool.query(`select c.revoked_at, c.message from commerce.drop_signup_confirmations c
      join commerce.drop_subscribers s on s.id=c.subscriber_id where s.email='customer@example.com'`)
    ).rows[0]
    expect(owned.revoked_at).toBeInstanceOf(Date)
    expect(owned.message).toBeNull()
    const timestamp = (await readSubscriber("customer@example.com")).unsubscribed_at
    expect(timestamp).toBeInstanceOf(Date)
    const repeat = await runOperator("customer@example.com")
    expect(repeat.code, repeat.output).toBe(0)
    expect(repeat.output).toContain("Removal verified")
    expect((await readSubscriber("customer@example.com")).unsubscribed_at).toEqual(timestamp)
    expect(await readSubscriber("other@example.com")).toEqual(otherBefore)
    expect(
      (await runtime.query("select email from commerce.drop_subscribers where unsubscribed_at is null")).rows
    ).toEqual([{ email: "other@example.com" }])
    expect((await runtime.query("select count(*) from commerce.drop_subscribers")).rows[0].count).toBe("2")

    await pool.query("revoke update on commerce.drop_subscribers from store_app_runtime")
    try {
      const failure = await runOperator("other@example.com")
      expect(failure.code).not.toBe(0)
      expect(failure.output).not.toContain("Removal verified")
      expect(await readSubscriber("other@example.com")).toEqual(otherBefore)
    } finally {
      await pool.query("grant update on commerce.drop_subscribers to store_app_runtime")
    }
  })

  it("rejects expired and invalid tokens without eligibility changes", async () => {
    await subscribe()
    const secret = await token()
    await pool.query(
      "update commerce.drop_signup_confirmations set created_at = now()-interval '2 days', expires_at=now()-interval '1 day'"
    )
    expect(await store.confirm(secret)).toBe("expired")
    expect(await store.confirm("f".repeat(64))).toBe("expired")
    expect(await store.confirm("junk")).toBe("expired")
    expect((await read()).subscription_state).toBe("pending")
  })
  it("does not lift an unsubscribe on resubmission; fresh confirmation keeps the earlier stop evidence", async () => {
    await subscribe()
    const firstToken = await token()
    await store.confirm(firstToken)
    const { id } = await read()
    await store.unsubscribe(id)
    const stopped = await read()
    await pool.query("update commerce.drop_signup_confirmations set created_at=now()-interval '16 minutes'")
    await subscribe()
    expect((await read()).unsubscribed_at).toEqual(stopped.unsubscribed_at)
    expect(await store.confirm(firstToken)).toBe("expired")
    await store.confirm(await token())
    expect(await read()).toMatchObject({
      unsubscribed_at: null,
      last_unsubscribed_at: stopped.unsubscribed_at,
      subscription_state: "confirmed",
    })
  })
  it("revokes an unconsumed confirmation on unsubscribe, including the old application write", async () => {
    await subscribe()
    const secret = await token()
    await runtime.query("update commerce.drop_subscribers set unsubscribed_at=now()")
    expect(await store.confirm(secret)).toBe("expired")
    expect((await request()).message).toBeNull()
  })
  it("keeps the first unsubscribe time on repeat and ignores an unknown id", async () => {
    await subscribe()
    const { id } = await read()
    await store.unsubscribe(id)
    const first = (await read()).unsubscribed_at
    await store.unsubscribe(id)
    await store.unsubscribe("00000000-0000-4000-8000-000000000000")
    expect((await read()).unsubscribed_at).toEqual(first)
    expect(await store.isUnsubscribed(id)).toBe(true)
    expect(await store.isUnsubscribed("00000000-0000-4000-8000-000000000000")).toBe(false)
  })

  it("revokes a fresh re-signup link on repeat unsubscribe without replacing the first stop time", async () => {
    await subscribe()
    const { id } = await read()
    await store.unsubscribe(id)
    const firstStop = (await read()).unsubscribed_at
    await pool.query("update commerce.drop_signup_confirmations set created_at=now()-interval '16 minutes'")
    await subscribe()
    const freshToken = await token()
    await store.unsubscribe(id)
    expect((await read()).unsubscribed_at).toEqual(firstStop)
    expect((await request()).message).toBeNull()
    expect(await store.confirm(freshToken)).toBe("expired")
    expect((await read()).unsubscribed_at).toEqual(firstStop)
  })

  it.each(["v1", "v2"])("fails old %s signup writes closed and preserves unsubscribe", async (version) => {
    await expect(
      runtime.query(
        `insert into commerce.drop_subscribers(email,source,consent_copy_version) values ('old@example.com','footer',$1)`,
        [version]
      )
    ).rejects.toThrow("Signup application upgrade required")
    await subscribe()
    await store.unsubscribe((await read()).id)
    await expect(runtime.query("update commerce.drop_subscribers set unsubscribed_at=null")).rejects.toThrow(
      "Fresh subscriber confirmation required"
    )
    expect((await read()).unsubscribed_at).toBeInstanceOf(Date)
  })
  it("bounds concurrent resends by address, replaces old tokens and enforces the daily maximum", async () => {
    const ids = await Promise.all(Array.from({ length: 5 }, () => subscribe()))
    expect(ids.filter(Boolean)).toHaveLength(1)
    const original = await token()
    for (let i = 0; i < 2; i++) {
      await pool.query("update commerce.drop_signup_confirmations set created_at=created_at-interval '16 minutes'")
      expect(await subscribe()).not.toBeNull()
    }
    expect(await store.confirm(original)).toBe("expired")
    await pool.query("update commerce.drop_signup_confirmations set created_at=created_at-interval '16 minutes'")
    expect(await subscribe()).toBeNull()
    expect((await pool.query("select count(*) from commerce.drop_signup_confirmations")).rows[0].count).toBe("3")
  })

  it("enforces the rolling store-wide ceiling across distinct concurrent addresses, including erased rows", async () => {
    const stores = Array.from({ length: 6 }, () => new PostgresDropSignupStore(runtimeConnection))
    try {
      const results = await Promise.all(
        stores.map((each, index) =>
          each.subscribe(`burst-${index}@example.com`, "footer", null, { ...sender, hourlyLimit: 3 })
        )
      )
      expect(results.filter((id) => id !== "limited")).toHaveLength(3)
      expect(results.filter((id) => id === "limited")).toHaveLength(3)
      expect((await pool.query("select count(*) from commerce.drop_signup_confirmations")).rows[0].count).toBe("3")
      expect(
        (await pool.query("select blocked_at from commerce.drop_signup_confirmation_budget")).rows[0].blocked_at
      ).toBeInstanceOf(Date)
      await pool.query("delete from commerce.drop_subscribers")
      expect(await store.subscribe("new@example.com", "footer", null, { ...sender, hourlyLimit: 3 })).toBe("limited")
      await pool.query(
        "update commerce.drop_signup_confirmation_budget set queued_at = array[ now()-interval '61 minutes', now()-interval '30 minutes', now()-interval '10 minutes' ]"
      )
      expect(await store.subscribe("next@example.com", "footer", null, { ...sender, hourlyLimit: 3 })).not.toBe(
        "limited"
      )
      expect(
        (await pool.query("select cardinality(queued_at) as count from commerce.drop_signup_confirmation_budget"))
          .rows[0].count
      ).toBe(3)
      await pool.query("set role anon")
      try {
        await expect(pool.query("select * from commerce.drop_signup_confirmation_budget")).rejects.toThrow()
      } finally {
        await pool.query("reset role")
      }
    } finally {
      await Promise.all(stores.map((each) => each.close()))
    }
  })

  it("waits for a busy prompt sender lock and sends the queued neighbour after release", async () => {
    const id = await subscribe()
    const holder = await runtime.connect()
    await holder.query("select pg_advisory_lock(hashtextextended('signup-confirmations', 0))")
    const send = vi.fn().mockResolvedValue({ status: "sent", providerEmailId: "burst-receipt" })
    const pending = processSignupConfirmations({ pool: runtime, id: id!, send, pause: async () => {} })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(send).not.toHaveBeenCalled()
    await holder.query("select pg_advisory_unlock(hashtextextended('signup-confirmations', 0))")
    holder.release()
    expect(await pending).toEqual({ sent: 1, errors: 0 })
    expect(send).toHaveBeenCalledOnce()
  })

  it("reports prompt deferral after its bounded lock wait and leaves the request queued", async () => {
    const id = await subscribe()
    const holder = await runtime.connect()
    try {
      await holder.query("select pg_advisory_lock(hashtextextended('signup-confirmations', 0))")
      const send = vi.fn()
      expect(await processSignupConfirmations({ pool: runtime, id: id!, send })).toEqual({ sent: 0, errors: 1 })
      expect(send).not.toHaveBeenCalled()
      expect((await request()).status).toBe("queued")
    } finally {
      await holder.query("select pg_advisory_unlock(hashtextextended('signup-confirmations', 0))")
      holder.release()
    }
  }, 10_000)

  it("freezes provider payload and key across a lost response and a later domain change", async () => {
    const id = await subscribe()
    const send = vi
      .fn()
      .mockResolvedValueOnce({ status: "unconfirmed" })
      .mockResolvedValueOnce({ status: "sent", providerEmailId: "receipt-123" })
    expect(await processSignupConfirmations({ pool: runtime, send, id: id! })).toEqual({ sent: 0, errors: 1 })
    expect(await request()).toMatchObject({ status: "unconfirmed", attempts: 1 })
    expect(
      await store.subscribe("shopper@example.com", "footer", null, {
        ...sender,
        siteUrl: "https://changed.example",
        from: "Changed <changed@example.com>",
      })
    ).toBeNull()
    expect(await processSignupConfirmations({ pool: runtime, send })).toEqual({ sent: 0, errors: 0 })
    await pool.query("update commerce.drop_signup_confirmations set next_attempt_at=now()-interval '1 second'")
    expect(await processSignupConfirmations({ pool: runtime, send })).toEqual({ sent: 1, errors: 0 })
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0])
    expect(send.mock.calls[0]![0].text).toContain("https://shop.example/confirm-signup#")
    expect(await request()).toMatchObject({
      status: "sent",
      attempts: 2,
      provider_email_id: "receipt-123",
      message: null,
    })
    expect((await read()).subscription_state).toBe("pending")
  })
  it("expires uncertain attempts before provider deduplication ends", async () => {
    await subscribe()
    const send = vi.fn().mockResolvedValue({ status: "unconfirmed" })
    await processSignupConfirmations({ pool: runtime, send })
    await pool.query(
      "update commerce.drop_signup_confirmations set attempt_started_at=now()-interval '23 hours 1 minute', next_attempt_at=now()-interval '1 second'"
    )
    await processSignupConfirmations({ pool: runtime, send })
    expect(send).toHaveBeenCalledTimes(1)
    expect((await request()).last_provider_outcome).not.toBe("sent")
    expect(await request()).toMatchObject({ status: "expired", message: null })
  })
  it("retains known refusal evidence and stops a provider-limited run", async () => {
    await subscribe()
    await subscribe("friend@example.com")
    const send = vi.fn().mockResolvedValue({ status: "not-sent" })
    expect(await processSignupConfirmations({ pool: runtime, send })).toEqual({ sent: 0, errors: 1 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(
      (await pool.query("select attempts from commerce.drop_signup_confirmations order by created_at")).rows
    ).toEqual([{ attempts: 1 }, { attempts: 0 }])
  })
  it("cascades requests on erasure and denies browser-role access", async () => {
    await subscribe()
    const secret = await token()
    const browser = await pool.connect()
    try {
      await browser.query("set role anon")
      await expect(browser.query("select * from commerce.drop_signup_confirmations")).rejects.toThrow()
    } finally {
      await browser.query("reset role")
      browser.release()
    }
    await pool.query("delete from commerce.drop_subscribers")
    expect(await store.confirm(secret)).toBe("expired")
    expect((await pool.query("select count(*) from commerce.drop_signup_confirmations")).rows[0].count).toBe("0")
  })
  it("records real IPv6 but no invented address or user agent", async () => {
    await subscribe("ipv6@example.com", "2001:db8:1:2::7")
    expect((await read()).signup_ip).toBe("2001:db8:1:2::7")
    expect(await read()).not.toHaveProperty("user_agent")
    await expect(subscribe("bad@example.com", "not-an-address")).rejects.toThrow()
  })
  it("allows exactly the IP request limit under concurrency and does not extend a blocked window", async () => {
    const stores = Array.from({ length: 4 }, () => new PostgresDropSignupStore(runtimeConnection))
    try {
      const results = await Promise.all(
        stores.flatMap((s) => [s.allowRequest("9.9.9.9", 5), s.allowRequest("9.9.9.9", 5)])
      )
      expect(results.filter(Boolean)).toHaveLength(5)
      const before = (await pool.query("select window_start from commerce.public_request_attempts")).rows[0]
      expect(await store.allowRequest("9.9.9.9", 5)).toBe(false)
      expect((await pool.query("select window_start from commerce.public_request_attempts")).rows[0]).toEqual(before)
      await pool.query("update commerce.public_request_attempts set window_start=now()-interval '16 minutes'")
      expect(await store.allowRequest("9.9.9.9", 5)).toBe(true)
    } finally {
      await Promise.all(stores.map((s) => s.close()))
    }
  })
  it.each([0, 101, 1.5])("rejects invalid request limit %s", async (limit) => {
    await expect(store.allowRequest("1.2.3.4", limit)).rejects.toThrow("Invalid public request limit")
  })
})
