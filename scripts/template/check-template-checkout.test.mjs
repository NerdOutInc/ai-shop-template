import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { checkTemplate } from "./check-template.mjs"

test("automatic CRLF checkout preserves reviewed TLS bytes and binary assets", (t) => {
  const root = mkdtempSync(join(tmpdir(), "template-maintenance-lf-checkout-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync("git", args, { cwd: root })
  const write = (file, bytes) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), bytes)
  }
  git("init", "--quiet")
  git("config", "core.autocrlf", "true")
  write(".gitattributes", readFileSync(new URL("../../.gitattributes", import.meta.url)))
  const fixtures = new Map(
    ["localhost-key.pem", "wrong-host-key.pem"].map((name) => [
      `test/tls/${name}`,
      readFileSync(new URL(`../../test/tls/${name}`, import.meta.url)),
    ])
  )
  fixtures.set("public/sample.bin", Buffer.from([0, 1, 13, 10, 2, 10, 3]))
  for (const [file, bytes] of fixtures) write(file, bytes)
  git("add", ".")
  for (const file of fixtures.keys()) rmSync(join(root, file))
  git("checkout-index", "--all", "--force")
  for (const [file, bytes] of fixtures) assert.deepEqual(readFileSync(join(root, file)), bytes, file)
  assert.deepEqual(checkTemplate(root).failures, [])
})
