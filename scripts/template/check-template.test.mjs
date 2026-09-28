import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { checkTemplate } from "./check-template.mjs"

const sha256 = (value) => createHash("sha256").update(value).digest("hex")
const secret = ["sk", "live", "SyntheticCredentialNeverIssued123456789"].join("_")
const privateKey = ["-----BEGIN", "PRIVATE KEY-----"].join(" ")
const oldAsset = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])
const identifiers = [
  ["Retired Otter Outfitters", "source-brand"],
  ["Former Store Owner", "source-owner"],
  ["retired-otter.invalid", "source-domain"],
  ["help@retired-otter.invalid", "source-contact"],
  ["987654321", "source-shop"],
]
const policy = {
  forbiddenIdentifiers: identifiers.map(([value, kind]) => {
    const words = value.toLowerCase().match(/[a-z0-9]+/g)
    return { kind, length: words.join("").length, wordCount: words.length, sha256: sha256(words.join("")) }
  }),
  forbiddenAssetSha256: [sha256(oldAsset)],
  allowedFiles: [],
  allowedMatches: [],
  allowedSymlinks: [],
  allowedIdentifierLines: [],
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "store-template-hygiene-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" })
  git("init", "--quiet")
  const write = (file, content) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), content)
  }
  const check = (customPolicy = policy) => checkTemplate(root, customPolicy).failures
  return { root, git, write, check }
}

test("allows downstream public brand config, new public assets, placeholders and ignored local secrets", (t) => {
  const { write, check } = fixture(t)
  write(".gitignore", ".env*\n!.env.example\n")
  write(".env.local", `STRIPE_SECRET_KEY=${secret}`)
  write(".env.example", "# NEXT_PUBLIC_SITE_URL=https://new-shop.example\n# STRIPE_SECRET_KEY=rk_test_...\n")
  write(
    "src/lib/store-config.ts",
    'export const store = { name: "New Otter Supply", supportEmail: "hello@new-otter.com", url: "https://new-otter.com" }'
  )
  write("public/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 5, 6, 7]))
  write("assets/print/README.md", "Private print sources belong in private storage.")
  write("docs/providers.md", "PRINTIFY_SHOP_ID belongs in private configuration, not source.")
  assert.deepEqual(check(), [])
})

for (const [value, kind] of identifiers) {
  test(`rejects planted ${kind} in newly added content without echoing its value`, (t) => {
    const { write, check } = fixture(t)
    write("docs/copied-config.md", `Copied setting: ${value}`)
    const failures = check()
    assert.ok(failures.some((failure) => failure.includes(kind)))
    assert.ok(!failures.join("\n").includes(value))
  })
}

test("detects source identity in domains, filenames and browser storage namespaces", (t) => {
  const { write, check } = fixture(t)
  write("docs/retired-otter-outfitters.md", "copied filename")
  write("src/browser.ts", 'const key = "retiredOtterOutfittersCart"; const host = "https://retired-otter.invalid/shop"')
  const failures = check()
  assert.ok(
    failures.some(
      (failure) => failure.startsWith('"docs/retired-otter-outfitters.md"') && failure.includes("source-brand")
    )
  )
  assert.ok(failures.some((failure) => failure.startsWith('"src/browser.ts"') && failure.includes("source-brand")))
  assert.ok(failures.some((failure) => failure.includes("source-domain")))
})

test("checks tracked and staged versions even when worktree edits or deletions hide a leak", (t) => {
  const { write, git, check, root } = fixture(t)
  write("config.json", JSON.stringify({ secret }))
  git("add", "config.json")
  write("config.json", "{}")
  assert.ok(check().some((failure) => failure.includes("(index): provider/browser key")))
  rmSync(join(root, "config.json"))
  assert.ok(check().some((failure) => failure.includes("(index): provider/browser key")))
  git("rm", "--cached", "--quiet", "config.json")
  assert.deepEqual(check(), [])
})

test("rejects private env and provider state at any nesting level, including force-added ignored files", (t) => {
  const { write, git, check } = fixture(t)
  write(".gitignore", ".env*\n")
  write(".env.local", "not-even-a-secret")
  git("add", "--force", ".env.local")
  for (const file of [
    "fixtures/.env.production",
    "nested/.env.example",
    "nested/.vercel/project.json",
    "supabase/.temp/project-ref",
    "nested/.store-setup.local.json",
    "playwright/.auth/owner.json",
    "design-agent-demo.token",
  ]) {
    write(file, "{}")
    git("add", "--force", file)
  }
  const failures = check()
  for (const file of [
    ".env.local",
    "fixtures/.env.production",
    "nested/.env.example",
    "nested/.vercel/project.json",
    "supabase/.temp/project-ref",
    "nested/.store-setup.local.json",
    "playwright/.auth/owner.json",
    "design-agent-demo.token",
  ]) {
    assert.ok(
      failures.some((failure) => failure.startsWith(JSON.stringify(file)) && failure.includes("private setup state")),
      file
    )
  }
})

test("detects provider secrets, public browser keys and JWTs without returning matched tokens", (t) => {
  const { write, check } = fixture(t)
  const jwt = [
    Buffer.from('{"alg":"HS256"}').toString("base64url"),
    Buffer.from('{"role":"anon","ref":"synthetic-project"}').toString("base64url"),
    "SyntheticSignatureNeverIssued123",
  ].join(".")
  const publicKey = ["sb", "publishable", "SyntheticPublicProjectKey123456789"].join("_")
  write("src/settings.ts", JSON.stringify({ secret, jwt, publicKey }))
  const failures = check()
  assert.ok(failures.some((failure) => failure.includes("provider/browser key")))
  for (const value of [secret, jwt, publicKey]) assert.ok(!failures.join("\n").includes(value))
})

test("detects browser state saved under an unrecognized filename", (t) => {
  const { write, check } = fixture(t)
  write("copied-session.json", JSON.stringify({ cookies: [{ name: "session", value: "private-value" }], origins: [] }))
  write(
    "copied-storage.json",
    JSON.stringify({
      cookies: [],
      origins: [{ origin: "https://new-store.example", localStorage: [{ name: "auth", value: "private-value" }] }],
    })
  )
  write(
    "copied-indexed-db.json",
    JSON.stringify({
      cookies: [],
      origins: [
        null,
        {
          origin: "https://new-store.example",
          localStorage: [],
          indexedDB: [
            {
              name: "auth",
              version: 1,
              stores: [{ name: "tokens", records: [{ value: { accessToken: "opaque-fixture" } }] }],
            },
          ],
        },
      ],
    })
  )
  assert.equal(check().filter((failure) => failure.includes("browser authentication state")).length, 3)
})

test("rejects operational print files and renamed source assets, including binary files", (t) => {
  const { write, check } = fixture(t)
  write("assets/print/upload.png", Buffer.from([0, 2, 3]))
  write("public/innocent-name.png", oldAsset)
  const failures = check()
  assert.ok(
    failures.some(
      (failure) => failure.startsWith('"assets/print/upload.png"') && failure.includes("private setup state")
    )
  )
  assert.ok(
    failures.some(
      (failure) => failure.startsWith('"public/innocent-name.png"') && failure.includes("source-store asset")
    )
  )
})

test("detects zero-cookie browser exports carrying passkeys or origin private files", (t) => {
  const { write, check } = fixture(t)
  write(
    "passkeys.json",
    JSON.stringify({
      cookies: [],
      origins: [],
      credentials: [{ credentialId: "synthetic-id", rpId: "example.test", privateKey: "synthetic-base64-private-key" }],
    })
  )
  write(
    "origin-files.json",
    JSON.stringify({
      cookies: [],
      origins: [
        {
          origin: "https://example.test",
          localStorage: [],
          opfs: [{ path: "auth.dat", type: "file", base64: "c3ludGhldGlj" }],
        },
      ],
    })
  )
  assert.equal(check().filter((failure) => failure.includes("browser authentication state")).length, 2)
})

test("NUL bytes and UTF-16 exports cannot bypass identity or credential checks", (t) => {
  const { write, check } = fixture(t)
  write("metadata.bin", Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(secret)]))
  write("export.txt", Buffer.from("Former Store Owner", "utf16le"))
  const failures = check()
  assert.ok(
    failures.some((failure) => failure.startsWith('"metadata.bin"') && failure.includes("provider/browser key"))
  )
  assert.ok(failures.some((failure) => failure.startsWith('"export.txt"') && failure.includes("source-owner")))
})

test("rejects untracked, dangling and tracked symlinks without reading external target content", (t) => {
  const { root, write, git, check } = fixture(t)
  write(".gitignore", "private-target\n")
  write("private-target", secret)
  symlinkSync(join(root, "private-target"), join(root, "untracked-link"))
  symlinkSync(join(root, "missing"), join(root, "dangling-link"))
  symlinkSync(join(root, "private-target"), join(root, "tracked-link"))
  git("add", "tracked-link")
  const failures = check()
  for (const file of ["untracked-link", "dangling-link", "tracked-link"]) {
    assert.ok(failures.some((failure) => failure.startsWith(JSON.stringify(file)) && failure.includes("symlink")))
  }
  assert.ok(!failures.some((failure) => failure.includes("provider/browser key")))
})

test("rejects a symlinked parent of tracked content without following it", (t) => {
  const { root, write, git, check } = fixture(t)
  write("docs/safe.txt", "safe")
  git("add", "docs/safe.txt")
  rmSync(join(root, "docs"), { recursive: true })
  symlinkSync(join(root, "missing"), join(root, "docs"))
  assert.ok(check().some((failure) => failure.includes("symlink")))
})

test("allows only the reviewed internal skills symlink with a present, unchanged target", (t) => {
  const { root, write, git, check } = fixture(t)
  write(".agents/skills/example/SKILL.md", "Shared skill.")
  mkdirSync(join(root, ".claude"))
  const file = ".claude/skills"
  const target = "../.agents/skills"
  const symlinkPolicy = { ...policy, allowedSymlinks: [{ path: file, target, reason: "Shared local skills." }] }
  symlinkSync(target, join(root, file))
  git("add", ".")
  assert.deepEqual(check(symlinkPolicy), [])
  symlinkSync(target, join(root, ".claude/copied-skills"))
  assert.ok(
    check(symlinkPolicy).some((failure) => failure.startsWith('".claude/copied-skills"') && failure.includes("symlink"))
  )
  rmSync(join(root, file))
  symlinkSync("../unexpected", join(root, file))
  assert.ok(
    check(symlinkPolicy).some((failure) => failure.startsWith(JSON.stringify(file)) && failure.includes("symlink"))
  )
  rmSync(join(root, file))
  symlinkSync(target, join(root, file))
  rmSync(join(root, ".agents"), { recursive: true })
  assert.ok(
    check(symlinkPolicy).some((failure) => failure.startsWith(JSON.stringify(file)) && failure.includes("symlink"))
  )
})

test("synthetic provider allowance is scoped to the exact token and path", (t) => {
  const { write, check } = fixture(t)
  const file = "e2e/provider.ts"
  const tokenPolicy = {
    ...policy,
    allowedMatches: [
      { path: file, rule: "provider-key", sha256: sha256(secret), reason: "Never-issued synthetic fixture." },
    ],
  }
  write(file, `const token = "${secret}"`)
  assert.deepEqual(check(tokenPolicy), [])
  write(file, `const token = "${secret}changed"`)
  assert.ok(check(tokenPolicy).some((failure) => failure.includes("provider/browser key")))
  write("src/copied.ts", secret)
  assert.ok(
    check(tokenPolicy).some(
      (failure) => failure.startsWith('"src/copied.ts"') && failure.includes("provider/browser key")
    )
  )
})

test("permits only the exact public TLS fixture bytes at the exact reviewed path", (t) => {
  const { write, check } = fixture(t)
  const file = "test/tls/synthetic-key.pem"
  const content = `${privateKey}\nSYNTHETIC_NOT_A_VALID_KEY\n`
  const fixturePolicy = {
    ...policy,
    allowedFiles: [{ path: file, rule: "private-key", sha256: sha256(content), reason: "Synthetic fixture." }],
  }
  write(file, content)
  assert.deepEqual(check(fixturePolicy), [])
  write(file, `${content}CHANGED`)
  assert.ok(check(fixturePolicy).some((failure) => failure.includes("private-key")))
  write("src/copied.pem", content)
  assert.ok(
    check(fixturePolicy).some((failure) => failure.startsWith('"src/copied.pem"') && failure.includes("private-key"))
  )
})

test("rejects supported PEM private-key headers including DSA and encrypted keys", (t) => {
  const { write, check } = fixture(t)
  const formats = ["RSA", "DSA", "EC", "OPENSSH", "ENCRYPTED"]
  formats.forEach((format, index) =>
    write(`keys/key-${index}.pem`, ["-----BEGIN", format, "PRIVATE KEY-----"].join(" "))
  )
  assert.equal(check().filter((failure) => failure.includes("private-key material")).length, formats.length)
})

test("license exception is one exact attribution line in one file, not a whole-file exemption", (t) => {
  const { write, check } = fixture(t)
  const notice = "Copyright (c) 2026 Former Store Owner"
  const licensePolicy = {
    ...policy,
    allowedIdentifierLines: [
      { path: "LICENSE", sha256: sha256(notice), reason: "Required upstream license attribution." },
    ],
  }
  write("LICENSE", `${notice}\nMIT terms are preserved here.\n`)
  assert.deepEqual(check(licensePolicy), [])
  write("LICENSE", `${notice}\nContact Former Store Owner\n${secret}`)
  assert.ok(check(licensePolicy).some((failure) => failure.includes("source-owner")))
  assert.ok(check(licensePolicy).some((failure) => failure.includes("provider/browser key")))
  write("docs/copied-license.txt", notice)
  assert.ok(
    check(licensePolicy).some(
      (failure) => failure.startsWith('"docs/copied-license.txt"') && failure.includes("source-owner")
    )
  )
})

test("detects POSIX and Windows home paths without exposing the path value", (t) => {
  const { write, check } = fixture(t)
  const paths = [
    ["", "Users", "synthetic", "project"].join("/"),
    ["", "home", "synthetic", "project"].join("/"),
    ["C:", "Users", "synthetic", "project"].join("\\"),
  ]
  paths.forEach((value, index) => write(`docs/path-${index}.txt`, value))
  write("docs/escaped-windows.json", JSON.stringify({ workspacePath: paths[2] }))
  const failures = check()
  assert.equal(failures.filter((failure) => failure.includes("machine-local path")).length, 4)
  for (const value of paths) assert.ok(!failures.join("\n").includes(value))
})

test("ordinary API routes and URL path segments do not look like machine home directories", (t) => {
  const { write, check } = fixture(t)
  write(
    "docs/service-endpoints.md",
    [
      "https://api.github.com/users/octocat",
      "/auth/v1/admin/users/example",
      "https://x.example/home/name/page",
      "https://x.example/Users/name/page",
    ].join("\n")
  )
  assert.deepEqual(check(), [])
})

test("CLI exits unsuccessfully for a planted provider key and successfully for a clean clone", (t) => {
  const { root, write } = fixture(t)
  const script = fileURLToPath(new URL("./check-template.mjs", import.meta.url))
  write("README.md", "A clean synthetic store.")
  assert.equal(spawnSync(process.execPath, [script], { cwd: root }).status, 0)
  write("config.json", JSON.stringify({ secret }))
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /provider\/browser key/)
  assert.ok(!result.stderr.includes(secret))
})

test("committed policy records rationale for narrow exceptions and opaque source fingerprints", () => {
  const saved = JSON.parse(readFileSync(new URL("./check-template-policy.json", import.meta.url), "utf8"))
  assert.equal(saved.version, 1)
  for (const item of saved.allowedFiles) {
    assert.match(item.sha256, /^[a-f0-9]{64}$/)
    assert.ok(item.reason)
    assert.ok(!item.path.includes("*"))
  }
  for (const item of saved.forbiddenIdentifiers) assert.match(item.sha256, /^[a-f0-9]{64}$/)
  for (const fingerprint of saved.forbiddenAssetSha256) assert.match(fingerprint, /^[a-f0-9]{64}$/)
})
