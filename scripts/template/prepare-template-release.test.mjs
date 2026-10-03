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
  git("commit", "--quiet", "-m", "Fixture (#27)")
  git("commit", "--quiet", "--allow-empty", "-m", "Fixture (#28)")
  git("commit", "--quiet", "--allow-empty", "-m", "Fixture (#29)")
  git("update-ref", "refs/remotes/origin/main", "HEAD")
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
  assert.match(workflow, /fetch-depth: 0/)
  assert.match(workflow, /default: false/)
  assert.doesNotMatch(workflow, /contents: write|pull_request_target|secrets\.|gh release create/)
})

test("candidate and main preparation reject unlisted history; only candidates allow pending listed PRs", (t) => {
  const { root, git, write, record } = fixture(t)
  write(`docs/releases/${tag}.json`, JSON.stringify({ ...record, includedPullRequests: [27, 29, 99] }))
  git("add", ".")
  git("commit", "--quiet", "-m", "Unmerged candidate")
  let ref = git("rev-parse", "HEAD")
  assert.throws(() => prepareTemplateRelease(root, { ref, tag }), /not on fetched origin\/main/)
  assert.throws(() => prepareTemplateRelease(root, { ref, tag, candidate: true }), /merged but unlisted 28/)
  write(`docs/releases/${tag}.json`, JSON.stringify({ ...record, includedPullRequests: [27, 28, 29, 99] }))
  git("add", ".")
  git("commit", "--quiet", "-m", "Account for all merged PRs")
  ref = git("rev-parse", "HEAD")
  const candidate = prepareTemplateRelease(root, { ref, tag, candidate: true })
  assert.deepEqual(candidate.pullRequestVerification.unmergedListedPullRequests, [99])
  assert.deepEqual(candidate.pullRequestVerification.unlistedHistoryPullRequests, [])
  git("update-ref", "refs/remotes/origin/main", ref)
  assert.throws(() => prepareTemplateRelease(root, { ref, tag }), /listed but absent 99/)
})

test("a concurrent main merge invalidates the candidate until the branch and inventory catch up", (t) => {
  const { root, git, write, record, ref: base } = fixture(t)
  git("commit", "--quiet", "--allow-empty", "-m", "Candidate edits")
  const candidateRef = git("rev-parse", "HEAD")
  const concurrent = git("commit-tree", git("rev-parse", `${base}^{tree}`), "-p", base, "-m", "Dependency update (#42)")
  git("update-ref", "refs/remotes/origin/main", concurrent)
  assert.throws(
    () => prepareTemplateRelease(root, { ref: candidateRef, tag, candidate: true }),
    /include fetched origin\/main/
  )
  // Main is a second parent here, so first-parent candidate history alone is insufficient.
  git("merge", "--quiet", "--no-ff", concurrent, "-m", "Update candidate from main")
  assert.throws(
    () => prepareTemplateRelease(root, { ref: git("rev-parse", "HEAD"), tag, candidate: true }),
    /merged but unlisted 42/
  )
  write(
    `docs/releases/${tag}.json`,
    JSON.stringify({ ...record, includedPullRequests: [...record.includedPullRequests, 42] })
  )
  git("add", ".")
  git("commit", "--quiet", "-m", "Refresh inventory")
  const result = prepareTemplateRelease(root, { ref: git("rev-parse", "HEAD"), tag, candidate: true })
  assert.deepEqual(result.includedPullRequests, [27, 28, 29, 42])
})

test("squash, merge commits and labeled rebase commits retain the preparation PR", (t) => {
  const { root, git, write, record } = fixture(t)
  write(`docs/releases/${tag}.json`, JSON.stringify({ ...record, includedPullRequests: [27, 28, 29, 41] }))
  git("add", ".")
  git("commit", "--quiet", "-m", "Prepare release (#41)")
  const ref = git("rev-parse", "HEAD")
  const candidate = prepareTemplateRelease(root, { ref, tag, candidate: true })
  assert.deepEqual(candidate.pullRequestVerification.unmergedListedPullRequests, [41])
  const base = git("rev-parse", "origin/main")
  const tree = git("rev-parse", `${ref}^{tree}`)
  for (const subject of [
    "Prepare release (#41)",
    "Merge pull request #41 from fixture/release",
    "Rebased preparation (#41)",
  ]) {
    const parents = subject.startsWith("Merge pull request") ? ["-p", base, "-p", ref] : ["-p", base]
    const merged = git("commit-tree", tree, ...parents, "-m", subject)
    git("update-ref", "refs/remotes/origin/main", merged)
    const result = prepareTemplateRelease(root, { ref: merged, tag })
    assert.deepEqual(result.includedPullRequests, [27, 28, 29, 41])
    assert.deepEqual(result.pullRequestVerification.unmergedListedPullRequests, [])
  }
})

test("unlabeled rebase history can be repaired with a verified committed receipt", (t) => {
  const { root, git, write, record } = fixture(t)
  git("commit", "--quiet", "--allow-empty", "-m", "Rebased fix without a PR label")
  const rebased = git("rev-parse", "HEAD")
  git("update-ref", "refs/remotes/origin/main", rebased)
  const inventory = {
    ...record,
    includedPullRequests: [27, 28, 29, 41, 42],
    rebasedPullRequests: [{ number: 41, commit: rebased }],
  }
  write(`docs/releases/${tag}.json`, JSON.stringify(inventory))
  git("add", ".")
  git("commit", "--quiet", "-m", "Record independently verified rebase receipt (#42)")
  const ref = git("rev-parse", "HEAD")
  git("update-ref", "refs/remotes/origin/main", ref)
  const result = prepareTemplateRelease(root, { ref, tag })
  assert.deepEqual(result.includedPullRequests, inventory.includedPullRequests)
  assert.deepEqual(result.rebasedPullRequests, inventory.rebasedPullRequests)
  for (const receipts of [
    null,
    [{ number: 41, commit: "a".repeat(40) }],
    [{ number: 41, commit: "HEAD" }],
    [{ number: 99, commit: rebased }],
    [
      { number: 41, commit: rebased },
      { number: 41, commit: rebased },
    ],
  ]) {
    write(`docs/releases/${tag}.json`, JSON.stringify({ ...inventory, rebasedPullRequests: receipts }))
    git("add", ".")
    git("commit", "--quiet", "-m", "Invalid receipt")
    assert.throws(
      () => prepareTemplateRelease(root, { ref: git("rev-parse", "HEAD"), tag, candidate: true }),
      /Rebased PR receipts/
    )
  }
})

test("candidate rebase receipts remain valid when merged main is a second parent", (t) => {
  const { root, git, write, record, ref: base } = fixture(t)
  git("commit", "--quiet", "--allow-empty", "-m", "Candidate work")
  const rebased = git(
    "commit-tree",
    git("rev-parse", `${base}^{tree}`),
    "-p",
    base,
    "-m",
    "Unlabeled rebased main change"
  )
  git("update-ref", "refs/remotes/origin/main", rebased)
  git("merge", "--quiet", "--no-ff", rebased, "-m", "Update from main")
  write(
    `docs/releases/${tag}.json`,
    JSON.stringify({
      ...record,
      includedPullRequests: [27, 28, 29, 41],
      rebasedPullRequests: [{ number: 41, commit: rebased }],
    })
  )
  git("add", ".")
  git("commit", "--quiet", "-m", "Record verified receipt")
  const result = prepareTemplateRelease(root, { ref: git("rev-parse", "HEAD"), tag, candidate: true })
  assert.deepEqual(result.pullRequestVerification.mergedPullRequests, [27, 28, 29, 41])
})

test("rebase receipts cannot use unmerged commits or a merged side-branch commit", (t) => {
  const { root, git, write, record, ref: base } = fixture(t)
  const side = git("commit-tree", git("rev-parse", `${base}^{tree}`), "-p", base, "-m", "Side change")
  const merge = git(
    "commit-tree",
    git("rev-parse", `${base}^{tree}`),
    "-p",
    base,
    "-p",
    side,
    "-m",
    "Merge pull request #30 from fixture/side"
  )
  git("update-ref", "refs/remotes/origin/main", merge)
  git("reset", "--quiet", "--hard", merge)
  git("commit", "--quiet", "--allow-empty", "-m", "Unmerged receipt target")
  const unmerged = git("rev-parse", "HEAD")
  for (const receiptCommit of [side, unmerged]) {
    write(
      `docs/releases/${tag}.json`,
      JSON.stringify({
        ...record,
        includedPullRequests: [27, 28, 29, 30, 41],
        rebasedPullRequests: [{ number: 41, commit: receiptCommit }],
      })
    )
    git("add", ".")
    git("commit", "--quiet", "-m", "Invalid receipt anchor")
    assert.throws(
      () => prepareTemplateRelease(root, { ref: git("rev-parse", "HEAD"), tag, candidate: true }),
      /Rebased PR receipts/
    )
  }
})

test("recording a merge receipt preserves live follow-ups and explicit publication blockers", (t) => {
  const { root, git, write, record, ref: base } = fixture(t)
  const blockers = [{ id: "source-live-proof", reason: "Record actual inbox and suppression proof" }]
  write(`docs/releases/${tag}.json`, JSON.stringify({ ...record, publicationBlockers: blockers }))
  write(
    "docs/source-port-ledger.json",
    JSON.stringify({
      coverage: { reviewedThroughSourceCommit: "a".repeat(40) },
      dispositions: [
        {
          disposition: "accepted",
          sourceCommit: "b".repeat(40),
          templateCommit: base,
          followUp: "Live proof still missing",
        },
      ],
    })
  )
  git("add", ".")
  git("commit", "--quiet", "-m", "Record merge while retaining publication blocker")
  const result = prepareTemplateRelease(root, { ref: git("rev-parse", "HEAD"), tag, candidate: true })
  assert.deepEqual(result.pendingSourcePortReceipts, [])
  assert.equal(result.pendingSourcePortFollowUps.length, 1)
  assert.equal(result.pendingSourcePortFollowUps[0].followUp, "Live proof still missing")
  assert.deepEqual(result.publicationBlockers, blockers)
  for (const invalid of [null, [{ id: "source-live-proof", reason: "" }], [...blockers, ...blockers]]) {
    write(`docs/releases/${tag}.json`, JSON.stringify({ ...record, publicationBlockers: invalid }))
    git("add", ".")
    git("commit", "--quiet", "-m", "Malformed blocker")
    assert.throws(
      () => prepareTemplateRelease(root, { ref: git("rev-parse", "HEAD"), tag, candidate: true }),
      /Publication blockers/
    )
  }
})

test("preparation handles lockfiles and migration blobs larger than one MiB", (t) => {
  const { root, git, write } = fixture(t)
  const bytes = "large existing bytes\n".repeat(70_000)
  write("pnpm-lock.yaml", bytes)
  write(`supabase/migrations/${filename}`, bytes)
  git("add", ".")
  git("commit", "--quiet", "-m", "Large blobs")
  git("update-ref", "refs/remotes/origin/main", "HEAD")
  const result = prepareTemplateRelease(root, { ref: git("rev-parse", "HEAD"), tag })
  assert.equal(result.lockfileSha256, hash(bytes))
  assert.equal(result.migrations[0].sha256, hash(bytes))
})
