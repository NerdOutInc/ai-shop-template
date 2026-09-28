import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { test } from "node:test"
import { setTimeout } from "node:timers/promises"
import { prepareSupabasePostgresImage } from "./prepare-supabase-postgres-image.mjs"

// Keep provider defaults intact: applyAllMigrations drops public, which also drops its default ACLs.
// Required in CI; locally opt in with SUPABASE_PRIVILEGES_TEST=true.
// This owns a disposable container with no network or ports.
test(
  "Supabase defaults cannot widen the store's browser permissions",
  { skip: !process.env.CI && process.env.SUPABASE_PRIVILEGES_TEST !== "true", timeout: 420_000 },
  async (t) => {
    const container = `store-privileges-${randomUUID()}`
    const docker = (args, input) =>
      execFileSync("docker", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 120_000 })
    const sql = (input, role = "postgres") =>
      docker(
        ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", role, "-d", "postgres"],
        input
      ).trim()
    const image = prepareSupabasePostgresImage(docker)
    t.after(() => docker(["rm", "--force", "--volumes", container]))
    docker([
      "run",
      "--pull",
      "never",
      "--detach",
      "--name",
      container,
      "--network",
      "none",
      "--env",
      "POSTGRES_PASSWORD=local-disposable-privilege-test",
      image,
    ])
    for (let attempt = 0; ; attempt++) {
      try {
        // The entrypoint's temporary bootstrap server accepts sockets before initialization finishes.
        docker(["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"])
        break
      } catch (error) {
        if (attempt >= 59) throw error
        await setTimeout(500)
      }
    }

    // This image supplies the real database roles/default ACLs and an older Auth bootstrap schema.
    // Supply only the identity columns used by the app; Auth behavior belongs to the admin E2E suite.
    sql(
      `alter table auth.users add column email_confirmed_at timestamptz,
         add column is_anonymous boolean default false, add column banned_until timestamptz;
       create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id), not_after timestamptz);
       grant select on auth.sessions to postgres;`,
      "supabase_admin"
    )
    assert.equal(
      sql(`create table public.before_baseline(id bigint generated always as identity);
        select has_table_privilege('anon', 'public.before_baseline', 'TRUNCATE')
          and has_sequence_privilege('authenticated', 'public.before_baseline_id_seq', 'UPDATE');
        drop table public.before_baseline;`),
      "t",
      "The control must start with Supabase's permissive table and sequence defaults"
    )
    const migrations = await Promise.all(
      (await readdir("supabase/migrations"))
        .filter((name) => name.endsWith(".sql"))
        .sort()
        .map((file) => readFile(`supabase/migrations/${file}`, "utf8"))
    )
    for (const migration of migrations) sql(migration)
    const audit = await readFile("scripts/database/audit-browser-privileges.sql", "utf8")

    await t.test("browser grants match the explicit read and favorite policies", () => {
      const actual = JSON.parse(
        sql(`select coalesce(json_agg(x order by role_name, table_name, privilege), '[]') from (
          select role_name, n.nspname || '.' || c.relname as table_name, privilege
          from pg_class c join pg_namespace n on n.oid=c.relnamespace
          cross join unnest(array['anon','authenticated']) role_name
          cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) privilege
          where n.nspname in ('public','private','commerce') and c.relkind in ('r','v')
            and has_table_privilege(role_name,c.oid,privilege)
        ) x;`)
      )
      const readable = [
        "admin_memberships",
        "design_generation_batches",
        "design_generation_candidates",
        "design_generation_slots",
        "library_artwork_revisions",
        "library_collection_designs",
        "library_collections",
        "library_design_colors",
        "library_designs",
        "library_favorites",
        "library_product_bindings",
      ]
      const expected = readable.flatMap((table) =>
        (table === "library_favorites" ? ["DELETE", "INSERT", "SELECT", "UPDATE"] : ["SELECT"]).map((privilege) => ({
          role_name: "authenticated",
          table_name: `public.${table}`,
          privilege,
        }))
      )
      assert.deepEqual(actual, expected)
      assert.equal(
        sql(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
          cross join unnest(array['anon','authenticated']) role_name
          where n.nspname in ('public','private','commerce') and c.relkind='S'
            and has_sequence_privilege(role_name,c.oid,'USAGE,SELECT,UPDATE');`),
        "0"
      )
    })

    await t.test("the operator audit detects table and sequence privilege regressions", () => {
      assert.equal(sql(audit), "")
      const rows = sql(`begin;
        grant all on public.library_designs to anon;
        grant truncate, update, delete on public.admin_memberships to authenticated;
        grant usage, update on sequence public.library_designs_display_number_seq to anon;
        ${audit}
        rollback;`)
      assert.match(rows, /anon\|public\.library_designs\|TRUNCATE/)
      assert.match(rows, /authenticated\|public\.admin_memberships\|DELETE/)
      assert.match(rows, /anon\|public\.library_designs_display_number_seq\|UPDATE/)
      assert.equal(sql(audit), "")
    })

    await t.test("RLS cannot be bypassed by truncation or sequence mutation", () => {
      for (const role of ["anon", "authenticated"]) {
        for (const operation of [
          "truncate public.library_favorites",
          "select setval('public.library_designs_display_number_seq', 9000)",
          "select * from public.library_assets",
          "select * from private.auth_user_identity",
          "select private.claim_admin_owner(gen_random_uuid(),'owner@example.test')",
          "update public.admin_memberships set active=true",
        ]) {
          assert.throws(() => sql(`begin; set local role ${role}; ${operation}; rollback;`), /permission denied/)
        }
      }
    })

    await t.test("new tables and sequences require explicit browser grants", () => {
      sql("create table public.after_baseline(id bigint generated always as identity)")
      for (const role of ["anon", "authenticated"]) {
        assert.equal(
          sql(
            `select has_table_privilege('${role}', 'public.after_baseline', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')`
          ),
          "f"
        )
        assert.equal(
          sql(`select has_sequence_privilege('${role}', 'public.after_baseline_id_seq', 'USAGE,SELECT,UPDATE')`),
          "f"
        )
        assert.throws(() => sql(`set role ${role}; select * from public.after_baseline`), /permission denied/)
      }
      sql("drop table public.after_baseline")
    })

    await t.test("authenticated admin reads and own favorites remain usable and revocable", () => {
      const owner = randomUUID(),
        other = randomUUID(),
        design = randomUUID(),
        revision = randomUUID()
      sql(`insert into auth.users(id,email,email_confirmed_at) values
        ('${owner}','owner@example.test',now()),('${other}','other@example.test',now());
        insert into public.admin_memberships(user_id) values ('${owner}');`)
      sql(
        `set role store_app_runtime;
        insert into public.library_designs(id,canonical_design_id,title) values ('${design}','${design}','Local test');
        insert into public.library_artwork_revisions(id,design_id,print_readiness) values ('${revision}','${design}','unverified');`,
        "supabase_admin"
      )
      const asUser = (user, operation) =>
        sql(`begin; set local role authenticated;
        set local request.jwt.claim.sub='${user}'; ${operation}; rollback;`)
      assert.equal(asUser(other, "select count(*) from public.library_designs"), "0")
      assert.equal(asUser(other, "select count(*) from public.admin_memberships"), "0")
      assert.equal(asUser(owner, "select count(*) from public.library_designs"), "1")
      assert.equal(asUser(owner, "select count(*) from public.admin_memberships"), "1")
      sql(`set role authenticated; set request.jwt.claim.sub='${owner}';
        insert into public.library_favorites(user_id,design_id,revision_id) values ('${owner}','${design}','${revision}');
        update public.library_favorites set color_name='Black';`)
      assert.equal(asUser(owner, "select color_name from public.library_favorites"), "Black")
      assert.equal(asUser(other, "select count(*) from public.library_favorites"), "0")
      assert.throws(() => asUser(owner, `update public.library_favorites set user_id='${other}'`), /row-level security/)
      assert.equal(asUser(owner, "delete from public.library_favorites returning color_name"), "Black")
      sql(`update public.admin_memberships set active=false where user_id='${owner}'`)
      assert.equal(asUser(owner, "select count(*) from public.library_designs"), "0")
      assert.equal(asUser(owner, "select count(*) from public.library_favorites"), "0")
      assert.equal(
        asUser(
          owner,
          "with removed as (delete from public.library_favorites returning *) select count(*) from removed"
        ),
        "0"
      )
      assert.throws(
        () =>
          asUser(
            owner,
            `insert into public.library_favorites(user_id,design_id,revision_id) values ('${owner}','${design}','${revision}')`
          ),
        /row-level security/
      )
    })
    await t.test("explicit revokes remove global grants that schema defaults cannot revoke", () => {
      sql(`drop schema private cascade; drop schema commerce cascade;
        drop schema public cascade; create schema public;
        grant usage on schema public to anon, authenticated, service_role;
        alter default privileges grant all on tables to anon, authenticated;
        alter default privileges grant all on sequences to anon, authenticated;
        create table public.global_control(id bigint generated always as identity);`)
      assert.equal(
        sql(`select has_table_privilege('anon','public.global_control','TRUNCATE')
        and has_sequence_privilege('authenticated','public.global_control_id_seq','UPDATE');`),
        "t"
      )
      sql("drop table public.global_control")
      for (const migration of migrations) sql(migration)
      assert.equal(sql(audit), "", "Existing objects must lose grants inherited from global defaults")
    })
  }
)
