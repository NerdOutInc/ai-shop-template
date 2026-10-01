// @vitest-environment node
import type { Pool } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { applyAllMigrations } from "../../../test/apply-all-migrations"
import { createAdminDatabaseFixture } from "../../../test/create-admin-database-fixture"
import { createRuntimeLoginPool } from "../../../test/create-runtime-login-pool"
import { queueSignupConfirmation } from "@/features/drop-signup/queue-signup-confirmation.server"
import { prunePendingSubscribers } from "./prune-pending-subscribers.server"
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
  async function seed() {
    const id = (
      await database.query<{ id: string }>(`insert into commerce.drop_subscribers
      (email,source,consent_copy_version,subscription_state,created_at) values ('shopper@example.com','footer','v1','legacy',now()-interval '3 days') returning id`)
    ).rows[0]!.id
    await database.query(`insert into commerce.drop_emails(live_at,from_address,reply_to,subject,html,text_body,product_ids,site_origin)
      values ('2026-10-05T09:00:00Z','drops@example.com','support@example.com','Frozen','<p>Shared</p>','Shared',array['tee'],'https://shop.example') on conflict do nothing`)
    await database.query(
      `insert into commerce.drop_email_deliveries(drop_live_at,subscriber_id,status,provider_email_id,attempt_started_at,sent_at)
      values ('2026-10-05T09:00:00Z',$1,'sent','private-delivery-receipt',now(),now())`,
      [id]
    )
    await database.query(
      `insert into commerce.drop_signup_confirmations(subscriber_id,token_hash,source,consent_copy_version,message,provider_email_id)
      values($1,$2,'footer','v3','{"text":"private token email payload"}','private-confirmation-receipt')`,
      [id, "a".repeat(64)]
    )
    return (await store.readById(id))!
  }
  it("erases all owned payloads and receipts, preserving shared templates and checkout evidence with the same email", async () => {
    const record = await seed()
    const orderId = "00000000-0000-4000-8000-000000000001"
    await database.query(
      `insert into commerce.checkout_orders(request_id,snapshot,state,printify_order_id)
      values($1,'{"customerEmail":"shopper@example.com","paymentIntentId":"pi_paid","paid":true}','submitted','print-fixture') on conflict do nothing`,
      [orderId]
    )
    const orders = (await database.query("select * from commerce.checkout_orders")).rows
    const templates = (await database.query("select * from commerce.drop_emails")).rows
    expect(await store.erase(record, record.email)).toEqual({ status: "erased" })
    expect(await store.readById(record.id)).toBeNull()
    expect((await database.query("select count(*) from commerce.drop_email_deliveries")).rows[0].count).toBe("0")
    expect((await database.query("select count(*) from commerce.drop_signup_confirmations")).rows[0].count).toBe("0")
    expect((await database.query("select * from commerce.checkout_orders")).rows).toEqual(orders)
    expect((await database.query("select * from commerce.drop_emails")).rows).toEqual(templates)
    await database.query(
      `insert into commerce.drop_subscribers(email,source,consent_copy_version) values ('shopper@example.com','footer','v3')`
    )
    const replacement = (await store.lookup(record.email))!
    expect(replacement.id).not.toBe(record.id)
    expect(await store.erase(record, record.email)).toEqual({ status: "absent" })
    expect(await store.lookup(record.email)).toEqual(replacement)
  })
  it("invalidates previews for a repeat stop and new owned rows, but not delivery-status changes", async () => {
    const original = await seed()
    await runtime.query(
      "update commerce.drop_subscribers set unsubscribed_at=now(),updated_at=clock_timestamp() where id=$1",
      [original.id]
    )
    const stopped = (await store.readById(original.id))!
    await runtime.query(
      "update commerce.drop_subscribers set unsubscribed_at=coalesce(unsubscribed_at,now()),updated_at=clock_timestamp() where id=$1",
      [original.id]
    )
    expect(await store.erase(stopped, stopped.email)).toMatchObject({ status: "stale" })
    const beforeInsert = (await store.readById(original.id))!
    await database.query(
      `insert into commerce.drop_signup_confirmations(subscriber_id,token_hash,source,consent_copy_version)
      values($1,$2,'footer','v3')`,
      [original.id, "b".repeat(64)]
    )
    const stale = await store.erase(beforeInsert, beforeInsert.email)
    expect(stale).toMatchObject({ status: "stale", subscriber: { confirmations: 2 } })
    const fresh = (await store.readById(original.id))!
    await database.query(
      "update commerce.drop_email_deliveries set status='expired',sent_at=null,provider_email_id=null where subscriber_id=$1",
      [original.id]
    )
    expect(await store.erase(fresh, fresh.email)).toEqual({ status: "erased" })
  })
  it.each(["drop-emails", "signup-confirmations"])(
    "refuses erasure while the %s worker holds its run lock",
    async (worker) => {
      const record = await seed()
      const sender = await database.connect()
      try {
        await sender.query("select pg_advisory_lock(hashtextextended($1,0))", [worker])
        expect(await store.erase(record, record.email)).toEqual({ status: "busy" })
        expect(await prunePendingSubscribers(runtime)).toBe(0)
        expect(await store.readById(record.id)).not.toBeNull()
      } finally {
        await sender.query("select pg_advisory_unlock(hashtextextended($1,0))", [worker])
        sender.release()
      }
    }
  )
  it("bounds a stuck subscriber row lock and rolls back without deleting anything", async () => {
    const record = await seed()
    const stuck = await database.connect()
    try {
      await stuck.query("begin")
      await stuck.query("select id from commerce.drop_subscribers where id=$1 for update", [record.id])
      const start = Date.now()
      expect(await store.erase(record, record.email)).toEqual({ status: "busy" })
      expect(Date.now() - start).toBeLessThan(2500)
    } finally {
      await stuck.query("rollback")
      stuck.release()
    }
    expect(await store.readById(record.id)).not.toBeNull()
  })
  it("keeps every subscriber foreign key cascading and keeps browser DELETE denied", async () => {
    const record = await seed()
    const references = (
      await database.query<{
        owned: string
        confdeltype: string
      }>(`select conrelid::regclass::text as owned, confdeltype
      from pg_constraint where contype='f' and confrelid='commerce.drop_subscribers'::regclass`)
    ).rows
    expect(references.map((row) => row.owned)).toEqual(
      expect.arrayContaining(["commerce.drop_email_deliveries", "commerce.drop_signup_confirmations"])
    )
    expect(references.every((row) => row.confdeltype === "c")).toBe(true)
    for (const role of ["anon", "authenticated"]) {
      const browser = await database.connect()
      try {
        await browser.query(`set role ${role}`)
        await expect(browser.query("delete from commerce.drop_subscribers where id=$1", [record.id])).rejects.toThrow()
      } finally {
        await browser.query("reset role")
        browser.release()
      }
    }
    expect(await store.readById(record.id)).not.toBeNull()
  })
  it("prunes only never-confirmed pending rows after the latest token expires, including their payloads", async () => {
    await database.query(`insert into commerce.drop_subscribers(email,source,consent_copy_version,subscription_state,confirmed_at,unsubscribed_at,created_at)
      values ('expired@example.com','footer','v3','pending',null,null,now()-interval '3 days'),
      ('resend@example.com','footer','v3','pending',null,null,now()-interval '3 days'),
      ('stopped@example.com','footer','v3','pending',null,now(),now()-interval '3 days'),
      ('confirmed@example.com','footer','v3','confirmed',now()-interval '2 days',null,now()-interval '3 days'),
      ('legacy@example.com','footer','v1','legacy',null,null,now()-interval '3 days')`)
    const expired = (await store.lookup("expired@example.com"))!
    const resend = (await store.lookup("resend@example.com"))!
    await database.query(
      `insert into commerce.drop_signup_confirmations(subscriber_id,token_hash,source,consent_copy_version,created_at,expires_at,message)
      values ($1,$3,'footer','v3',now()-interval '2 days',now()-interval '1 day','{"text":"expired secret"}'),
      ($2,$4,'footer','v3',now()-interval '2 days',now()-interval '1 day',null),
      ($2,$5,'footer','v3',now()-interval '1 hour',now()+interval '23 hours','{"text":"fresh secret"}')`,
      [expired.id, resend.id, "a".repeat(64), "b".repeat(64), "c".repeat(64)]
    )
    expect(await prunePendingSubscribers(runtime)).toBe(1)
    expect(await store.readById(expired.id)).toBeNull()
    expect(
      (
        await database.query("select count(*) from commerce.drop_signup_confirmations where subscriber_id=$1", [
          expired.id,
        ])
      ).rows[0].count
    ).toBe("0")
    expect(
      (await database.query("select email from commerce.drop_subscribers order by email")).rows.map((row) => row.email)
    ).toEqual(["confirmed@example.com", "legacy@example.com", "resend@example.com", "stopped@example.com"])
  })
  it("bounds cleanup and skips a row held by signup/confirmation", async () => {
    await database.query(`insert into commerce.drop_subscribers(email,source,consent_copy_version,created_at)
      select 'pending-'||n||'@example.com','footer','v3',now()-interval '2 days' from generate_series(1,102) n`)
    const held = (await store.lookup("pending-1@example.com"))!
    const signup = await database.connect()
    try {
      await signup.query("begin")
      await signup.query("select id from commerce.drop_subscribers where id=$1 for update", [held.id])
      expect(await prunePendingSubscribers(runtime)).toBe(100)
      expect(await store.readById(held.id)).not.toBeNull()
    } finally {
      await signup.query("rollback")
      signup.release()
    }
    expect(await prunePendingSubscribers(runtime)).toBe(2)
  })
  it("reaches expired rows behind a full window of older live resend tokens", async () => {
    await database.query(`insert into commerce.drop_subscribers(email,source,consent_copy_version,created_at)
      select 'resend-'||n||'@example.com','footer','v3',now()-interval '3 days' from generate_series(1,100) n`)
    await database.query(`insert into commerce.drop_signup_confirmations(subscriber_id,token_hash,source,consent_copy_version,expires_at)
      select id,encode(sha256(id::text::bytea),'hex'),'footer','v3',now()+interval '23 hours' from commerce.drop_subscribers`)
    await database.query(`insert into commerce.drop_subscribers(email,source,consent_copy_version,created_at)
      values('expired-behind@example.com','footer','v3',now()-interval '2 days')`)
    expect(await prunePendingSubscribers(runtime)).toBe(1)
    expect(await prunePendingSubscribers(runtime)).toBe(0)
    expect(await store.lookup("expired-behind@example.com")).toBeNull()
    expect((await database.query("select count(*) from commerce.drop_subscribers")).rows[0].count).toBe("100")
  })
  it("queues a fresh signup if erasure wins between the conflict check and subscriber lock", async () => {
    const old = (
      await database.query<{ id: string }>(`insert into commerce.drop_subscribers(email,source,consent_copy_version)
      values ('race@example.com','footer','v3') returning id`)
    ).rows[0]!.id
    let erased = false
    const racing = new Proxy(runtime, {
      get(target, key) {
        if (key === "connect")
          return async () => {
            const client = await target.connect()
            return new Proxy(client, {
              get(connection, property) {
                if (property === "query")
                  return async (sql: string, values?: unknown[]) => {
                    const result = await connection.query(sql, values)
                    if (!erased && sql.includes("on conflict (email) do nothing")) {
                      erased = true
                      await database.query("delete from commerce.drop_subscribers where id=$1", [old])
                    }
                    return result
                  }
                const value = Reflect.get(connection, property)
                return typeof value === "function" ? value.bind(connection) : value
              },
            })
          }
        const value = Reflect.get(target, key)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    const requestId = await queueSignupConfirmation(racing, {
      email: "race@example.com",
      source: "footer",
      signupIp: null,
      from: "drops@example.com",
      replyTo: "support@example.com",
      siteUrl: "https://shop.example",
    })
    expect(requestId).toEqual(expect.any(String))
    const fresh = (await store.lookup("race@example.com"))!
    expect(fresh.id).not.toBe(old)
    expect(fresh).toMatchObject({ state: "pending", confirmations: 1, eligible: false })
  })
})
