import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { assertIsolatedDatabase } from "../../test/assert-isolated-database.ts"
import { readLoadSourceHash } from "./read-load-source-hash.mjs"

test("destructive fixtures reject remote databases and connection overrides", () => {
  for (const url of [
    undefined,
    "invalid",
    "https://localhost/store_catalog_e2e",
    "postgres://db.example.com/store_catalog_e2e",
    "postgres://localhost/postgres",
    "postgres://localhost/store_catalog_e2e?host=db.example.com",
    "postgres://localhost/store_catalog_e2e#fragment",
  ])
    assert.throws(() => assertIsolatedDatabase(url, "store_catalog_e2e"))
  for (const host of ["localhost", "127.0.0.1", "[::1]"])
    assert.equal(assertIsolatedDatabase(`postgresql://${host}/store_catalog_e2e`, "store_catalog_e2e").hostname, host)
})

test("source provenance includes working-tree deletions, edits and untracked support", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "store-load-source-"))
  try {
    execFileSync("git", ["init", "--quiet"], { cwd })
    await mkdir(join(cwd, "src"))
    const path = join(cwd, "src/fixture.ts")
    await writeFile(path, "original")
    execFileSync("git", ["add", "."], { cwd })
    const original = await readLoadSourceHash(cwd)
    await writeFile(path, "edited")
    assert.notDeepEqual(await readLoadSourceHash(cwd), original)
    await rm(path)
    const deleted = await readLoadSourceHash(cwd)
    assert.notDeepEqual(deleted, original)
    await writeFile(path, "original")
    assert.deepEqual(await readLoadSourceHash(cwd), original)
    await mkdir(join(cwd, "test"))
    await writeFile(join(cwd, "test/support.ts"), "new support")
    assert.notDeepEqual(await readLoadSourceHash(cwd), original)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
