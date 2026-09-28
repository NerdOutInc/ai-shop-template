import { execFileSync } from "node:child_process"
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises"

import { Pool } from "pg"

// Only this disposable local instance is managed here. No linked project or remote credentials are used.
const workdir = ".tmp/admin-e2e"
await mkdir(`${workdir}/supabase`, { recursive: true })
await copyFile("e2e/admin/supabase-config.toml", `${workdir}/supabase/config.toml`)
await copyFile("e2e/admin/email-code.html", `${workdir}/supabase/email-code.html`)
process.stdout.write("Starting isolated local Supabase Auth for browser checks…\n")
execFileSync(
  "supabase",
  [
    "start",
    "--workdir",
    workdir,
    "--exclude",
    "realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
  ],
  { stdio: "pipe", timeout: 180_000 }
)
const status = JSON.parse(
  execFileSync("supabase", ["status", "--workdir", workdir, "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
) as Record<string, string>
const database = new URL(status.DB_URL!)
if (database.hostname !== "127.0.0.1" || database.port !== "58832" || database.pathname !== "/postgres")
  throw new Error("The admin browser fixture must use its dedicated local Supabase database")
const pool = new Pool({ connectionString: status.DB_URL })
try {
  // Reset this fixture's app records, keeping Supabase-owned Auth infrastructure intact.
  const tables = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname='public' and (tablename like 'library_%' or tablename like 'design_%' or tablename='admin_memberships')"
  )
  for (const { tablename } of tables.rows) {
    if (!/^[a-z_]+$/.test(tablename)) throw new Error("Unexpected fixture table name")
    await pool.query(`drop table if exists public.${tablename} cascade`)
  }
  await pool.query("drop schema if exists private cascade; drop schema if exists commerce cascade")
  for (const filename of (await readdir("supabase/migrations")).filter((name) => name.endsWith(".sql")).sort())
    await pool.query(await readFile(`supabase/migrations/${filename}`, "utf8"))
} finally {
  await pool.end()
}
await writeFile(`${workdir}/status.json`, JSON.stringify(status), { mode: 0o600 })
process.stdout.write(
  "Local Auth and application migrations are ready. Fixture credentials stay in .tmp/admin-e2e/status.json.\n"
)
