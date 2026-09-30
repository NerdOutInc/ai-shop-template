import assert from "node:assert/strict"
import childProcess, { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { syncBuiltinESMExports } from "node:module"
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

test("story, unit and browser fixtures do not exempt copied source design text", (t) => {
  const { write, check } = fixture(t)
  const sourceCopy = [
    ["Cloud Otters Take a Breather", "source-design-title"],
    ["Every little adventure deserves another snack", "source-product-copy"],
    ["It's an otter's day off.", "source-tagline"],
  ]
  const sourcePolicy = {
    ...policy,
    forbiddenIdentifiers: sourceCopy.map(([value, kind]) => {
      const words = value.toLowerCase().match(/[a-z0-9]+/g)
      return {
        kind,
        scope: "template",
        length: words.join("").length,
        wordCount: words.length,
        sha256: sha256(words.join("")),
      }
    }),
  }
  const files = [
    "src/features/catalog/product.stories.tsx",
    "src/features/catalog/product.test.ts",
    "e2e/fixtures/product.ts",
    "test/fixtures/product.json",
  ]
  for (const file of files) {
    write(file, JSON.stringify({ title: sourceCopy[0][0], description: sourceCopy[1][0], tagline: sourceCopy[2][0] }))
  }
  const failures = check(sourcePolicy)
  for (const file of files) {
    for (const [, kind] of sourceCopy) {
      assert.ok(failures.some((failure) => failure.startsWith(JSON.stringify(file)) && failure.includes(kind)))
    }
  }
  for (const [value] of sourceCopy) assert.ok(!failures.join("\n").includes(value))
  write(files[0], 'const product = { title: "cloud-otters-take-a-breather", tagline: "It’s an otter’s day off!" }')
  assert.ok(
    check(sourcePolicy).some(
      (failure) => failure.startsWith(JSON.stringify(files[0])) && failure.includes("source-tagline")
    )
  )
  for (const file of files) write(file, "An independent new design for climbing, resting and taking small steps.")
  assert.deepEqual(check(sourcePolicy), [])
  write("src/lib/store-config.ts", "export const storeConfig = { configured: true }")
  for (const file of files) write(file, sourceCopy.map(([value]) => value).join("\n"))
  assert.deepEqual(check(sourcePolicy), [])
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

for (const flag of ["assume-unchanged", "skip-worktree"]) {
  test(`checks staged credentials hidden from Git diff by ${flag}`, (t) => {
    const { write, git, check } = fixture(t)
    write("config.json", JSON.stringify({ secret }))
    git("add", "config.json")
    git("update-index", `--${flag}`, "config.json")
    write("config.json", "{}")
    assert.equal(git("diff", "--name-only"), "")
    assert.ok(check().some((failure) => failure.includes("(index): provider/browser key")))
  })
}

test("configured stores allow their own owner and ordinary copy but still reject source account identity", (t) => {
  const { write, check } = fixture(t)
  const scopedPolicy = {
    ...policy,
    forbiddenIdentifiers: policy.forbiddenIdentifiers.map((item) =>
      item.kind === "source-owner" ? { ...item, scope: "template" } : item
    ),
  }
  write("LICENSE", "Copyright\nFormer Store Owner\n")
  write(
    "src/lib/store-config.ts",
    'import "module-that-must-not-be-executed"; export const storeConfig = storeSchema.parse({ configured: true, name: "New Store" })'
  )
  assert.deepEqual(check(scopedPolicy), [])
  write("accounts.json", JSON.stringify({ shop: identifiers[4][0] }))
  assert.ok(check(scopedPolicy).some((failure) => failure.includes("source-shop")))
  write("accounts.json", "{}")
  for (const content of [
    "// export const storeConfig = { configured: true }",
    'const example = "configured: true"; export const storeConfig = { configured: false }',
    "export const storeConfig = { configured: Boolean(true) }",
    "export const storeConfig = { configured: true, ...otherSettings }",
    "export const storeConfig = { configured: true, configured: false }",
    "export const storeConfig = { configured: true, ['configured']: false }",
    "export let storeConfig = { configured: true }",
    "export const storeConfig = { configured: true }; storeConfig.configured = false",
    "export const storeConfig = arbitraryFunction({ configured: true })",
    "export const storeConfig = { configured: true",
  ]) {
    write("src/lib/store-config.ts", content)
    assert.ok(check(scopedPolicy).some((failure) => failure.includes('"LICENSE":2: source-owner')))
  }
})

test("worktree and staged configuration scope are independent even when content bytes match", (t) => {
  const { write, git, check } = fixture(t)
  const scopedPolicy = {
    ...policy,
    forbiddenIdentifiers: policy.forbiddenIdentifiers.map((item) =>
      item.kind === "source-owner" ? { ...item, scope: "template" } : item
    ),
  }
  const configuration = (configured) => `export const storeConfig = { configured: ${configured} }`
  write("LICENSE", "Copyright\nFormer Store Owner\n")
  write("src/lib/store-config.ts", configuration(false))
  git("add", ".")
  git("update-index", "--assume-unchanged", "src/lib/store-config.ts")
  write("src/lib/store-config.ts", configuration(true))
  assert.deepEqual(check(scopedPolicy), ['"LICENSE":2 (index): source-owner'])
  git("update-index", "--no-assume-unchanged", "src/lib/store-config.ts")
  git("add", "src/lib/store-config.ts")
  assert.deepEqual(check(scopedPolicy), [])
  git("update-index", "--skip-worktree", "src/lib/store-config.ts")
  write("src/lib/store-config.ts", configuration(false))
  assert.deepEqual(check(scopedPolicy), ['"LICENSE":2: source-owner'])
})

test("an unsafe configuration symlink cannot disable template-scoped rules", (t) => {
  const { root, write, check } = fixture(t)
  const scopedPolicy = {
    ...policy,
    forbiddenIdentifiers: policy.forbiddenIdentifiers.map((item) => ({ ...item, scope: "template" })),
  }
  write("LICENSE", identifiers[1][0])
  write("private-config.ts", "export const storeConfig = { configured: true }")
  write(".gitignore", "private-config.ts\n")
  mkdirSync(join(root, "src/lib"), { recursive: true })
  symlinkSync(join(root, "private-config.ts"), join(root, "src/lib/store-config.ts"))
  assert.ok(check(scopedPolicy).some((failure) => failure.includes("source-owner")))
})

test("line diagnostics preserve multiline identity and never emit matched values", (t) => {
  const { write, check } = fixture(t)
  write("docs/leaks.txt", `Heading\nFormer\nStore Owner\n${secret}\n${["", "Users", "synthetic"].join("/")}\n`)
  const failures = check()
  assert.ok(failures.includes('"docs/leaks.txt":2: source-owner'))
  assert.ok(failures.includes('"docs/leaks.txt":4: provider/browser key'))
  assert.ok(failures.includes('"docs/leaks.txt":5: machine-local path'))
  assert.ok(!failures.join("\n").includes(secret))
})

test("large sets of changed files read indexed blobs in one Git batch", (t) => {
  const { write, git, check } = fixture(t)
  for (let index = 0; index < 24; index++) write(`docs/changed-${index}.txt`, `File ${index}\n${secret}`)
  write("binary.bin", Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(secret)]))
  git("add", ".")
  for (let index = 0; index < 24; index++) write(`docs/changed-${index}.txt`, "Clean working text")
  write("binary.bin", Buffer.from([0, 1, 2]))
  const originalExec = childProcess.execFileSync
  const calls = []
  t.mock.method(childProcess, "execFileSync", (...args) => {
    if (args[0] === "git") calls.push(args[1])
    return originalExec(...args)
  })
  syncBuiltinESMExports()
  try {
    const failures = check()
    assert.equal(failures.filter((failure) => failure.includes(":2 (index): provider/browser key")).length, 24)
    assert.ok(failures.includes('"binary.bin":1 (index): provider/browser key'))
    assert.equal(calls.filter((args) => args[0] === "cat-file" && args.includes("--batch")).length, 1)
    assert.equal(calls.filter((args) => args[0] === "show").length, 0)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
})

test("database URLs and Resend tokens reject secrets while safe hosts and placeholders stay usable", (t) => {
  const { write, check } = fixture(t)
  const databaseUrl = (host, password = "SyntheticPasswordNeverUsed") =>
    ["postgresql", "://", `store_app_runtime.synthetic:${password}@${host}/postgres`].join("")
  const safeHosts = [
    "localhost",
    "dev.localhost",
    "127.0.0.1",
    "127.20.30.40",
    "[::1]",
    "db.example",
    "db.example.com",
    "db.example.net",
    "db.test",
    "db.invalid",
  ]
  const unsafeHosts = [
    "db.production-host.com",
    "localhost.evil.com",
    "db.example.com.evil.com",
    "notexample.com",
    "db.test.evil.com",
    "127.0.0.1.evil.com",
    "private-host",
  ]
  for (const [index, host] of safeHosts.entries()) write(`docs/safe-${index}.txt`, databaseUrl(host))
  write("docs/placeholder.txt", databaseUrl("db.production-host.com", "PASSWORD"))
  write("docs/encoded-placeholder.txt", databaseUrl("db.production-host.com", "%3CPASSWORD%3E"))
  write(
    "docs/local-query.txt",
    ["postgresql", ":///postgres?user=fixture&password=SyntheticQueryPasswordNeverUsed&host=localhost"].join("")
  )
  assert.deepEqual(check(), [])
  for (const [index, host] of unsafeHosts.entries()) write(`docs/unsafe-${index}.txt`, databaseUrl(host))
  write("docs/postgres.txt", databaseUrl(unsafeHosts[0]).replace("postgresql", "postgres"))
  const resend = ["re", "SyntheticResendCredentialNeverIssued12345"].join("_")
  write("docs/mail.txt", `Mail setup\n${resend}\n`)
  const queryUrls = [
    databaseUrl(unsafeHosts[0], "").concat("?password=SyntheticQueryPasswordNeverUsed"),
    ["postgresql", "://", unsafeHosts[0], "/postgres?user=fixture&password=SyntheticQueryPasswordNeverUsed"].join(""),
    databaseUrl("localhost").concat(`?host=${unsafeHosts[0]}`),
    databaseUrl(unsafeHosts[0], "PASSWORD").concat("?password=SyntheticQueryPasswordNeverUsed"),
    databaseUrl(unsafeHosts[0]).concat("?password=PASSWORD&host=localhost"),
  ]
  for (const [index, url] of queryUrls.entries()) write(`docs/query-${index}.txt`, url)
  const failures = check()
  for (let index = 0; index < unsafeHosts.length; index++)
    assert.ok(failures.includes(`"docs/unsafe-${index}.txt":1: credentialed database URL`))
  assert.ok(failures.includes('"docs/mail.txt":2: provider/browser key'))
  assert.ok(failures.includes('"docs/postgres.txt":1: credentialed database URL'))
  for (let index = 0; index < queryUrls.length; index++)
    assert.ok(failures.includes(`"docs/query-${index}.txt":1: credentialed database URL`))
  assert.ok(!failures.join("\n").includes(resend))
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
  write("export.txt", Buffer.from("Heading\nFormer Store Owner", "utf16le"))
  const failures = check()
  assert.ok(
    failures.some((failure) => failure.startsWith('"metadata.bin"') && failure.includes("provider/browser key"))
  )
  assert.ok(failures.includes('"export.txt":2: source-owner'))
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
  assert.ok(check(licensePolicy).includes('"LICENSE":2: source-owner'))
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
  const bareHome = ["", "Users", "synthetic"].join("/")
  write(
    "docs/path-contexts.txt",
    [`<string>${paths[0]}</string>`, `a,${paths[1]}`, `a|${paths[1]}`, `HOME=${bareHome}`, `cd ${bareHome} && ls`].join(
      "\n"
    )
  )
  const failures = check()
  assert.equal(failures.filter((failure) => failure.includes("machine-local path")).length, 9)
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

test("a synthetic database exception allows only its exact bytes and path in both file and index", (t) => {
  const { write, git, check } = fixture(t)
  const value = ["postgresql", "://fixture_user:synthetic-password@db.company.dev/app"].join("")
  const path = "test/database-fixture.ts"
  const exception = { path, rule: "database-url", sha256: sha256(value), reason: "Synthetic fixture only" }
  const specific = { ...policy, allowedMatches: [exception] }
  write(path, value)
  assert.deepEqual(check(specific), [])
  git("add", path)
  write(path, value.replace("synthetic-password", "another-password"))
  assert.ok(check(specific).some((failure) => failure.includes("credentialed database URL")))
  git("add", path)
  write(path, value)
  assert.ok(
    check(specific).some((failure) => failure.includes(" (index)") && failure.includes("credentialed database URL"))
  )
  git("add", path)
  write(path, `${value}?password=changed-value`)
  assert.ok(check(specific).some((failure) => failure.includes("credentialed database URL")))
  write(path, value)
  write("test/other.ts", value)
  assert.ok(
    check(specific).some(
      (failure) => failure.includes("test/other.ts") && failure.includes("credentialed database URL")
    )
  )
})

test("data-only owner values select the brand scope without executing code, including staged transitions", (t) => {
  const { write, git, check } = fixture(t)
  const scopedPolicy = {
    ...policy,
    forbiddenIdentifiers: policy.forbiddenIdentifiers.map((item) =>
      item.kind === "source-owner" ? { ...item, scope: "template" } : item
    ),
  }
  write("LICENSE", "Copyright\nFormer Store Owner\n")
  write("src/lib/store-config.ts", "export const storeConfig = { configured: false }")
  git("add", ".")
  write(
    "src/lib/store-config.ts",
    'import "never-execute-me"; export const storeConfig = storeConfigSchema.parse(storeConfigValues)'
  )
  write("src/lib/store-config-values.ts", "export const storeConfigValues = { configured: true } satisfies OwnerInput")
  assert.deepEqual(check(scopedPolicy), ['"LICENSE":2 (index): source-owner'])
  git("add", ".")
  assert.deepEqual(check(scopedPolicy), [])
  write("src/lib/store-config-values.ts", "export const storeConfigValues = { configured: false }")
  assert.deepEqual(check(scopedPolicy), ['"LICENSE":2: source-owner'])
  write("src/lib/store-config-values.ts", "export const storeConfigValues = { configured: true, ...dynamic }")
  assert.ok(check(scopedPolicy).some((failure) => failure.includes("source-owner")))
  write("accounts.json", JSON.stringify({ shop: identifiers[4][0] }))
  assert.ok(check(scopedPolicy).some((failure) => failure.includes("source-shop")))
})
