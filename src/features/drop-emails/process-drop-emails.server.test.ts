// @vitest-environment node
import type { Pool } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { applyAllMigrations } from "../../../test/apply-all-migrations"
import { createAdminDatabaseFixture } from "../../../test/create-admin-database-fixture"
import { createRuntimeLoginPool } from "../../../test/create-runtime-login-pool"
import { PostgresDropSignupStore } from "@/features/drop-signup/postgres-drop-signup-store.server"

import type { DropEmailMessage } from "./drop-email-message"
import type { DropEmailProduct } from "./drop-email-product"
import { processDropEmails } from "./process-drop-emails.server"
import type { DropEmailSendOutcome } from "./send-drop-email.server"

vi.mock("server-only", () => ({}))

const databaseUrl = process.env.DROP_EMAIL_TEST_DATABASE_URL

// Monday October 5, 2026: the drop goes live at 4 AM Central (09:00 UTC) and its email is due at 9.
const liveAt = "2026-10-05T09:00:00.000Z"
const nineCentral = new Date("2026-10-05T14:00:00Z")
const later = (minutes: number) => new Date(nineCentral.getTime() + minutes * 60_000)
const products: DropEmailProduct[] = [
  {
    id: "0a1b2c3d4e5f60718293a4b5",
    title: "Abstract Lines - Premium T-Shirt",
    image: {
      src: "https://example.public.blob.vercel-storage.com/published-mockups/v1/abstract-lines.jpg",
      alt: "Abstract Lines tee",
    },
    price: { min: 3000, max: 3400 },
  },
]

describe.skipIf(!databaseUrl)("weekly drop email outbox", () => {
  let database: Pool
  let runtime: Pool
  const readWeek = vi.fn()
  const readProducts = vi.fn()
  const send = vi.fn<(message: DropEmailMessage, key: string) => Promise<DropEmailSendOutcome>>()
  const run = (now: Date, siteUrl = "https://store.example") =>
    processDropEmails({
      pool: runtime,
      now,
      from: "Fixture Store <drops@fixture.example>",
      replyTo: "support@fixture.example",
      siteUrl,
      postalAddress: "PO Box 123, Austin, TX 78701",
      readWeek,
      readProducts,
      send,
      pause: async () => {},
    })
  async function subscribe(email: string, createdAt: string, unsubscribedAt: string | null = null) {
    const { rows } = await database.query<{ id: string }>(
      `insert into commerce.drop_subscribers (email, source, consent_copy_version, created_at, consented_at, unsubscribed_at)
       values ($1, 'design-of-the-week', 'v1', $2, $2, $3) returning id`,
      [email, createdAt, unsubscribedAt]
    )
    return rows[0]!.id
  }
  const deliveries = async () =>
    (
      await database.query<{ email: string; status: string; provider_email_id: string | null }>(
        `select subscriber.email, delivery.status, delivery.provider_email_id
           from commerce.drop_email_deliveries delivery
           join commerce.drop_subscribers subscriber on subscriber.id = delivery.subscriber_id
          order by subscriber.email`
      )
    ).rows

  beforeAll(async () => {
    database = await createAdminDatabaseFixture(databaseUrl!)
    await applyAllMigrations(database)
    runtime = await createRuntimeLoginPool(database, databaseUrl!)
  })
  beforeEach(async () => {
    await database.query("truncate commerce.drop_email_deliveries, commerce.drop_emails, commerce.drop_subscribers")
    readWeek.mockReset().mockResolvedValue({ liveAt, productIds: products.map((product) => product.id) })
    readProducts.mockReset().mockResolvedValue(products)
    let receipt = 0
    send.mockReset().mockImplementation(async () => ({ status: "sent", providerEmailId: `re_${++receipt}` }))
  })
  afterAll(async () => {
    await runtime?.end()
    await database?.end()
  })

  it("freezes the email once and sends it to everyone who had signed up before the drop", async () => {
    const early = await subscribe("early@example.com", "2026-09-23T21:18:32Z")
    await subscribe("late@example.com", "2026-09-27T22:39:58Z")
    // 5 AM Central on the day: they signed up looking at the drop, so there is nothing to tell them.
    await subscribe("after@example.com", "2026-10-05T10:00:00Z")
    await subscribe("gone@example.com", "2026-09-20T12:00:00Z", "2026-09-30T12:00:00Z")

    expect(await run(later(5))).toEqual({ reason: "processed", queued: 2, sent: 2, rejected: 0, errors: 0 })
    expect(await deliveries()).toEqual([
      { email: "early@example.com", status: "sent", provider_email_id: "re_1" },
      { email: "late@example.com", status: "sent", provider_email_id: "re_2" },
    ])
    const [message, key] = send.mock.calls[0]!
    expect(key).toBe(`drop-email/${liveAt}/${early}`)
    expect(message).toMatchObject({
      from: "Fixture Store <drops@fixture.example>",
      to: ["early@example.com"],
      reply_to: "support@fixture.example",
      subject: "New this week: Abstract Lines",
      headers: {
        "List-Unsubscribe": `<https://store.example/api/drop-unsubscribe/${early}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    })
    // Their own link, in both bodies, and nobody else's.
    expect(message.html).toContain(`https://store.example/unsubscribe/${early}`)
    expect(message.text).toContain(`https://store.example/unsubscribe/${early}`)
    expect(message.html).not.toContain("drop-email-subscriber-placeholder")
    expect(message.html).toContain("PO Box 123, Austin, TX 78701")

    // Later passes find the list already worked through: nothing is frozen or sent twice.
    expect(await run(later(20))).toEqual({ reason: "processed", queued: 0, sent: 0, rejected: 0, errors: 0 })
    expect(send).toHaveBeenCalledTimes(2)
    expect(readProducts).toHaveBeenCalledTimes(1)
    const { rows } = await database.query("select subject, product_ids from commerce.drop_emails")
    expect(rows).toEqual([{ subject: "New this week: Abstract Lines", product_ids: [products[0]!.id] }])
  })

  it("waits for 9 AM Central, and lets a day that passed without an email stay that way", async () => {
    await subscribe("early@example.com", "2026-09-23T21:18:32Z")
    expect(await run(later(-5))).toMatchObject({ reason: "not_yet" })
    // Tuesday: switching sending on mid-week must not mail a catch-up about Monday's drop.
    expect(await run(new Date("2026-10-06T14:05:00Z"))).toMatchObject({ reason: "window_closed" })
    expect(readProducts).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect((await database.query("select 1 from commerce.drop_emails")).rowCount).toBe(0)
  })

  it("says nothing in a week without a drop or without anything to sell, and flags a catalog it could not read", async () => {
    await subscribe("early@example.com", "2026-09-23T21:18:32Z")
    readWeek.mockResolvedValueOnce(null)
    expect(await run(later(5))).toMatchObject({ reason: "no_drop", errors: 0 })
    readProducts.mockResolvedValueOnce([])
    expect(await run(later(5))).toMatchObject({ reason: "no_products", errors: 0 })
    // "Could not tell" is not "nothing to say": the cron has to show it, and the next pass tries again.
    readProducts.mockResolvedValueOnce(null)
    expect(await run(later(5))).toMatchObject({ reason: "catalog_unavailable", errors: 1 })
    expect(send).not.toHaveBeenCalled()
    expect((await database.query("select 1 from commerce.drop_emails")).rowCount).toBe(0)
    expect(await run(later(20))).toMatchObject({ reason: "processed", sent: 1 })
  })

  it("retries an unconfirmed send with the same key and body, and stops before Resend forgets the key", async () => {
    await subscribe("early@example.com", "2026-09-23T21:18:32Z")
    await subscribe("late@example.com", "2026-09-27T22:39:58Z")
    send.mockImplementation(async (message) =>
      message.to[0] === "early@example.com" ? { status: "unconfirmed" } : { status: "sent", providerEmailId: "re_late" }
    )
    expect(await run(later(5))).toMatchObject({ sent: 1, errors: 1 })
    expect(await deliveries()).toMatchObject([{ status: "unconfirmed" }, { status: "sent" }])

    await run(later(20))
    const attempts = send.mock.calls.filter(([message]) => message.to[0] === "early@example.com")
    expect(attempts).toHaveLength(2)
    expect(attempts[1]).toEqual(attempts[0])

    // Twenty-three hours after the first attempt its key is too close to expiring for another try.
    send.mockClear()
    await run(later(5 + 23 * 60 + 1))
    expect(send).not.toHaveBeenCalled()
    expect(await deliveries()).toMatchObject([{ status: "expired" }, { status: "sent" }])
  })

  // Resend answers a retry whose body differs from the first attempt under the same key with a 409.
  it("retries with the frozen links even after the store's domain changes", async () => {
    await subscribe("early@example.com", "2026-09-23T21:18:32Z")
    send.mockResolvedValueOnce({ status: "unconfirmed" })
    await run(later(5))
    await run(later(20), "https://new-domain.example")
    const [first, retry] = send.mock.calls
    expect(retry).toEqual(first)
    expect(retry![0].headers["List-Unsubscribe"]).toMatch(/^<https:\/\/store\.example\/api\/drop-unsubscribe\//)
    expect(retry![0].html).not.toContain("new-domain.example")
  })

  it("puts a first attempt back when Resend took nothing, and stops the run there", async () => {
    await subscribe("early@example.com", "2026-09-23T21:18:32Z")
    await subscribe("late@example.com", "2026-09-27T22:39:58Z")
    send.mockResolvedValueOnce({ status: "not-sent" })
    expect(await run(later(5))).toMatchObject({ queued: 2, sent: 0, errors: 1 })
    expect(send).toHaveBeenCalledTimes(1)
    const { rows } = await database.query("select status, attempt_started_at from commerce.drop_email_deliveries")
    expect(rows).toEqual([
      { status: "queued", attempt_started_at: null },
      { status: "queued", attempt_started_at: null },
    ])
    expect(await run(later(20))).toMatchObject({ sent: 2, errors: 0 })
  })

  it("stops after three refusals in one run, because that looks like the sender and not the addresses", async () => {
    for (const name of ["a", "b", "c", "d"]) await subscribe(`${name}@example.com`, "2026-09-23T21:18:32Z")
    send.mockResolvedValue({ status: "rejected" })
    expect(await run(later(5))).toMatchObject({ rejected: 3, errors: 1 })
    expect((await deliveries()).map((delivery) => delivery.status).sort()).toEqual([
      "queued",
      "rejected",
      "rejected",
      "rejected",
    ])
  })

  it("never writes to someone who unsubscribed after the list was frozen", async () => {
    await subscribe("early@example.com", "2026-09-23T21:18:32Z")
    const late = await subscribe("late@example.com", "2026-09-27T22:39:58Z")
    send.mockResolvedValueOnce({ status: "not-sent" })
    await run(later(5))
    await database.query("update commerce.drop_subscribers set unsubscribed_at = $2 where id = $1", [late, later(10)])
    send.mockClear()
    expect(await run(later(20))).toMatchObject({ sent: 1 })
    expect(send.mock.calls.map(([message]) => message.to[0])).toEqual(["early@example.com"])
    expect(await deliveries()).toMatchObject([{ status: "sent" }, { status: "unsubscribed" }])
  })

  // The unsubscribe lands while the email before theirs is still with Resend, inside one run.
  const unsubscribeDuringSendTo = (sending: string, leaving: string) => async (message: DropEmailMessage) => {
    if (message.to[0] === sending)
      await database.query("update commerce.drop_subscribers set unsubscribed_at = now() where id = $1", [leaving])
    return { status: "sent" as const, providerEmailId: `re_${message.to[0]}` }
  }

  it("never writes to someone who unsubscribes while the run is sending to someone else", async () => {
    await subscribe("early@example.com", "2026-09-23T21:18:32Z")
    const late = await subscribe("late@example.com", "2026-09-27T22:39:58Z")
    send.mockImplementation(unsubscribeDuringSendTo("early@example.com", late))
    expect(await run(later(5))).toMatchObject({ queued: 2, sent: 1, errors: 0 })
    expect(send.mock.calls.map(([message]) => message.to[0])).toEqual(["early@example.com"])
    expect(await deliveries()).toMatchObject([{ status: "sent" }, { status: "unsubscribed" }])
  })

  it("never retries someone who unsubscribes while the run is retrying someone else", async () => {
    await subscribe("early@example.com", "2026-09-23T21:18:32Z")
    const late = await subscribe("late@example.com", "2026-09-27T22:39:58Z")
    send.mockResolvedValue({ status: "unconfirmed" })
    await run(later(5))
    expect(await deliveries()).toMatchObject([{ status: "unconfirmed" }, { status: "unconfirmed" }])
    send.mockReset().mockImplementation(unsubscribeDuringSendTo("early@example.com", late))
    await run(later(20))
    expect(send.mock.calls.map(([message]) => message.to[0])).toEqual(["early@example.com"])
    expect(await deliveries()).toMatchObject([{ status: "sent" }, { status: "unsubscribed" }])
  })

  it("ends first attempts with the drop's day, while an unconfirmed send may still be retried under its key", async () => {
    await subscribe("early@example.com", "2026-09-23T21:18:32Z")
    await subscribe("late@example.com", "2026-09-27T22:39:58Z")
    // Monday: early's send goes unconfirmed, then a rate limit stops the run before late's first try.
    send.mockResolvedValueOnce({ status: "unconfirmed" }).mockResolvedValueOnce({ status: "not-sent" })
    await run(later(5))
    expect(await deliveries()).toMatchObject([{ status: "unconfirmed" }, { status: "queued" }])

    // Tuesday 8 AM Central is still inside early's 23 hours, and long past late's day.
    send.mockReset().mockResolvedValue({ status: "sent", providerEmailId: "re_retry" })
    await run(new Date("2026-10-06T13:00:00Z"))
    expect(send.mock.calls.map(([message]) => message.to[0])).toEqual(["early@example.com"])
    expect(await deliveries()).toMatchObject([{ status: "sent" }, { status: "expired" }])

    // Switching sending back on later in the week sends nobody a Monday email.
    send.mockClear()
    await run(new Date("2026-10-07T15:00:00Z"))
    expect(send).not.toHaveBeenCalled()
  })

  // Through the signup store, so the rows are what a real return leaves behind: created_at kept,
  // consent refreshed, the old unsubscribe moved to last_unsubscribed_at.
  it("counts a returning subscriber from when they came back, the same cutoff as someone new", async () => {
    const signup = new PostgresDropSignupStore(databaseUrl!)
    const emails = ["back-after@example.com", "back-before@example.com", "stayed@example.com"]
    try {
      for (const email of emails) await signup.subscribe(email, "design-of-the-week", "203.0.113.7")
      const ids = (
        await database.query<{ id: string; email: string }>("select id, email from commerce.drop_subscribers")
      ).rows
      for (const email of ["back-after@example.com", "back-before@example.com"]) {
        await signup.unsubscribe(ids.find((row) => row.email === email)!.id)
        await signup.subscribe(email, "design-of-the-week", "203.0.113.7")
      }
      // Never left; just submitted the form again that morning.
      await signup.subscribe("stayed@example.com", "design-of-the-week", "203.0.113.7")
    } finally {
      await signup.close()
    }
    expect(
      (
        await database.query(
          `select email, unsubscribed_at, last_unsubscribed_at is not null as returned
             from commerce.drop_subscribers order by email`
        )
      ).rows
    ).toEqual([
      { email: "back-after@example.com", unsubscribed_at: null, returned: true },
      { email: "back-before@example.com", unsubscribed_at: null, returned: true },
      { email: "stayed@example.com", unsubscribed_at: null, returned: false },
    ])
    // Onto this test's calendar: everyone joined in September; two left on the 25th and came back on
    // either side of the 4 AM reveal, and the one who never left submitted again at 5 AM.
    await database.query(
      `update commerce.drop_subscribers
          set created_at = '2026-09-20T12:00:00Z',
              last_unsubscribed_at = case when last_unsubscribed_at is null then null else '2026-09-25T12:00:00Z'::timestamptz end,
              consented_at = case email when 'back-before@example.com' then '2026-10-01T12:00:00Z'::timestamptz
                                        else '2026-10-05T10:00:00Z'::timestamptz end`
    )
    expect(await run(later(5))).toMatchObject({ queued: 2, sent: 2 })
    expect(send.mock.calls.map(([message]) => message.to[0]).sort()).toEqual([
      "back-before@example.com",
      "stayed@example.com",
    ])
  })

  // Midnight alone would leave this drop five minutes and no cron run at all.
  it("still announces a drop that goes live minutes before midnight", async () => {
    await subscribe("early@example.com", "2026-09-23T21:18:32Z")
    // Monday 11:55 PM Central; the next run is 12:05 AM Tuesday.
    readWeek.mockResolvedValue({ liveAt: "2026-10-06T04:55:00.000Z", productIds: [products[0]!.id] })
    expect(await run(new Date("2026-10-06T05:05:00Z"))).toMatchObject({ reason: "processed", queued: 1, sent: 1 })
  })

  it("closes out an earlier week's leftovers once the next week begins", async () => {
    await subscribe("early@example.com", "2026-09-23T21:18:32Z")
    send.mockResolvedValueOnce({ status: "not-sent" })
    await run(later(5))
    readWeek.mockResolvedValue({ liveAt: "2026-10-12T09:00:00.000Z", productIds: [products[0]!.id] })
    readProducts.mockResolvedValue([])
    await run(new Date("2026-10-12T14:05:00Z"))
    expect(await deliveries()).toMatchObject([{ status: "expired" }])
  })

  it("lets only one run work at a time", async () => {
    await subscribe("early@example.com", "2026-09-23T21:18:32Z")
    const holder = await database.connect()
    try {
      await holder.query("select pg_advisory_lock(hashtextextended('drop-emails', 0))")
      expect(await run(later(5))).toMatchObject({ reason: "already_running" })
      expect(send).not.toHaveBeenCalled()
    } finally {
      await holder.query("select pg_advisory_unlock(hashtextextended('drop-emails', 0))")
      holder.release()
    }
    expect(await run(later(5))).toMatchObject({ sent: 1 })
  })

  it("keeps both tables away from browser roles", async () => {
    const client = await database.connect()
    try {
      for (const role of ["anon", "authenticated"])
        for (const table of ["commerce.drop_emails", "commerce.drop_email_deliveries"]) {
          await client.query("begin")
          try {
            // Schema access alone would turn them away; grant it here, rolled back below, so the check
            // reaches the table's own privileges.
            await client.query(`grant usage on schema commerce to ${role}`)
            await client.query(`set local role ${role}`)
            await expect(client.query(`select 1 from ${table}`)).rejects.toThrow(/permission denied for table/)
          } finally {
            await client.query("rollback")
          }
        }
    } finally {
      client.release()
    }
  })
})
