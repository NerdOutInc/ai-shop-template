import assert from "node:assert/strict"
import { test } from "node:test"

import { applyAllMigrations } from "../../test/apply-all-migrations.ts"
import { createAdminDatabaseFixture } from "../../test/create-admin-database-fixture.ts"

const connectionString = process.env.TEMPLATE_TEST_DATABASE_URL

test(
  "fresh migrations start empty and only the server role can access a new shop",
  { skip: !connectionString },
  async () => {
    const url = new URL(connectionString)
    assert.equal(url.pathname, "/store_template_test", "Use the isolated template test database")
    const pool = await createAdminDatabaseFixture(connectionString)
    try {
      await applyAllMigrations(pool)
      const applicationTables = await pool.query(`
        select format('%I.%I', n.nspname, c.relname) as qualified_name
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public', 'private', 'commerce') and c.relkind in ('r', 'p')
          and not (n.nspname = 'private' and c.relname = 'admin_setup_state')
        order by n.nspname, c.relname
      `)
      assert.ok(applicationTables.rows.length > 0, "Fresh migrations must create application tables")
      for (const { qualified_name: table } of applicationTables.rows) {
        const result = await pool.query(`select count(*)::integer as count from ${table}`)
        assert.equal(result.rows[0].count, 0, `${table} must start empty`)
      }
      const setup = await pool.query("select singleton, consumed_at, claimed_by from private.admin_setup_state")
      assert.deepEqual(setup.rows, [{ singleton: true, consumed_at: null, claimed_by: null }])
      const unsecured = await pool.query(
        "select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('commerce','private','public') and c.relkind='r' and not c.relrowsecurity"
      )
      assert.deepEqual(unsecured.rows, [], "Every application table must enforce row security")
      const client = await pool.connect()
      try {
        await client.query("set role store_app_runtime")
        await client.query(
          "insert into commerce.printify_products (shop_id,product_id,snapshot,active) values ($1,$2,$3::jsonb,false)",
          ["987654321", "000000000000000000000099", JSON.stringify({ id: "000000000000000000000099" })]
        )
        const result = await client.query("select shop_id from commerce.printify_products where shop_id=$1", [
          "987654321",
        ])
        assert.deepEqual(result.rows, [{ shop_id: "987654321" }])
        await client.query("reset role")
        for (const role of ["anon", "authenticated"]) {
          const membership = await client.query("select pg_has_role($1, 'store_app_runtime', 'member') as member", [
            role,
          ])
          assert.equal(membership.rows[0].member, false)
          await client.query(`set role ${role}`)
          await assert.rejects(client.query("select * from commerce.printify_products"), { code: "42501" })
          await client.query("reset role")
        }
      } finally {
        await client.query("reset role")
        client.release()
      }
    } finally {
      await pool.end()
    }
  }
)
