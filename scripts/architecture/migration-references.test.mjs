import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { checkMigrationReferences } from "../check-migration-references.mjs"

// Build fixture names so this test does not itself reference nonexistent repository migrations.
const original = `${"20260908000000"}_checkout_orders.sql`
const renamed = `${"20260908015255"}_checkout_orders.sql`
const migrationPath = (filename) => `supabase/migrations/${filename}`

function write(root, filename, contents) {
  const target = path.join(root, filename)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, contents)
}

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "store-migration-references-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  execFileSync("git", ["init", "--quiet"], { cwd: root })
  for (const [filename, contents] of Object.entries(files)) write(root, filename, contents)
  execFileSync("git", ["add", "."], { cwd: root })
  return root
}

test("accepts root-relative reads, bare filenames, and resolved Markdown links", (t) => {
  const root = fixture(t, {
    [migrationPath(original)]: "select 1;",
    "src/order-store.test.ts": `readFile("${migrationPath(original)}", "utf8")\nconst migrations = ["${original}"]`,
    "docs/setup.md": `[Apply](../${migrationPath(original)})\n[Root](/${migrationPath(original)})\n[Apply][migration]\n[migration]: <../${migrationPath(original)}> "Checkout schema"`,
    ".env.example": `# Apply ${migrationPath(original)}`,
    ".agents/skills/setup/SKILL.md": `[Apply](../../../${migrationPath(original)})`,
  })
  assert.deepEqual(checkMigrationReferences(root), [])
})

test("a rename fails both tests and owner docs until their references are updated", (t) => {
  const references = {
    "src/order-store.test.ts": `const migrations = [\n  "${original}"\n]`,
    "e2e/publishing.spec.ts": `readFile("${migrationPath(original)}", "utf8")`,
    "docs/setup.md": `# Setup\n\n[Apply](../${migrationPath(original)})`,
  }
  const root = fixture(t, { [migrationPath(original)]: "select 1;", ...references })
  fs.renameSync(path.join(root, migrationPath(original)), path.join(root, migrationPath(renamed)))
  const errors = checkMigrationReferences(root)
  assert.ok(errors.some((error) => error.startsWith("src/order-store.test.ts:2: missing migration")))
  assert.ok(errors.some((error) => error.startsWith("e2e/publishing.spec.ts:1: missing migration")))
  assert.ok(errors.some((error) => error.startsWith("docs/setup.md:3: missing migration")))
  for (const [filename, contents] of Object.entries(references))
    write(root, filename, contents.replaceAll(original, renamed))
  assert.deepEqual(checkMigrationReferences(root), [])
})

test("checks actual Markdown link depth even when the migration basename exists", (t) => {
  const root = fixture(t, {
    [migrationPath(original)]: "select 1;",
    ".agents/skills/setup/SKILL.md": `[Apply](../../${migrationPath(original)})`,
    "docs/setup.md": `[migration]: ${migrationPath(original)}`,
  })
  assert.deepEqual(checkMigrationReferences(root), [
    `.agents/skills/setup/SKILL.md:1: broken migration link ../../${migrationPath(original)}`,
    `docs/setup.md:1: broken migration link ${migrationPath(original)}`,
  ])
})

test("includes hidden and nonignored untracked text without inspecting ignored files or artwork", (t) => {
  const root = fixture(t, { ".gitignore": "ignored/\n", "docs/tracked.md": original })
  write(root, ".agents/skills/setup/SKILL.md", original)
  write(root, ".env.example", original)
  write(root, "ignored/draft.md", original)
  write(root, "assets/artwork.png", original)
  write(root, "docs/binary.txt", `\0${original}`)
  assert.deepEqual(checkMigrationReferences(root), [
    `.agents/skills/setup/SKILL.md:1: missing migration ${migrationPath(original)}`,
    `.env.example:1: missing migration ${migrationPath(original)}`,
    `docs/tracked.md:1: missing migration ${migrationPath(original)}`,
  ])
})

test("historical version timestamps in prose do not reference files", (t) => {
  const root = fixture(t, {
    "docs/history.md": "The recorded remote version was `20260908000000`; the new version is `20260908015255`.",
  })
  assert.deepEqual(checkMigrationReferences(root), [])
})

test("a migration target must be a regular file", (t) => {
  const root = fixture(t, { "docs/setup.md": original })
  fs.mkdirSync(path.join(root, migrationPath(original)), { recursive: true })
  assert.deepEqual(checkMigrationReferences(root), [`docs/setup.md:1: missing migration ${migrationPath(original)}`])
})

test("CLI fails with source locations and succeeds after repairing the reference", (t) => {
  const root = fixture(t, { "docs/setup.md": `# Setup\n${original}` })
  const script = fileURLToPath(new URL("../check-migration-references.mjs", import.meta.url))
  const broken = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" })
  assert.equal(broken.status, 1)
  assert.equal(broken.stderr, `docs/setup.md:2: missing migration ${migrationPath(original)}\n`)
  write(root, migrationPath(original), "select 1;")
  const repaired = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" })
  assert.equal(repaired.status, 0)
  assert.equal(repaired.stdout, "Migration reference checks passed.\n")
  assert.equal(repaired.stderr, "")
})

test("canonical names and correctly resolved links accept a checksummed forward-port receipt", async (t) => {
  const { createHash } = await import("node:crypto")
  const sql = "select 2;"
  const hash = createHash("sha256").update(sql).digest("hex")
  const entry = {
    canonicalFilename: original,
    canonicalSha256: "a".repeat(64),
    templateCommit: "b".repeat(40),
    localFilename: renamed,
    localSha256: hash,
    reason: "Receiving store already has a later migration.",
  }
  const root = fixture(t, {
    [migrationPath(renamed)]: sql,
    "docs/store-update-ledger.json": JSON.stringify({ schemaVersion: 1, migrationMappings: [entry] }),
    "docs/setup.md": `${original}\n[Apply](../${migrationPath(original)})\n[Root](/${migrationPath(original)})`,
    ".agents/skills/setup/SKILL.md": `[Apply](../../../${migrationPath(original)})`,
  })
  assert.deepEqual(checkMigrationReferences(root), [])
  write(root, "docs/setup.md", `[Wrong depth](${migrationPath(original)})`)
  assert.ok(checkMigrationReferences(root).some((error) => error.includes("broken migration link")))
  write(root, migrationPath(renamed), "select 3;")
  assert.ok(checkMigrationReferences(root).some((error) => error.includes("checksum mismatch")))
  assert.ok(checkMigrationReferences(root).some((error) => error.includes("missing migration")))
})

test("invalid, duplicate, chained, unsafe and missing migration receipts fail closed", async (t) => {
  const { createHash } = await import("node:crypto")
  const sql = "select 2;"
  const entry = {
    canonicalFilename: original,
    canonicalSha256: "a".repeat(64),
    templateCommit: "b".repeat(40),
    localFilename: renamed,
    localSha256: createHash("sha256").update(sql).digest("hex"),
    reason: "Reviewed forward port",
  }
  const root = fixture(t, { [migrationPath(renamed)]: sql, "docs/setup.md": original })
  const ledger = (items) =>
    write(root, "docs/store-update-ledger.json", JSON.stringify({ schemaVersion: 1, migrationMappings: items }))
  for (const bad of [
    { ...entry, canonicalSha256: "short" },
    { ...entry, templateCommit: "main" },
    { ...entry, reason: "" },
    { ...entry, localFilename: `../${renamed}` },
    { ...entry, canonicalFilename: [original] },
    { ...entry, localFilename: original },
  ]) {
    ledger([bad])
    const errors = checkMigrationReferences(root)
    assert.ok(errors.some((error) => error.startsWith("docs/store-update-ledger.json:")))
    assert.ok(errors.some((error) => error.includes("missing migration")))
  }
  ledger([entry, entry])
  assert.ok(checkMigrationReferences(root).some((error) => error.includes("duplicate")))
  ledger([entry, { ...entry, canonicalFilename: renamed, localFilename: original }])
  assert.ok(checkMigrationReferences(root).some((error) => error.includes("chains or cycles")))
  ledger([entry])
  fs.unlinkSync(path.join(root, migrationPath(renamed)))
  assert.ok(checkMigrationReferences(root).some((error) => error.includes("ordinary file")))
  write(root, "docs/store-update-ledger.json", "{")
  assert.ok(checkMigrationReferences(root).some((error) => error.includes("ordinary JSON")))
})

test("mapped migration symlinks and coexisting canonical files are rejected", async (t) => {
  const { createHash } = await import("node:crypto")
  const sql = "select 1;"
  const entry = {
    canonicalFilename: original,
    canonicalSha256: "a".repeat(64),
    templateCommit: "b".repeat(40),
    localFilename: renamed,
    localSha256: createHash("sha256").update(sql).digest("hex"),
    reason: "Reviewed",
  }
  const root = fixture(t, {
    "docs/store-update-ledger.json": JSON.stringify({ schemaVersion: 1, migrationMappings: [entry] }),
    "external.sql": sql,
    "docs/setup.md": original,
  })
  fs.mkdirSync(path.join(root, "supabase/migrations"), { recursive: true })
  fs.symlinkSync(path.join(root, "external.sql"), path.join(root, migrationPath(renamed)))
  assert.ok(checkMigrationReferences(root).some((error) => error.includes("ordinary file")))
  fs.unlinkSync(path.join(root, migrationPath(renamed)))
  write(root, migrationPath(renamed), sql)
  write(root, migrationPath(original), sql)
  assert.ok(checkMigrationReferences(root).some((error) => error.includes("coexist")))
})
