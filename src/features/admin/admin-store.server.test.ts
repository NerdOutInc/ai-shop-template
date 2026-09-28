// @vitest-environment node
import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import type { Pool } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { applyAllMigrations } from "../../../test/apply-all-migrations"
import { createAdminDatabaseFixture } from "../../../test/create-admin-database-fixture"
import { createRuntimeLoginPool } from "../../../test/create-runtime-login-pool"
import { AdminStore } from "./admin-store.server"

vi.mock("server-only", () => ({}))
const databaseUrl = process.env.ADMIN_TEST_DATABASE_URL

describe.skipIf(!databaseUrl)("admin bootstrap and membership database boundaries", () => {
  let database: Pool
  let runtime: Pool
  let store: AdminStore
  let ownerId: string
  let otherId: string

  beforeAll(async () => {
    database = await createAdminDatabaseFixture(databaseUrl!)
    await database.query("alter table auth.users add column if not exists encrypted_password text")
    await applyAllMigrations(database)
    // The store runs as the production login so privileges and policies are real, not superuser defaults.
    runtime = await createRuntimeLoginPool(database, databaseUrl!)
    store = new AdminStore(runtime)
  })
  afterAll(async () => {
    await runtime?.end()
    await database?.end()
  })
  beforeEach(async () => {
    await database.query(
      "truncate public.admin_memberships, private.admin_auth_attempts; update private.admin_setup_state set consumed_at = null, claimed_by = null, enrollment_user_id = null, enrollment_email = null"
    )
    ownerId = (await store.reserveOwner("owner@example.test"))!
    otherId = randomUUID()
    await database.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'owner@example.test',now()),($2,'other@example.test',now())",
      [ownerId, otherId]
    )
  })

  it("pins one identity across concurrent retries and never reopens consumed setup", async () => {
    const reservations = await Promise.all(Array.from({ length: 8 }, () => store.reserveOwner("OWNER@example.test")))
    expect(new Set(reservations)).toEqual(new Set([ownerId]))
    expect(await store.ownerEnrollment("owner@example.test")).toBe(ownerId)
    expect(await store.ownerEnrollment("other@example.test")).toBeNull()
    expect(await store.claimOwner(ownerId, "owner@example.test")).toBe(true)
    expect(await store.reserveOwner("owner@example.test")).toBeNull()
    expect(await store.ownerEnrollment("owner@example.test")).toBeNull()
  })

  it("rotates an unclaimed reservation after a corrected owner email and rejects the abandoned identity", async () => {
    const correctedId = await store.reserveOwner("corrected@example.test")
    expect(correctedId).not.toBeNull()
    expect(correctedId).not.toBe(ownerId)
    expect(await store.ownerEnrollment("owner@example.test")).toBeNull()
    expect(await store.ownerEnrollment("corrected@example.test")).toBe(correctedId)
    expect(await store.claimOwner(ownerId, "owner@example.test")).toBe(false)
    // Even changing the abandoned account's email cannot make it the current reserved identity.
    await database.query("update auth.users set email='corrected@example.test' where id=$1", [ownerId])
    expect(await store.claimOwner(ownerId, "corrected@example.test")).toBe(false)
    await database.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'corrected@example.test',now())",
      [correctedId]
    )
    expect(await store.claimOwner(correctedId!, "corrected@example.test")).toBe(true)
    expect(await store.reserveOwner("owner@example.test")).toBeNull()
    expect(await store.isActiveMember(ownerId)).toBe(false)
  })

  it("serializes an email correction against an in-flight claim", async () => {
    const [claimed, replacement] = await Promise.all([
      store.claimOwner(ownerId, "owner@example.test"),
      store.reserveOwner("corrected@example.test"),
    ])
    if (claimed) {
      expect(replacement).toBeNull()
      expect(await store.setupStatus()).toBe("claimed")
    } else {
      expect(replacement).not.toBeNull()
      expect(await store.claimOwner(ownerId, "owner@example.test")).toBe(false)
      expect(await store.setupStatus()).toBe("available")
    }
  })

  it("fails setup status before displaying a form when the enrollment migration is missing", async () => {
    await database.query("alter table private.admin_setup_state rename column enrollment_email to old_enrollment_email")
    try {
      await expect(store.setupStatus()).rejects.toMatchObject({ code: "42703" })
    } finally {
      await database.query(
        "alter table private.admin_setup_state rename column old_enrollment_email to enrollment_email"
      )
    }
  })

  it("reports claim provenance without treating empty state or password presence as proof of ownership", async () => {
    const sql = await readFile("scripts/database/inspect-owner-enrollment.sql", "utf8")
    const inspect = async () => (await database.query(sql)).rows[0]
    await database.query("update private.admin_setup_state set enrollment_user_id=null,enrollment_email=null")
    expect(await inspect()).toEqual({
      claim_method: "unclaimed",
      owner_account_present: null,
      owner_has_password: null,
    })
    // A dashboard claim consumes setup but supplies no reserved-enrollment proof.
    await database.query("insert into public.admin_memberships(user_id,active) values($1,true)", [ownerId])
    expect(await inspect()).toEqual({
      claim_method: "owner-review",
      owner_account_present: true,
      owner_has_password: false,
    })
    await database.query("update auth.users set encrypted_password='private-fixture-hash' where id=$1", [ownerId])
    expect(await inspect()).toEqual({
      claim_method: "owner-review",
      owner_account_present: true,
      owner_has_password: true,
    })
    // New Admin API accounts have random passwords too; the hash flag alone is not a vulnerability.
    await database.query(
      "update private.admin_setup_state set enrollment_user_id=$1,enrollment_email='owner@example.test'",
      [ownerId]
    )
    expect(await inspect()).toEqual({
      claim_method: "reserved-enrollment",
      owner_account_present: true,
      owner_has_password: true,
    })
    expect(JSON.stringify(await inspect())).not.toMatch(/private-fixture|example\.test/)
  })

  it("refuses a previously verified account with the right email but no enrollment", async () => {
    await database.query("update private.admin_setup_state set enrollment_user_id=null,enrollment_email=null")
    expect(await store.claimOwner(ownerId, "owner@example.test")).toBe(false)
    expect(await store.isActiveMember(ownerId)).toBe(false)
    expect(await store.setupStatus()).toBe("available")
  })

  it("refuses another account with the exact owner email instead of replacing the reserved identity", async () => {
    await database.query("update auth.users set email='owner@example.test' where id=$1", [otherId])
    expect(await store.claimOwner(otherId, "owner@example.test")).toBe(false)
    expect(await store.isActiveMember(otherId)).toBe(false)
    expect(await store.ownerEnrollment("owner@example.test")).toBe(ownerId)
  })

  it("allows the confirmed configured owner once and never reopens after removal", async () => {
    expect(await store.setupStatus()).toBe("available")
    expect(await store.claimOwner(ownerId, "owner@example.test")).toBe(true)
    expect(await store.setupStatus()).toBe("claimed")
    expect(await store.isActiveMember(ownerId)).toBe(true)
    await database.query("delete from public.admin_memberships")
    expect(await store.setupStatus()).toBe("recovery")
    expect(await store.claimOwner(ownerId, "owner@example.test")).toBe(false)
  })

  it("rejects a verified stranger, unconfirmed owner, anonymous owner and banned owner", async () => {
    expect(await store.claimOwner(otherId, "owner@example.test")).toBe(false)
    await database.query("update auth.users set email_confirmed_at=null where id=$1", [ownerId])
    expect(await store.claimOwner(ownerId, "owner@example.test")).toBe(false)
    await database.query("update auth.users set email_confirmed_at=now(), is_anonymous=true where id=$1", [ownerId])
    expect(await store.claimOwner(ownerId, "owner@example.test")).toBe(false)
    await database.query("update auth.users set is_anonymous=false, banned_until=now()+interval '1 day' where id=$1", [
      ownerId,
    ])
    expect(await store.claimOwner(ownerId, "owner@example.test")).toBe(false)
    expect(await store.setupStatus()).toBe("available")
  })

  it("serializes simultaneous claims so exactly one consumes setup", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => store.claimOwner(ownerId, "owner@example.test")))
    expect(results.filter(Boolean)).toHaveLength(1)
    expect((await database.query("select count(*)::int as count from public.admin_memberships")).rows[0].count).toBe(1)
  })

  it("rechecks after a concurrent dashboard insert instead of creating another first admin", async () => {
    const dashboard = await database.connect()
    try {
      await dashboard.query("begin")
      await dashboard.query("insert into public.admin_memberships(user_id) values($1)", [otherId])
      const claim = store.claimOwner(ownerId, "owner@example.test")
      await dashboard.query("commit")
      expect(await claim).toBe(false)
      expect(await store.isActiveMember(ownerId)).toBe(false)
    } finally {
      await dashboard.query("rollback")
      dashboard.release()
    }
  })

  it("immediately enforces checkbox revocation", async () => {
    await store.claimOwner(ownerId, "owner@example.test")
    await database.query("update public.admin_memberships set active=false where user_id=$1", [ownerId])
    expect(await store.isActiveMember(ownerId)).toBe(false)
    expect(await store.setupStatus()).toBe("recovery")
  })

  it.each([
    ["unconfirmed", "email_confirmed_at=null"],
    ["anonymous", "is_anonymous=true"],
    ["banned", "banned_until=now()+interval '1 day'"],
  ])(
    "rejects a currently %s Auth identity despite active membership and an existing JWT subject",
    async (_name, update) => {
      await store.claimOwner(ownerId, "owner@example.test")
      const client = await database.connect()
      try {
        await client.query("begin")
        await client.query("set local role authenticated")
        await client.query("select set_config('request.jwt.claim.sub',$1,true)", [ownerId])
        expect((await client.query("select private.is_active_admin() as allowed")).rows[0].allowed).toBe(true)
        await database.query(`update auth.users set ${update} where id=$1`, [ownerId])
        expect(await store.isActiveMember(ownerId)).toBe(false)
        expect((await client.query("select private.is_active_admin() as allowed")).rows[0].allowed).toBe(false)
        expect(
          (await database.query("select active from public.admin_memberships where user_id=$1", [ownerId])).rows[0]
            .active
        ).toBe(true)
      } finally {
        await client.query("rollback")
        client.release()
      }
    }
  )

  it("keeps the privileged Auth lookup private, identity-bound, and unavailable to anonymous roles", async () => {
    const functionState = (
      await database.query(
        `select prosecdef,proconfig,pronargs,
        has_function_privilege('anon',oid,'EXECUTE') as anonymous,
        has_function_privilege('authenticated',oid,'EXECUTE') as authenticated
       from pg_proc where oid='private.is_active_admin()'::regprocedure`
      )
    ).rows[0]
    expect(functionState).toMatchObject({ prosecdef: true, pronargs: 0, anonymous: false, authenticated: true })
    expect(functionState.proconfig).toContain('search_path=""')
    const client = await database.connect()
    try {
      await client.query("begin")
      await client.query("set local role authenticated")
      expect((await client.query("select private.is_active_admin() as allowed")).rows[0].allowed).toBe(false)
      await expect(client.query("select * from auth.users")).rejects.toMatchObject({ code: "42501" })
    } finally {
      await client.query("rollback")
      client.release()
    }
  })

  it.each([true, false])(
    "permanently consumes setup when the dashboard first activates an admin: %s",
    async (active) => {
      await database.query("insert into public.admin_memberships(user_id,active) values($1,$2)", [otherId, active])
      if (!active) {
        expect(await store.setupStatus()).toBe("available")
        await database.query("update public.admin_memberships set active=true where user_id=$1", [otherId])
      }
      expect(await store.setupStatus()).toBe("claimed")
      await database.query("delete from public.admin_memberships")
      expect(await store.setupStatus()).toBe("recovery")
      expect(await store.claimOwner(ownerId, "owner@example.test")).toBe(false)
    }
  )

  it("only exposes the current user's membership and helper result through RLS", async () => {
    await store.claimOwner(ownerId, "owner@example.test")
    const client = await database.connect()
    try {
      await client.query("begin")
      await client.query("set local role authenticated")
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [otherId])
      expect((await client.query("select * from public.admin_memberships")).rows).toEqual([])
      expect((await client.query("select private.is_active_admin() as allowed")).rows[0].allowed).toBe(false)
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [ownerId])
      expect((await client.query("select * from public.admin_memberships")).rows).toHaveLength(1)
      expect((await client.query("select private.is_active_admin() as allowed")).rows[0].allowed).toBe(true)
    } finally {
      await client.query("rollback")
      client.release()
    }
  })

  it.each([
    "insert into public.admin_memberships(user_id) values(gen_random_uuid())",
    "update public.admin_memberships set active=true",
    "delete from public.admin_memberships",
    "select * from private.admin_setup_state",
    "select private.claim_admin_owner(gen_random_uuid(),'owner@example.test')",
  ])("denies browser elevation or bootstrap access: %s", async (sql) => {
    const client = await database.connect()
    try {
      await client.query("begin")
      await client.query("set local role authenticated")
      await expect(client.query(sql)).rejects.toMatchObject({ code: "42501" })
    } finally {
      await client.query("rollback")
      client.release()
    }
  })

  it("limits concurrent source attempts without storing the raw source", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => store.allowAuthAttempt("send:192.0.2.1")))
    expect(results.filter(Boolean)).toHaveLength(5)
    const row = (await database.query("select * from private.admin_auth_attempts")).rows[0]
    expect(row.subject_hash).toMatch(/^[a-f0-9]{64}$/)
    await database.query("update private.admin_auth_attempts set window_start=now()-interval '16 minutes'")
    expect(await store.allowAuthAttempt("send:192.0.2.1")).toBe(true)
  })
  it("bounds stale-row cleanup, preserves fresh buckets, and resets an expired current bucket", async () => {
    const subject = "send:192.0.2.1"
    const key = createHash("sha256").update(subject).digest("hex")
    await database.query(`insert into private.admin_auth_attempts(subject_hash, window_start, attempts)
      select 'expired-' || number, now()-interval '2 days', 5 from generate_series(1, 150) number`)
    await database.query(
      `insert into private.admin_auth_attempts(subject_hash, window_start, attempts)
      values ($1, now()-interval '2 days', 5), ('fresh', now(), 3)`,
      [key]
    )
    expect(await store.allowAuthAttempt(subject)).toBe(true)
    expect(
      (
        await database.query(
          "select count(*)::int as count from private.admin_auth_attempts where subject_hash like 'expired-%'"
        )
      ).rows[0].count
    ).toBe(50)
    expect(
      (await database.query("select attempts from private.admin_auth_attempts where subject_hash=$1", [key])).rows[0]
        .attempts
    ).toBe(1)
    expect(
      (await database.query("select attempts from private.admin_auth_attempts where subject_hash='fresh'")).rows[0]
        .attempts
    ).toBe(3)
    await store.allowAuthAttempt(subject)
    expect(
      (
        await database.query(
          "select count(*)::int as count from private.admin_auth_attempts where subject_hash like 'expired-%'"
        )
      ).rows[0].count
    ).toBe(0)
  })

  it("keeps concurrent source caps exact while expired rows are cleaned", async () => {
    await database.query(`insert into private.admin_auth_attempts(subject_hash, window_start, attempts)
      select 'expired-' || number, now()-interval '2 days', 5 from generate_series(1, 150) number`)
    const results = await Promise.all(
      Array.from({ length: 24 }, () => store.allowAuthAttempt("verify-source:192.0.2.1", 20))
    )
    expect(results.filter(Boolean)).toHaveLength(20)
    expect(
      (
        await database.query(
          "select count(*)::int as count from private.admin_auth_attempts where subject_hash like 'expired-%'"
        )
      ).rows[0].count
    ).toBe(0)
  })

  it("gives the restricted login read access and a policy on every application table", async () => {
    const tables = await database.query<{ name: string; readable: boolean; policies: number }>(
      `select n.nspname || '.' || c.relname as name,
         has_table_privilege('store_app_runtime', c.oid, 'select') as readable,
         (select count(*)::int from pg_policies p
            where p.schemaname = n.nspname and p.tablename = c.relname and 'store_app_runtime' = any(p.roles)) as policies
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r' and n.nspname in ('public', 'private', 'commerce') order by 1`
    )
    expect(tables.rows.length).toBeGreaterThan(30)
    expect(tables.rows.filter((row) => !row.readable || row.policies === 0).map((row) => row.name)).toEqual([])
  })

  it("keeps the restricted login out of Supabase identity tables and membership removal", async () => {
    await expect(runtime.query("select id from auth.users limit 1")).rejects.toThrow(/permission denied/)
    await expect(runtime.query("delete from public.admin_memberships")).rejects.toThrow(/permission denied/)
    expect((await runtime.query("select id from private.auth_user_identity where id=$1", [ownerId])).rowCount).toBe(1)
  })
})
