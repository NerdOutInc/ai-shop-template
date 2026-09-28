import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const patchKey = Object.keys(manifest.pnpm.patchedDependencies).find((key) => key.startsWith("next@"))
const patchPath = manifest.pnpm.patchedDependencies[patchKey]
const patch = readFileSync(join(root, patchPath), "utf8")
const targets = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1])

test("Next patch upgrades retain the patch and fail closed on unsupported or changed packages", () => {
  const temporary = mkdtempSync(join(tmpdir(), "template-next-patch-"))
  const project = join(temporary, "project")
  const source = join(temporary, "package")
  const current = manifest.dependencies.next
  const [major, minor, patchVersion] = current.split(".").map(Number)
  const future = `${major}.${minor}.${patchVersion + 1}`
  const nextMinor = `${major}.${minor + 1}.0`
  const installed = new Map(targets.map((target) => [target, readFileSync(join(root, "node_modules/next", target))]))
  const run = (...args) =>
    spawnSync("pnpm", args, {
      cwd: project,
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
      timeout: 60_000,
    })
  const install = (...args) =>
    run("install", "--offline", "--ignore-scripts", "--store-dir", join(temporary, "store"), ...args)
  const succeeds = (result) => assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const failsWith = (result, error) => {
    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, error)
  }
  const configure = (version, key, archive = version) => {
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({
        name: "next-patch-upgrade-fixture",
        private: true,
        packageManager: manifest.packageManager,
        dependencies: { next: `file:../next-${archive}.tgz` },
        pnpm: { patchedDependencies: { [key]: "next.patch" } },
      })
    )
  }
  const pack = (version, archive = version) => {
    writeFileSync(join(source, "package.json"), JSON.stringify({ name: "next", version }))
    execFileSync("tar", ["-czf", join(temporary, `next-${archive}.tgz`), "package"], { cwd: temporary })
  }

  try {
    mkdirSync(project)
    for (const [target, bytes] of installed) {
      mkdirSync(dirname(join(source, target)), { recursive: true })
      writeFileSync(join(source, target), bytes)
    }
    copyFileSync(join(root, patchPath), join(project, "next.patch"))
    // Use the real six Next patch targets, with their patch reversed. Only the
    // fixture's package version changes; this cannot certify an upstream release.
    execFileSync("git", ["apply", "--reverse", join(project, "next.patch")], { cwd: source })
    pack(current)
    pack(future)
    pack(nextMinor)

    configure(current, `next@${current}`)
    succeeds(install("--lockfile-only"))
    configure(future, `next@${current}`)
    failsWith(install("--lockfile-only"), /ERR_PNPM_UNUSED_PATCH/)

    configure(future, patchKey)
    succeeds(install("--lockfile-only"))
    const lockfile = readFileSync(join(project, "pnpm-lock.yaml"), "utf8")
    assert.ok(lockfile.includes(patchKey))
    assert.match(lockfile, /patch_hash=/)
    succeeds(install("--frozen-lockfile"))
    assert.equal(JSON.parse(readFileSync(join(project, "node_modules/next/package.json"), "utf8")).version, future)
    for (const [target, bytes] of installed) {
      assert.deepEqual(readFileSync(join(project, "node_modules/next", target)), bytes)
    }

    configure(nextMinor, patchKey)
    failsWith(install("--lockfile-only"), /ERR_PNPM_UNUSED_PATCH/)

    writeFileSync(join(source, targets[0]), "// Simulated incompatible upstream rewrite.\n")
    pack(future, "incompatible")
    configure(future, patchKey, "incompatible")
    succeeds(install("--lockfile-only"))
    failsWith(install("--frozen-lockfile"), /ERR_PNPM_PATCH_FAILED/)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
