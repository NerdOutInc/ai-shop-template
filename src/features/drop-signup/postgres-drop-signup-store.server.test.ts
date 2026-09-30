// @vitest-environment node

import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Pool } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { applyAllMigrations } from "../../../test/apply-all-migrations"
import { createAdminDatabaseFixture } from "../../../test/create-admin-database-fixture"

import { PostgresDropSignupStore } from "./postgres-drop-signup-store.server"

vi.mock("server-only", () => ({}))
// Its own database, not the checkout suite's. Vitest runs files in parallel, and
// postgres-order-store.server.test.ts opens with `drop schema if exists commerce cascade`; sharing
// store_commerce_test let that land after this setup and take both tables out from under the tests.
const databaseUrl = process.env.SIGNUP_TEST_DATABASE_URL

describe.skipIf(!databaseUrl)("drop signups", () => {
  let pool: Pool
  let runtime: Pool
  let runtimeConnection: string
  let store: PostgresDropSignupStore

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/store_signup_test")
      throw new Error("Use the isolated local store_signup_test database")
    pool = await createAdminDatabaseFixture(databaseUrl!)
    await applyAllMigrations(pool)
    // A separate inheriting login exercises the real grants and policies without ALTER ROLE racing
    // the other suites. store_app_runtime is nobypassrls, so this is the only thing that would catch a
    // missing policy: every other connection here owns the tables and bypasses RLS entirely.
    await pool.query(
      "do $$ begin create role store_signup_test_login login inherit password 'signup-fixture'; exception when duplicate_object then null; end $$"
    )
    await pool.query("grant store_app_runtime to store_signup_test_login")
    const runtimeUrl = new URL(databaseUrl!)
    runtimeUrl.username = "store_signup_test_login"
    runtimeUrl.password = "signup-fixture"
    runtimeConnection = runtimeUrl.toString()
    runtime = new Pool({ connectionString: runtimeConnection })
    store = new PostgresDropSignupStore(runtimeConnection)
  })
  beforeEach(async () => {
    // Drop email deliveries reference subscribers, so they go too.
    await pool.query(
      "truncate commerce.drop_email_deliveries, commerce.drop_emails, commerce.drop_subscribers, commerce.public_request_attempts"
    )
  })
  afterAll(async () => {
    await Promise.all([store?.close(), runtime?.end(), pool?.end()])
  })

  it("reaches both tables through the runtime role's own grants and policies", async () => {
    expect(await store.allowRequest("1.2.3.4", 5)).toBe(true)
    await store.subscribe("customer@example.com", "design-of-the-week", "203.0.113.7")
    expect((await runtime.query("select email from commerce.drop_subscribers")).rows).toEqual([
      { email: "customer@example.com" },
    ])
  })

  it("records what the person was shown, and that nothing has confirmed them", async () => {
    await store.subscribe("customer@example.com", "design-of-the-week", "203.0.113.7")
    const row = (
      await pool.query(
        "select source, consent_copy_version, confirmed_at, unsubscribed_at from commerce.drop_subscribers"
      )
    ).rows[0]
    // Consent evidence has to say what the wording was, not merely that somebody submitted.
    expect(row).toMatchObject({ source: "design-of-the-week", consent_copy_version: "v2" })
    // Nothing in this change sends anything, so nothing may claim a confirmation.
    expect(row.confirmed_at).toBeNull()
    expect(row.unsubscribed_at).toBeNull()
  })

  it("refreshes an existing subscriber instead of making a twin, and lifts an earlier unsubscribe", async () => {
    await store.subscribe("customer@example.com", "footer", "203.0.113.7")
    await pool.query(
      "update commerce.drop_subscribers set unsubscribed_at = now(), consented_at = now() - interval '30 days'"
    )
    const before = (await pool.query("select consented_at from commerce.drop_subscribers")).rows[0].consented_at

    await store.subscribe("customer@example.com", "design-of-the-week", "203.0.113.7")
    const after = (await pool.query("select source, consented_at, unsubscribed_at from commerce.drop_subscribers"))
      .rows[0]
    expect((await pool.query("select count(*) from commerce.drop_subscribers")).rows[0].count).toBe("1")
    expect(after.source).toBe("design-of-the-week")
    expect(after.unsubscribed_at).toBeNull()
    expect(after.consented_at.getTime()).toBeGreaterThan(before.getTime())
  })

  it("honors the documented support-removal procedure without changing another subscriber", async () => {
    await store.subscribe("customer@example.com", "footer", "203.0.113.7")
    await store.subscribe("other@example.com", "footer", "203.0.113.8")
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

  // The owner's call: signing up again does put you back on the list, but the earlier "no" stays on
  // record. One UPDATE both copies and clears the column, which only works because SET reads the old row.
  it("keeps the moment of an unsubscribe that a new signup lifts", async () => {
    const unsubscribe = async (ago: string) =>
      (
        await pool.query(
          "update commerce.drop_subscribers set unsubscribed_at = now() - $1::interval returning unsubscribed_at",
          [ago]
        )
      ).rows[0].unsubscribed_at as Date
    const read = async () =>
      (await pool.query("select unsubscribed_at, last_unsubscribed_at from commerce.drop_subscribers")).rows[0]

    await store.subscribe("customer@example.com", "footer", "203.0.113.7")
    expect(await read()).toEqual({ unsubscribed_at: null, last_unsubscribed_at: null })

    const first = await unsubscribe("3 days")
    await store.subscribe("customer@example.com", "footer", "203.0.113.7")
    expect(await read()).toEqual({ unsubscribed_at: null, last_unsubscribed_at: first })

    // A second re-signup has no unsubscribe to copy, and must not wipe the one on record.
    await store.subscribe("customer@example.com", "design-of-the-week", "203.0.113.7")
    expect(await read()).toEqual({ unsubscribed_at: null, last_unsubscribed_at: first })

    // Only the latest is kept, so a newer "no" replaces the older one.
    const second = await unsubscribe("1 day")
    expect(second.getTime()).toBeGreaterThan(first.getTime())
    await store.subscribe("customer@example.com", "footer", "203.0.113.7")
    expect(await read()).toEqual({ unsubscribed_at: null, last_unsubscribed_at: second })
  })

  // Signup is the opt-in, with no confirmation click to point at, so the address someone signed up
  // from is the evidence a provider asks for when a recipient says they never subscribed.
  it("records the signup address, and nothing else about the request", async () => {
    await store.subscribe("customer@example.com", "footer", "203.0.113.7")
    const row = (await pool.query("select signup_ip from commerce.drop_subscribers")).rows[0]
    expect(row.signup_ip).toBe("203.0.113.7")

    const columns = (
      await pool.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema='commerce' and table_name='drop_subscribers'"
      )
    ).rows.map((row) => row.column_name)
    expect(columns).not.toContain("user_agent")
  })

  // The identity step hands IPv6 over in URL-canonical hex, which is how an IPv4-mapped address
  // arrives; Postgres accepts it and merely prints the tail dotted.
  it.each([
    ["2001:db8:1:2::7", "2001:db8:1:2::7"],
    ["::ffff:cb00:7107", "::ffff:203.0.113.7"],
  ])("stores the IPv6 address %s", async (address, stored) => {
    await store.subscribe("customer@example.com", "footer", address)
    expect((await pool.query("select signup_ip from commerce.drop_subscribers")).rows[0].signup_ip).toBe(stored)
  })

  it("refuses to store a value that is not an address at all", async () => {
    await expect(store.subscribe("customer@example.com", "footer", "not-an-address")).rejects.toThrow()
  })

  // A local or preview submission has no trustworthy address; it must not erase real evidence.
  it("keeps the earlier address when a later signup has none", async () => {
    await store.subscribe("customer@example.com", "footer", "203.0.113.7")
    await store.subscribe("customer@example.com", "design-of-the-week", null)
    const row = (await pool.query("select signup_ip, source from commerce.drop_subscribers")).rows[0]
    expect(row).toMatchObject({ signup_ip: "203.0.113.7", source: "design-of-the-week" })
  })

  it("allows exactly the limit inside one window, and a flood cannot extend its own lockout", async () => {
    // A store holds ONE connection, so calls on a single store queue behind each other and prove
    // nothing about concurrency. Several stores are what make the statements actually overlap.
    const stores = Array.from({ length: 4 }, () => new PostgresDropSignupStore(runtimeConnection))
    try {
      // Open every connection first, so the calls below race each other rather than the handshakes.
      await Promise.all(stores.map((each) => each.allowRequest("warm-up", 5)))
      await pool.query("truncate commerce.public_request_attempts")
      const results = await Promise.all(
        stores.flatMap((each) => [each.allowRequest("9.9.9.9", 5), each.allowRequest("9.9.9.9", 5)])
      )
      expect(results.filter(Boolean)).toHaveLength(5)
    } finally {
      await Promise.all(stores.map((each) => each.close()))
    }
    // The window is fixed, so a blocked caller hammering it does not push its own release later.
    const blockedStart = (await pool.query("select window_start from commerce.public_request_attempts")).rows[0]
      .window_start
    expect(await store.allowRequest("9.9.9.9", 5)).toBe(false)
    expect(
      (await pool.query("select window_start from commerce.public_request_attempts")).rows[0].window_start.getTime()
    ).toBe(blockedStart.getTime())
  })

  it("counts each caller separately, and starts a fresh window once the old one passes", async () => {
    expect(await store.allowRequest("1.1.1.1", 1)).toBe(true)
    expect(await store.allowRequest("1.1.1.1", 1)).toBe(false)
    // A different caller is unaffected by someone else's exhausted bucket.
    expect(await store.allowRequest("2.2.2.2", 1)).toBe(true)

    await pool.query("update commerce.public_request_attempts set window_start = now() - interval '16 minutes'")
    expect(await store.allowRequest("1.1.1.1", 1)).toBe(true)
  })

  it.each([0, 101, 1.5])("refuses the nonsensical limit %s rather than guessing", async (limit) => {
    await expect(store.allowRequest("1.2.3.4", limit)).rejects.toThrow("Invalid public request limit")
  })

  // Through the runtime role, so a missing update or select policy fails here instead of in production.
  it("unsubscribes by the id in the link, keeps the row, and keeps the first moment on a second click", async () => {
    await store.subscribe("customer@example.com", "design-of-the-week", "203.0.113.7")
    await store.subscribe("friend@example.com", "design-of-the-week", "203.0.113.8")
    const { id } = (await pool.query("select id from commerce.drop_subscribers where email = 'customer@example.com'"))
      .rows[0]

    expect(await store.isUnsubscribed(id)).toBe(false)
    await store.unsubscribe(id)
    expect(await store.isUnsubscribed(id)).toBe(true)
    const read = async () =>
      (await pool.query("select email, unsubscribed_at from commerce.drop_subscribers order by email")).rows
    const [first] = await read()
    expect(first.unsubscribed_at).toBeInstanceOf(Date)

    await store.unsubscribe(id)
    expect(await read()).toEqual([
      { email: "customer@example.com", unsubscribed_at: first.unsubscribed_at },
      { email: "friend@example.com", unsubscribed_at: null },
    ])
  })

  it("does nothing, and says nothing, for an id that matches nobody", async () => {
    await store.subscribe("customer@example.com", "design-of-the-week", "203.0.113.7")
    await store.unsubscribe("00000000-0000-4000-8000-000000000000")
    expect((await pool.query("select unsubscribed_at from commerce.drop_subscribers")).rows).toEqual([
      { unsubscribed_at: null },
    ])
    expect(await store.isUnsubscribed("00000000-0000-4000-8000-000000000000")).toBe(false)
  })
})
