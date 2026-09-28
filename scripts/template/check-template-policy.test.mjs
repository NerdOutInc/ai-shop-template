import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { checkTemplate } from "./check-template.mjs"

const policy = JSON.parse(readFileSync(new URL("./check-template-policy.json", import.meta.url), "utf8"))
const templateKinds = new Set(["source-design-title", "source-product-copy", "source-tagline", "source-owner"])
const accountExamples = [
  ["source-google-tag", "GT-SYNTHETIC9"],
  ["source-merchant-account", "900000000031"],
  ["source-conversion-destination", "MC-SYNTHETIC42"],
  ["source-meta-business", "900000000032"],
  ["source-meta-catalog", "900000000033"],
  ["source-database-role", "retired_fable_app_runtime"],
]

test("the shipped policy limits prose and owner checks to the template while keeping exact identities protected", () => {
  const seen = new Set()
  for (const fingerprint of policy.forbiddenIdentifiers) {
    assert.ok(!seen.has(fingerprint.sha256), "Each source fingerprint should occur once")
    seen.add(fingerprint.sha256)
    assert.equal(fingerprint.scope, templateKinds.has(fingerprint.kind) ? "template" : undefined)
  }
  for (const [kind] of accountExamples) assert.ok(policy.forbiddenIdentifiers.some((item) => item.kind === kind))
  assert.match(policy.sourceIdentifierSnapshot.commit, /^[a-f0-9]{40}$/)
  assert.match(policy.sourceIdentifierSnapshot.tree, /^[a-f0-9]{40}$/)
  assert.deepEqual([...policy.sourceIdentifierSnapshot.kinds].sort(), accountExamples.map(([kind]) => kind).sort())
})

test("the shipped asset manifest has sorted unique fingerprints and explicit source snapshot coverage", () => {
  const snapshot = policy.sourceAssetSnapshot
  assert.match(snapshot.commit, /^[a-f0-9]{40}$/)
  assert.match(snapshot.tree, /^[a-f0-9]{40}$/)
  assert.equal(snapshot.uniqueSha256Count, policy.forbiddenAssetSha256.length)
  assert.equal(
    snapshot.imagePathCount,
    Object.values(snapshot.pathCountsByExtension).reduce((sum, count) => sum + count, 0)
  )
  assert.ok(snapshot.imagePathCount >= snapshot.uniqueBlobCount)
  assert.ok(snapshot.uniqueBlobCount >= snapshot.uniqueSha256Count)
  assert.deepEqual(policy.forbiddenAssetSha256, [...new Set(policy.forbiddenAssetSha256)].sort())
  for (const hash of policy.forbiddenAssetSha256) assert.match(hash, /^[a-f0-9]{64}$/)
  for (const extension of [".ico", ".png", ".webp", ".svg", ".jpg"])
    assert.ok(snapshot.imageExtensions.includes(extension))
})

for (const configured of [false, true]) {
  test(`detects an ID-only provider or database-role hunk when configured is ${configured}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "template-policy-accounts-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    execFileSync("git", ["init", "--quiet"], { cwd: root })
    const write = (file, content) => {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), content)
    }
    write("src/lib/store-config.ts", `export const storeConfig = { configured: ${configured} }`)
    const syntheticPolicy = {
      ...policy,
      forbiddenIdentifiers: accountExamples.map(([kind, value]) => {
        const words = value.toLowerCase().match(/[a-z0-9]+/g)
        const normalized = words.join("")
        return {
          kind,
          wordCount: words.length,
          length: normalized.length,
          sha256: createHash("sha256").update(normalized).digest("hex"),
        }
      }),
    }
    assert.deepEqual(checkTemplate(root, syntheticPolicy).failures, [])
    for (const [kind, value] of accountExamples) {
      // No source brand, owner or domain accompanies the identifier in this copied hunk.
      write("docs/copied-settings.md", `Provider settings\n\n${value}\n`)
      const failures = checkTemplate(root, syntheticPolicy).failures
      assert.ok(
        failures.some((failure) => failure.includes(kind)),
        kind
      )
      assert.ok(!failures.join("\n").includes(value))
    }
  })
}
