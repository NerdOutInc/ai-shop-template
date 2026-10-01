// @vitest-environment node
import type { Pool } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { applyAllMigrations } from "../../../test/apply-all-migrations"
import { createAdminDatabaseFixture } from "../../../test/create-admin-database-fixture"
import { createRuntimeLoginPool } from "../../../test/create-runtime-login-pool"
import { SubscriberAdminStore } from "./subscriber-admin-store.server"
import { dropConsentWording } from "@/features/drop-signup/drop-consent-wording"

vi.mock("server-only", () => ({}))
const databaseUrl = process.env.SUBSCRIBER_TEST_DATABASE_URL

describe.skipIf(!databaseUrl)("private subscriber records", () => {
  let database: Pool
  let runtime: Pool
  let store: SubscriberAdminStore
  beforeAll(async () => {
    database = await createAdminDatabaseFixture(databaseUrl!)
    await applyAllMigrations(database)
    runtime = await createRuntimeLoginPool(database, databaseUrl!)
    store = new SubscriberAdminStore(runtime)
  })
  beforeEach(async () => {
    await database.query("truncate commerce.drop_subscribers cascade")
  })
  afterAll(async () => {
    await runtime?.end()
    await database?.end()
  })
  it("reads one exact address with historical evidence and never exposes confirmation secrets", async () => {
    await database.query(`insert into commerce.drop_subscribers(email,source,consent_copy_version,subscription_state,signup_ip)
      values ('shopper@example.com','footer','v1','legacy','203.0.113.7'), ('shopper+gear@example.com','footer','v3','pending',null)`)
    const record = (await store.lookup("shopper@example.com"))!
    await database.query(
      `insert into commerce.drop_signup_confirmations(subscriber_id,token_hash,source,consent_copy_version,message)
      values($1,$2,'footer','v3','{"text":"secret fragment token and email"}')`,
      [record.id, "a".repeat(64)]
    )
    const updated = (await store.readById(record.id))!
    expect(updated).toMatchObject({
      email: "shopper@example.com",
      eligible: true,
      consentVersion: "v1",
      signupIp: "203.0.113.7",
      confirmations: 1,
    })
    expect(dropConsentWording[updated.consentVersion]).toBe(
      "We'll email you when a new design drops. Nothing else, and you can stop any time."
    )
    expect(JSON.stringify(updated)).not.toMatch(/secret|token_hash|message|provider_email_id/)
    expect(await store.lookup("shopper")).toBeNull()
    expect(await store.lookup("%@example.com")).toBeNull()
    expect((await store.lookup("shopper+gear@example.com"))?.eligible).toBe(false)
  })
})
