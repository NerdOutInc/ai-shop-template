import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { checkMigrationHistory } from "./check-migration-history.mjs"

const old = `${"20260901000000"}_baseline.sql`
const next = `${"20260902000000"}_new_feature.sql`
const migrationPath = (name) => `supabase/migrations/${name}`
function fixture(t, receipt = false) {
  const root = mkdtempSync(join(tmpdir(), "migration-history-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
  const write = (name, bytes) => {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), bytes)
  }
  git("init", "--quiet")
  git("config", "user.name", "Fixture")
  git("config", "user.email", "fixture@example.test")
  write(migrationPath(old), "select 1;\n")
  const entry = {
    canonicalFilename: `${"20260801000000"}_upstream.sql`,
    canonicalSha256: "a".repeat(64),
    templateCommit: "b".repeat(40),
    localFilename: next,
    localSha256: createHash("sha256").update("select 2;").digest("hex"),
    reason: "Reviewed forward port",
  }
  if (receipt) {
    write(migrationPath(next), "select 2;")
    write("docs/store-update-ledger.json", JSON.stringify({ schemaVersion: 1, migrationMappings: [entry] }))
  }
  git("add", ".")
  git("commit", "--quiet", "-m", "Existing migrations")
  return { root, git, write, base: git("rev-parse", "HEAD"), entry }
}

test("allows forward additions and an explicitly empty initial history", (t) => {
  const { root, base, write } = fixture(t)
  write(migrationPath(next), "select 2;")
  assert.deepEqual(checkMigrationHistory(root, base), [])
  assert.deepEqual(checkMigrationHistory(root, "0".repeat(40)), [])
})

test("rejects working edits, staged edits hidden by restoration, deletion, renaming and symlinks", (t) => {
  const { root, base, git, write } = fixture(t)
  write(migrationPath(old), "select 3;")
  assert.ok(checkMigrationHistory(root, base).some((error) => error.includes("bytes changed")))
  git("add", ".")
  write(migrationPath(old), "select 1;\n")
  assert.ok(checkMigrationHistory(root, base).some((error) => error.includes("index")))
  git("reset", "--quiet", base)
  renameSync(join(root, migrationPath(old)), join(root, migrationPath(next)))
  assert.ok(checkMigrationHistory(root, base).some((error) => error.includes("removed, renamed")))
  rmSync(join(root, migrationPath(next)))
  write("external.sql", "select 1;\n")
  symlinkSync(join(root, "external.sql"), join(root, migrationPath(old)))
  assert.ok(checkMigrationHistory(root, base).some((error) => error.includes("replaced")))
})

test("rejects backdated additions and duplicate timestamp versions", (t) => {
  const { root, base, write } = fixture(t)
  write(migrationPath(`${"20260801000000"}_earlier.sql`), "select 2;")
  write(migrationPath(`${"20260901000000"}_collision.sql`), "select 3;")
  const errors = checkMigrationHistory(root, base)
  assert.ok(errors.some((error) => error.includes("must follow")))
  assert.ok(errors.some((error) => error.includes("duplicate migration timestamp")))
})

test("new staged migrations cannot hide a backdated version by disappearing from the worktree", (t) => {
  const { root, base, write, git } = fixture(t)
  const file = migrationPath(`${"20260801000000"}_staged_only.sql`)
  write(file, "select 3;")
  git("add", file)
  rmSync(join(root, file))
  assert.ok(checkMigrationHistory(root, base).some((error) => error.includes("new staged migration must follow")))
})

test("merged mappings are append-only, including the reviewed checksums and reason", (t) => {
  const { root, base, git, write, entry } = fixture(t, true)
  assert.deepEqual(checkMigrationHistory(root, base), [])
  for (const migrationMappings of [[], [{ ...entry, reason: "Changed without a new receipt" }]]) {
    write("docs/store-update-ledger.json", JSON.stringify({ schemaVersion: 1, migrationMappings }))
    assert.ok(checkMigrationHistory(root, base).some((error) => error.includes("mapping changed or removed")))
  }
  git("add", "docs/store-update-ledger.json")
  write("docs/store-update-ledger.json", JSON.stringify({ schemaVersion: 1, migrationMappings: [entry] }))
  assert.ok(checkMigrationHistory(root, base).some((error) => error.includes("(index)")))
})

test("missing history fails closed in the API and CLI", (t) => {
  const { root } = fixture(t)
  assert.ok(checkMigrationHistory(root, "missing-ref").some((error) => error.includes("unavailable")))
  const script = fileURLToPath(new URL("./check-migration-history.mjs", import.meta.url))
  const result = spawnSync(process.execPath, [script, "--base", "missing-ref"], { cwd: root, encoding: "utf8" })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /unavailable/)
})
