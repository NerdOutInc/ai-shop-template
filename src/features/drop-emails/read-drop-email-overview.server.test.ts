// @vitest-environment node
import type { Pool } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { applyAllMigrations } from "../../../test/apply-all-migrations"
import { createAdminDatabaseFixture } from "../../../test/create-admin-database-fixture"
import { createRuntimeLoginPool } from "../../../test/create-runtime-login-pool"
import { readDropEmailOverview } from "./read-drop-email-overview.server"

vi.mock("server-only", () => ({}))

// Its own database: every suite here rebuilds its schemas, and the outbox suite runs at the same time.
const databaseUrl = process.env.DROP_EMAIL_OVERVIEW_TEST_DATABASE_URL

describe.skipIf(!databaseUrl)("drop email overview", () => {
  let database: Pool
  let runtime: Pool

  beforeAll(async () => {
    database = await createAdminDatabaseFixture(databaseUrl!)
    await applyAllMigrations(database)
    runtime = await createRuntimeLoginPool(database, databaseUrl!)
  })
  beforeEach(async () => {
    await database.query("truncate commerce.drop_email_deliveries, commerce.drop_emails, commerce.drop_subscribers")
  })
  afterAll(async () => {
    await runtime?.end()
    await database?.end()
  })

  it("counts the list and summarizes each drop email through the runtime role, newest first", async () => {
    const ids = (
      await database.query<{ id: string; email: string }>(
        `insert into commerce.drop_subscribers (email, source, consent_copy_version, unsubscribed_at)
         values ('a@example.com', 'design-of-the-week', 'v1', null),
                ('b@example.com', 'design-of-the-week', 'v1', null),
                ('c@example.com', 'design-of-the-week', 'v1', now()),
                ('d@example.com', 'design-of-the-week', 'v1', null)
         returning id, email`
      )
    ).rows
    const id = (email: string) => ids.find((row) => row.email === email)!.id
    for (const [liveAt, subject] of [
      ["2026-10-05T09:00:00Z", "New this week: Abstract Lines"],
      ["2026-10-12T09:00:00Z", "New this week: Fern Study"],
    ])
      await database.query(
        `insert into commerce.drop_emails (live_at, from_address, reply_to, subject, html, text_body, product_ids)
         values ($1, 'Fixture Store <drops@fixture.example>', 'support@fixture.example', $2, '<p>x</p>', 'x', array['tee', 'crop'])`,
        [liveAt, subject]
      )
    await database.query(
      `insert into commerce.drop_email_deliveries
         (drop_live_at, subscriber_id, status, attempt_started_at, sent_at, provider_email_id)
       values ('2026-10-05T09:00:00Z', $1, 'sent', '2026-10-05T14:05:00Z', '2026-10-05T14:05:01Z', 're_1'),
              ('2026-10-05T09:00:00Z', $2, 'sent', '2026-10-05T14:05:00Z', '2026-10-05T14:05:02Z', 're_2'),
              ('2026-10-05T09:00:00Z', $3, 'unsubscribed', null, null, null),
              ('2026-10-05T09:00:00Z', $4, 'rejected', '2026-10-05T14:05:00Z', null, null),
              ('2026-10-12T09:00:00Z', $1, 'queued', null, null, null)`,
      [id("a@example.com"), id("b@example.com"), id("c@example.com"), id("d@example.com")]
    )

    expect(await readDropEmailOverview(runtime)).toEqual({
      status: "ready",
      subscribed: 3,
      unsubscribed: 1,
      history: [
        {
          liveAt: "2026-10-12T09:00:00.000Z",
          subject: "New this week: Fern Study",
          productCount: 2,
          recipients: 1,
          sent: 0,
          pending: 1,
          failed: 0,
          unsubscribed: 0,
          firstSentAt: null,
          lastSentAt: null,
        },
        {
          liveAt: "2026-10-05T09:00:00.000Z",
          subject: "New this week: Abstract Lines",
          productCount: 2,
          recipients: 4,
          sent: 2,
          pending: 0,
          failed: 1,
          unsubscribed: 1,
          firstSentAt: "2026-10-05T14:05:01.000Z",
          lastSentAt: "2026-10-05T14:05:02.000Z",
        },
      ],
    })
  })

  it("shows an empty list honestly, and says so when the tables cannot be read", async () => {
    expect(await readDropEmailOverview(runtime)).toEqual({
      status: "ready",
      subscribed: 0,
      unsubscribed: 0,
      history: [],
    })
    const broken = { query: () => Promise.reject(new Error("relation does not exist")) } as unknown as Pool
    expect(await readDropEmailOverview(broken)).toEqual({ status: "unavailable" })
  })
})
