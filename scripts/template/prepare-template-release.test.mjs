import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { prepareTemplateRelease } from "./prepare-template-release.mjs"

const tag = "template-v0.1.0"
const filename = `${"20260901000000"}_baseline.sql`
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "template-release-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
  const write = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  git("init", "--quiet")
  git("config", "user.name", "Fixture")
  git("config", "user.email", "fixture@example.test")
  git("remote", "add", "origin", "git@github.com:NerdOutInc/ai-shop-template.git")
  const record = { schemaVersion: 1, includedPullRequests: [27, 28, 29], upgradeNotes: `docs/releases/${tag}.md` }
  write(`docs/releases/${tag}.json`, JSON.stringify(record))
  write(record.upgradeNotes, "Migration first, deploy second, activate after owner review.")
  write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n")
  write("src/lib/store-config-values.ts", "export const storeConfigValues = { configured: false }")
  write(`supabase/migrations/${filename}`, "select 1;\n")
  write(
    "docs/source-port-ledger.json",
    JSON.stringify({
      coverage: { reviewedThroughSourceCommit: "a".repeat(40) },
      dispositions: [
        {
          disposition: "accepted",
          sourceCommit: "b".repeat(40),
          templateCommit: null,
          followUp: "Record actual merge",
        },
      ],
    })
  )
  git("add", ".")
  git("commit", "--quiet", "-m", "Candidate fixture")
  return { root, git, write, ref: git("rev-parse", "HEAD"), record }
}

test("pins committed tree, lockfile, SQL, notes and PR list without treating a candidate as a release", (t) => {
  const { root, ref, git, write } = fixture(t)
  const beforeRefs = git("show-ref", "--heads")
  const result = prepareTemplateRelease(root, { ref, tag })
  assert.equal(result.state, "candidate")
  assert.equal(result.commit, ref)
  assert.equal(result.tree, git("rev-parse", "HEAD^{tree}"))
  assert.equal(result.lockfileSha256, hash("lockfileVersion: '9.0'\n"))
  assert.deepEqual(result.migrations, [{ filename, sha256: hash("select 1;\n") }])
  assert.deepEqual(result.includedPullRequests, [27, 28, 29])
  assert.equal(result.upgradeNotes.sha256, hash(readFileSync(join(root, result.upgradeNotes.path))))
  assert.equal(result.pendingSourcePortReceipts.length, 1)
  write("pnpm-lock.yaml", "Uncommitted edits must not enter this candidate")
  assert.deepEqual(prepareTemplateRelease(root, { ref, tag }), result)
  assert.equal(git("show-ref", "--heads"), beforeRefs)
  assert.equal(git("tag", "--list"), "")
})

test("standalone copies cannot run maintainer release preparation", (t) => {
  const { root, ref, git } = fixture(t)
  git("remote", "set-url", "origin", "git@github.com:fixture-owner/fixture-store.git")
  assert.throws(() => prepareTemplateRelease(root, { ref, tag }), /limited to NerdOutInc/)
})

test("refuses mutable refs, another tag namespace and malformed release records", (t) => {
  const { root, ref, write, git, record } = fixture(t)
  assert.throws(() => prepareTemplateRelease(root, { ref: "HEAD", tag }), /full pinned commit/)
  assert.throws(() => prepareTemplateRelease(root, { ref, tag: "v0.1.0" }), /namespace/)
  for (const invalid of [
    { ...record, includedPullRequests: [27, 27] },
    { ...record, includedPullRequests: [] },
    { ...record, upgradeNotes: "../private.md" },
    { ...record, schemaVersion: 2 },
  ]) {
    write(`docs/releases/${tag}.json`, JSON.stringify(invalid))
    git("add", ".")
    git("commit", "--quiet", "-m", "Invalid record")
    assert.throws(() => prepareTemplateRelease(root, { ref: git("rev-parse", "HEAD"), tag }), /Release record/)
  }
})

test("CLI rejects a mutable ref and the workflow runs only in the canonical repository with read-only permissions", (t) => {
  const { root } = fixture(t)
  const script = fileURLToPath(new URL("./prepare-template-release.mjs", import.meta.url))
  const result = spawnSync(process.execPath, [script, "--ref", "HEAD", "--tag", tag], { cwd: root, encoding: "utf8" })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /full pinned commit/)
  const workflow = readFileSync(
    new URL("../../.github/workflows/prepare-template-release.yml", import.meta.url),
    "utf8"
  )
  assert.match(workflow, /if: github\.repository == 'NerdOutInc\/ai-shop-template'/)
  assert.match(workflow, /contents: read/)
  assert.doesNotMatch(workflow, /contents: write|pull_request_target|secrets\.|gh release create/)
})
