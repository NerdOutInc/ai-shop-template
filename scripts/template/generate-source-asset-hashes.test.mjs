import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { generateSourceAssetHashes } from "./generate-source-asset-hashes.mjs"

const digest = (value) => createHash("sha256").update(value).digest("hex")

function sourceFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "source-asset-hashes-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
  git("init", "--quiet")
  const write = (path, bytes) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), bytes)
  }
  const snapshot = () => {
    git("add", ".")
    const tree = git("write-tree")
    // Synthetic unreachable objects need no user identity or branch in the disposable fixture.
    const commit = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], {
      cwd: root,
      encoding: "utf8",
      input: `tree ${tree}\nauthor Source Fixture <fixture@example.test> 0 +0000\ncommitter Source Fixture <fixture@example.test> 0 +0000\n\nSynthetic image snapshot\n`,
    }).trim()
    return { commit, tree }
  }
  return { root, git, write, snapshot }
}

test("covers favicon, logo sources, web backgrounds and nested concepts from only the chosen snapshot", async (t) => {
  const { root, write, snapshot } = sourceFixture(t)
  const images = {
    "src/app/favicon.ico": Buffer.from([0, 0, 1, 0, 1, 0]),
    "assets/logo/logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]),
    "assets/web/background.webp": Buffer.from("RIFF\0\0\0\0WEBPsynthetic"),
    "concepts/deep/original.jpg": Buffer.from([0xff, 0xd8, 0xff, 1, 2]),
    "public/icon.svg": Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    "concepts/a directory/new\nline.gif": Buffer.from("GIF89asynthetic"),
  }
  for (const [path, bytes] of Object.entries(images)) write(path, bytes)
  write("assets/logo/source/copy.PNG", images["assets/logo/logo.png"])
  write(".gitignore", "ignored.png\n")
  write("ignored.png", "untracked image")
  write("docs/setup.txt", "Synthetic non-image content must not enter the asset list")
  if (process.platform !== "win32") symlinkSync("../docs/setup.txt", join(root, "public/link.png"))
  const recorded = snapshot()
  write("assets/logo/logo.png", "working-tree replacement")
  write("concepts/untracked.png", "untracked image")

  const result = await generateSourceAssetHashes(root, recorded.commit)
  assert.equal(result.sourceAssetSnapshot.commit, recorded.commit)
  assert.equal(result.sourceAssetSnapshot.tree, recorded.tree)
  assert.equal(result.sourceAssetSnapshot.imagePathCount, 7)
  assert.equal(result.sourceAssetSnapshot.uniqueBlobCount, 6)
  assert.equal(result.sourceAssetSnapshot.uniqueSha256Count, 6)
  assert.deepEqual(result.sourceAssetSnapshot.pathCountsByExtension, {
    ".gif": 1,
    ".ico": 1,
    ".jpg": 1,
    ".png": 2,
    ".svg": 1,
    ".webp": 1,
  })
  assert.deepEqual(result.forbiddenAssetSha256, Object.values(images).map(digest).sort())
  const output = JSON.stringify(result)
  for (const value of [root, ...Object.keys(images), "working-tree replacement", "untracked image"])
    assert.ok(!output.includes(value))
  assert.deepEqual(await generateSourceAssetHashes(root, recorded.commit), result)
})

test("streams large blobs without truncating content at buffer boundaries", async (t) => {
  const { root, write, snapshot } = sourceFixture(t)
  const image = Buffer.alloc(2 * 1024 * 1024 + 13, 0xa5)
  write("concepts/large.avif", image)
  write("public/empty.svg", "")
  const { commit } = snapshot()
  const result = await generateSourceAssetHashes(root, commit)
  assert.deepEqual(result.forbiddenAssetSha256, [digest(image), digest("")].sort())
})

test("emits an empty manifest when the snapshot has no recognized image paths", async (t) => {
  const { root, write, snapshot } = sourceFixture(t)
  write("README.md", "A synthetic source with no assets.")
  const { commit } = snapshot()
  const result = await generateSourceAssetHashes(root, commit)
  assert.equal(result.sourceAssetSnapshot.imagePathCount, 0)
  assert.equal(result.sourceAssetSnapshot.uniqueBlobCount, 0)
  assert.deepEqual(result.forbiddenAssetSha256, [])
})

test("the CLI emits only the manifest and never exposes invalid source paths in errors", async (t) => {
  const { root, write, snapshot } = sourceFixture(t)
  write("public/sample.svg", "<svg/>")
  const { commit } = snapshot()
  const script = fileURLToPath(new URL("./generate-source-asset-hashes.mjs", import.meta.url))
  const valid = spawnSync(process.execPath, [script, root, commit], { encoding: "utf8" })
  assert.equal(valid.status, 0)
  assert.equal(valid.stderr, "")
  assert.deepEqual(JSON.parse(valid.stdout), await generateSourceAssetHashes(root, commit))
  const invalid = spawnSync(process.execPath, [script, root, "--not-a-ref"], { encoding: "utf8" })
  assert.equal(invalid.status, 1)
  assert.equal(invalid.stdout, "")
  assert.ok(!invalid.stderr.includes(root))
  assert.ok(!invalid.stderr.includes("--not-a-ref"))
})
