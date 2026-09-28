import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { setupProgressWarnings } from "./setup-progress-warnings.mjs"

test("warns about newer worktree snapshots without copying progress or reading secrets", () => {
  const root = mkdtempSync(path.join(tmpdir(), "onboarding-progress-"))
  const sibling = path.join(root, "sibling")
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" })
  try {
    git("init", "--quiet")
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "Fixture"
    )
    git("worktree", "add", "--detach", sibling)
    const local = { resume: { updatedAt: "2026-09-01T00:00:00Z" } }
    const write = (value) => writeFileSync(path.join(sibling, ".store-setup.local.json"), JSON.stringify(value))
    assert.deepEqual(setupProgressWarnings(root, local), [])
    write(local)
    assert.deepEqual(setupProgressWarnings(root, local), [])
    write({ resume: { updatedAt: "2026-09-02T00:00:00Z" }, authorization: "untrusted-secret-sentinel" })
    assert.match(setupProgressWarnings(root, local).join("\n"), /Newer setup progress exists in 1/)
    assert.doesNotMatch(setupProgressWarnings(root, local).join("\n"), /untrusted-secret-sentinel/)
    assert.match(setupProgressWarnings(root, undefined).join("\n"), /Newer setup progress/)
    writeFileSync(path.join(sibling, ".store-setup.local.json"), "invalid-json")
    assert.match(setupProgressWarnings(root, local).join("\n"), /comparison is incomplete/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
