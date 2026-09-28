import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const defaultPolicy = JSON.parse(readFileSync(new URL("./check-template-policy.json", import.meta.url), "utf8"))
const digest = (value) => createHash("sha256").update(value).digest("hex")
const posixHomePath = /(?:^|[\s"'`(=:\[])(?:file:\/\/)?\/(?:Users|home)\/[^/\s"'`]+\/[^\s"'`]+/m
const windowsHomePath = /\b[A-Z]:\\+Users\\+[^\\\s"'`]+\\+[^\s"'`]+/i
const privateKey = /-----BEGIN (?:RSA |DSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/
const providerKey =
  /\b(?:(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{20,}|sb_(?:secret|publishable)_[A-Za-z0-9_-]{20,}|whsec_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|vercel_blob_rw_[A-Za-z0-9_-]{20,})\b/g
const jwt = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}\b/g

function privatePath(file) {
  const parts = file.split("/")
  return (
    parts.some((part) => /^\.env(?:$|[.-])/.test(part) && file !== ".env.example") ||
    parts.some((part) =>
      [".envrc", ".vercel", ".netlify", ".auth", ".playwright-cli", ".store-setup.local.json"].includes(part)
    ) ||
    /(?:^|\/)supabase\/\.temp(?:\/|$)/.test(file) ||
    /(?:^|\/)(?:storage-state|storageState|auth-state)\.json$/.test(file) ||
    /(?:^|\/)design-agent-[^/]+\.token$/.test(file) ||
    (file.startsWith("assets/print/") && file !== "assets/print/README.md")
  )
}

function hasBrowserState(content) {
  try {
    const value = JSON.parse(content)
    return (
      value !== null &&
      typeof value === "object" &&
      ((Array.isArray(value.cookies) && value.cookies.length > 0) ||
        (Array.isArray(value.credentials) && value.credentials.length > 0) ||
        (Array.isArray(value.origins) &&
          value.origins.some(
            (origin) => origin?.localStorage?.length || origin?.indexedDB?.length || origin?.opfs?.length
          )))
    )
  } catch {
    return false
  }
}

function identifierKinds(content, policy) {
  const words =
    content
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? []
  const lengths = new Set(policy.forbiddenIdentifiers.map((item) => item.length))
  const fingerprints = new Map(policy.forbiddenIdentifiers.map((item) => [item.sha256, item.kind]))
  const maxWords = Math.max(3, ...policy.forbiddenIdentifiers.map((item) => item.wordCount))
  const found = new Set()
  for (let start = 0; start < words.length; start++) {
    let candidate = ""
    for (let end = start; end < Math.min(start + maxWords, words.length); end++) {
      candidate += words[end]
      if (!lengths.has(candidate.length)) continue
      const kind = fingerprints.get(digest(candidate))
      if (kind) found.add(kind)
    }
  }
  return found
}

/** Scan clone-visible files and pending index content; never print matched values. */
export function checkTemplate(root = process.cwd(), policy = defaultPolicy) {
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
  const files = [
    ...new Set(git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean)),
  ]
  const indexEntries = new Map(
    git(["ls-files", "--stage", "-z"])
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const tab = entry.indexOf("\t")
        const [mode, objectId] = entry.slice(0, tab).split(" ")
        return [entry.slice(tab + 1), { mode, objectId }]
      })
  )
  const objectFormat = git(["rev-parse", "--show-object-format"]).trim()
  const blobHash = (bytes) => createHash(objectFormat).update(`blob ${bytes.length}\0`).update(bytes).digest("hex")
  const failures = new Set()
  const report = (file, rule, location = "") => failures.add(`${JSON.stringify(file)}${location}: ${rule}`)
  const canonicalRoot = realpathSync(root)
  const allowedSymlink = (file, target) => {
    if (isAbsolute(target) || !policy.allowedSymlinks.some((item) => item.path === file && item.target === target))
      return false
    const destination = resolve(canonicalRoot, dirname(file), target)
    if (relative(canonicalRoot, destination).startsWith("..")) return false
    try {
      return realpathSync(destination) === destination && lstatSync(destination).isDirectory()
    } catch {
      return false
    }
  }
  const scan = (file, bytes, location = "") => {
    const sha256 = digest(bytes)
    const allowed = (rule) =>
      policy.allowedFiles.some((item) => item.path === file && item.rule === rule && item.sha256 === sha256)
    if (policy.forbiddenAssetSha256.includes(sha256)) report(file, "source-store asset", location)
    // NUL bytes do not make a file safe: scan binary metadata and UTF-16 exports too.
    const contents = [bytes.toString("utf8"), ...(bytes.includes(0) ? [bytes.toString("utf16le")] : [])]
    for (const content of contents) {
      if (posixHomePath.test(content) || windowsHomePath.test(content)) report(file, "machine-local path", location)
      if (privateKey.test(content) && !allowed("private-key")) report(file, "private-key material", location)
      const keys = [...(content.match(providerKey) ?? []), ...(content.match(jwt) ?? [])]
      if (
        keys.some(
          (value) =>
            !policy.allowedMatches.some(
              (item) => item.path === file && item.rule === "provider-key" && item.sha256 === digest(value)
            )
        )
      )
        report(file, "provider/browser key", location)
      if (hasBrowserState(content)) report(file, "browser authentication state", location)
      const identityContent = content
        .split(/\r?\n/)
        .filter(
          (line) => !policy.allowedIdentifierLines.some((item) => item.path === file && item.sha256 === digest(line))
        )
        .join("\n")
      for (const kind of identifierKinds(identityContent, policy)) report(file, kind, location)
    }
  }
  for (const file of files) {
    const indexEntry = indexEntries.get(file)
    let matchesIndex = false
    if (privatePath(file)) report(file, "private setup state or print artifact must not be tracked")
    if (posixHomePath.test(file) || windowsHomePath.test(file)) report(file, "machine-local path")
    for (const kind of identifierKinds(file, policy)) report(file, kind)
    if (indexEntry?.mode === "160000") report(file, "embedded repository in index")
    if (indexEntry?.mode === "120000") {
      const target = git(["show", `:${file}`])
      if (!allowedSymlink(file, target)) report(file, "unapproved symlink in index")
    }
    let unsafe = false
    const parts = file.split("/")
    for (let i = 1; i <= parts.length; i++) {
      try {
        const info = lstatSync(join(root, ...parts.slice(0, i)))
        if (info.isSymbolicLink()) {
          if (i !== parts.length || !allowedSymlink(file, readlinkSync(join(root, file))))
            report(file, "unapproved symlink must not enter the template")
          unsafe = true
          break
        }
        if (i === parts.length && !info.isFile()) {
          report(file, "not a regular file")
          unsafe = true
        }
      } catch (error) {
        if (error.code !== "ENOENT") report(file, "file metadata could not be read")
        unsafe = true
        break
      }
    }
    if (!unsafe) {
      try {
        const bytes = readFileSync(join(root, file))
        matchesIndex = indexEntry?.objectId === blobHash(bytes)
        scan(file, bytes)
      } catch {
        report(file, "file content could not be read")
      }
    }
    // Git diff can hide edits behind assume-unchanged or skip-worktree. Compare
    // raw blob bytes so those flags cannot conceal a different staged secret.
    if (!matchesIndex && indexEntry?.mode.startsWith("100")) {
      try {
        scan(file, execFileSync("git", ["show", `:${file}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 }), " (index)")
      } catch {
        report(file, "index content could not be read")
      }
    }
  }
  return { files: files.length, failures: [...failures] }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkTemplate()
    if (result.failures.length) {
      console.error(`Template hygiene failed:\n${result.failures.map((item) => `- ${item}`).join("\n")}`)
      process.exitCode = 1
    } else
      console.log(
        `Template hygiene passed (${result.files} files; known identity, credential, private-state and asset rules).`
      )
  } catch {
    console.error("Template hygiene could not inspect the Git working tree.")
    process.exitCode = 1
  }
}
