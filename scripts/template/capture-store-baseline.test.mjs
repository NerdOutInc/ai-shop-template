import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const command = fileURLToPath(new URL("./capture-store-baseline.mjs", import.meta.url))
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim()

function initialize(directory) {
  mkdirSync(directory)
  git(directory, "init", "-q")
  git(directory, "config", "user.name", "Baseline fixture")
  git(directory, "config", "user.email", "fixture@example.test")
  git(directory, "config", "commit.gpgsign", "false")
}

function commit(directory, message) {
  git(directory, "add", ".")
  git(directory, "commit", "-qm", message)
  return git(directory, "rev-parse", "HEAD")
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "store-baseline-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const template = join(root, "template")
  const store = join(root, "store")
  initialize(template)
  mkdirSync(join(template, "docs"))
  writeFileSync(join(template, "docs", "guide.md"), "Neutral setup\n")
  writeFileSync(join(template, "behavior.txt"), "Original behavior\n")
  const baseline = commit(template, "Template baseline")
  initialize(store)
  const archive = execFileSync("git", ["-C", template, "archive", baseline])
  execFileSync("tar", ["-xf", "-", "-C", store], { input: archive })
  const storeRoot = commit(store, "Unrelated generated store")
  assert.notEqual(baseline, storeRoot)
  const capture = (...args) =>
    spawnSync(
      process.execPath,
      [command, "--template-dir", template, "--template-ref", git(template, "rev-parse", "HEAD"), ...args],
      {
        cwd: store,
        encoding: "utf8",
      }
    )
  const ledger = join(store, "docs", "store-update-ledger.json")
  return { root, template, store, baseline, storeRoot, capture, ledger }
}

test("captures identical content across unrelated histories and leaves source refs untouched", (t) => {
  const f = fixture(t)
  const result = f.capture()
  assert.equal(result.status, 0, result.stderr)
  const saved = JSON.parse(readFileSync(f.ledger, "utf8"))
  assert.equal(saved.origin.templateCommit, f.baseline)
  assert.equal(saved.origin.storeRootCommit, f.storeRoot)
  assert.equal(saved.origin.templateTree, git(f.template, "rev-parse", "HEAD^{tree}"))
  assert.equal(saved.origin.method, "unique-root-tree-match")
  assert.deepEqual(saved.deployments, [])
  assert.deepEqual(saved.migrationMappings, [])
  assert.equal(saved.originRelease, null)
  assert.equal(saved.comparisonRelease, null)
  assert.equal(git(f.template, "status", "--porcelain"), "")
  assert.equal(git(f.store, "rev-parse", "HEAD"), f.storeRoot)
})

test("uses the original root after committed customization and never overwrites a saved ledger", (t) => {
  const f = fixture(t)
  writeFileSync(join(f.store, "behavior.txt"), "Brand behavior\n")
  commit(f.store, "Personalize")
  assert.equal(f.capture().status, 0)
  const before = readFileSync(f.ledger, "utf8")
  assert.deepEqual(JSON.parse(before).localDivergencePaths, ["behavior.txt"])
  commit(f.store, "Record baseline")
  assert.match(f.capture().stderr, /ledger already exists/)
  assert.equal(readFileSync(f.ledger, "utf8"), before)
})

test("refuses unmatched or dirty store roots without writing a ledger", (t) => {
  const f = fixture(t)
  writeFileSync(join(f.store, "behavior.txt"), "Uncommitted\n")
  assert.match(f.capture().stderr, /commit existing store changes/)
  git(f.store, "add", ".")
  git(f.store, "commit", "--amend", "--no-edit", "-q")
  assert.match(f.capture().stderr, /No matching root tree/)
  assert.throws(() => readFileSync(f.ledger), { code: "ENOENT" })
})

test("does not guess among identical trees and checks an explicit commit against the search boundary", (t) => {
  const f = fixture(t)
  git(f.template, "commit", "--allow-empty", "-qm", "Same content, different commit")
  const second = git(f.template, "rev-parse", "HEAD")
  assert.match(f.capture().stderr, /Ambiguous tree matches/)
  assert.match(f.capture("--template-commit", f.storeRoot).stderr, /not a matching tree/)
  assert.throws(() => readFileSync(f.ledger), { code: "ENOENT" })
  assert.equal(f.capture("--template-commit", second).status, 0)
  assert.equal(JSON.parse(readFileSync(f.ledger, "utf8")).origin.method, "root-tree-match-with-explicit-commit")
})

test("refuses incomplete template history", (t) => {
  const f = fixture(t)
  const shallow = join(f.root, "shallow")
  execFileSync("git", ["clone", "-q", "--depth", "1", `file://${f.template}`, shallow])
  const result = spawnSync(process.execPath, [command, "--template-dir", shallow, "--template-ref", f.baseline], {
    cwd: f.store,
    encoding: "utf8",
  })
  assert.match(result.stderr, /Complete local history/)
  assert.throws(() => readFileSync(f.ledger), { code: "ENOENT" })
})

test("refuses retained-history clones instead of mislabeling upstream changes as customization", (t) => {
  const f = fixture(t)
  writeFileSync(join(f.template, "behavior.txt"), "Shared fix\n")
  const head = commit(f.template, "Advance template")
  const retained = join(f.root, "retained")
  execFileSync("git", ["clone", "-q", f.template, retained])
  const result = spawnSync(process.execPath, [command, "--template-dir", f.template, "--template-ref", head], {
    cwd: retained,
    encoding: "utf8",
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Shared ancestry/)
  assert.throws(() => readFileSync(join(retained, "docs", "store-update-ledger.json")), { code: "ENOENT" })
  assert.equal(git(retained, "rev-parse", "HEAD"), head)
})

test("records literal Unicode, newline and whitespace paths after customization", (t) => {
  const f = fixture(t)
  const paths = ["\nleading.txt", " leading.txt", "café.txt", "line\nbreak.txt", "trailing.txt "]
  for (const path of paths) writeFileSync(join(f.store, path), "Brand asset\n")
  commit(f.store, "Add custom paths")
  const result = f.capture()
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(readFileSync(f.ledger, "utf8")).localDivergencePaths, paths)
})

test("an individual fix ports without shared ancestry while a conflicting brand edit fails the dry run", (t) => {
  const f = fixture(t)
  writeFileSync(join(f.template, "behavior.txt"), "Corrected behavior\n")
  const fix = commit(f.template, "Shared fix")
  const patch = execFileSync("git", [
    "-C",
    f.template,
    "diff",
    "--binary",
    "--full-index",
    `${fix}^`,
    fix,
    "--",
    "behavior.txt",
  ])
  const apply = (...args) =>
    spawnSync("git", ["-C", f.store, "apply", ...args, "-"], { input: patch, encoding: "utf8" })
  const templateObjects = join(f.template, ".git", "objects")
  const ancestry = spawnSync("git", ["-C", f.store, "merge-base", f.storeRoot, fix], {
    env: { ...process.env, GIT_ALTERNATE_OBJECT_DIRECTORIES: templateObjects },
  })
  assert.equal(ancestry.status, 1)
  assert.equal(apply("--check").status, 0)
  assert.equal(readFileSync(join(f.store, "behavior.txt"), "utf8"), "Original behavior\n")
  assert.equal(apply().status, 0)
  assert.equal(readFileSync(join(f.store, "behavior.txt"), "utf8"), "Corrected behavior\n")
  git(f.store, "restore", "--", "behavior.txt")
  writeFileSync(join(f.store, "behavior.txt"), "Brand-owned behavior\n")
  assert.notEqual(apply("--check").status, 0)
  assert.equal(readFileSync(join(f.store, "behavior.txt"), "utf8"), "Brand-owned behavior\n")
})
