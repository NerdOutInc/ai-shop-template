import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { isConfiguredStore } from "./is-configured-store.mjs"
import { isCredentialedDatabaseUrl } from "./is-credentialed-database-url.mjs"
import { readIndexBlobs } from "./read-index-blobs.mjs"

const defaultPolicy = JSON.parse(readFileSync(new URL("./check-template-policy.json", import.meta.url), "utf8"))
const digest = (value) => createHash("sha256").update(value).digest("hex")
const posixHomePath = /(?<![\w.~%/-])(?:file:\/\/)?\/(?:Users|home)\/[^/\s"'`<>|,]+(?:\/|$|[\s"'`<>|,])/m
const windowsHomePath = /\b[A-Z]:\\+Users\\+[^\\\s"'`<>|,]+(?:\\+|$|[\s"'`<>|,])/i
const privateKey = /-----BEGIN (?:RSA |DSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/
const providerKey =
  /\b(?:(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{20,}|sb_(?:secret|publishable)_[A-Za-z0-9_-]{20,}|whsec_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|vercel_blob_rw_[A-Za-z0-9_-]{20,}|re_[A-Za-z0-9_-]{20,})\b/g
const jwt = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}\b/g
const databaseUrl = /\bpostgres(?:ql)?:\/\/[^\s"'`<>\\]+/gi

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

function identifierMatches(content, identifiers) {
  const words = content.split(/\r?\n/).flatMap((line, index) =>
    (
      line
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
        .toLowerCase()
        .match(/[a-z0-9]+/g) ?? []
    ).map((value) => ({ value, line: index + 1 }))
  )
  const lengths = new Set(identifiers.map((item) => item.length))
  const fingerprints = new Map(identifiers.map((item) => [item.sha256, item]))
  const maxWords = Math.max(3, ...identifiers.map((item) => item.wordCount))
  const found = new Map()
  for (let start = 0; start < words.length; start++) {
    let candidate = ""
    for (let end = start; end < Math.min(start + maxWords, words.length); end++) {
      candidate += words[end].value
      if (!lengths.has(candidate.length)) continue
      const identifier = fingerprints.get(digest(candidate))
      if (identifier)
        found.set(`${identifier.kind}:${words[start].line}`, {
          kind: identifier.kind,
          scope: identifier.scope,
          line: words[start].line,
        })
    }
  }
  return found.values()
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
  const report = (file, rule, location = "", line = 1) =>
    failures.add(`${JSON.stringify(file)}:${line}${location}: ${rule}`)
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
  const scan = (file, bytes, configured, location = "") => {
    const templateMatches = []
    const sha256 = digest(bytes)
    const allowed = (rule) =>
      policy.allowedFiles.some((item) => item.path === file && item.rule === rule && item.sha256 === sha256)
    if (policy.forbiddenAssetSha256.includes(sha256)) report(file, "source-store asset", location)
    // NUL bytes do not make a file safe: scan binary metadata and UTF-16 exports too.
    const contents = [bytes.toString("utf8"), ...(bytes.includes(0) ? [bytes.toString("utf16le")] : [])]
    for (const content of contents) {
      const lineAt = (index) => content.slice(0, index).split("\n").length
      const matches = (pattern) => content.matchAll(new RegExp(pattern.source, pattern.flags.replace("g", "") + "g"))
      for (const pattern of [posixHomePath, windowsHomePath]) {
        for (const match of matches(pattern)) report(file, "machine-local path", location, lineAt(match.index))
      }
      if (!allowed("private-key")) {
        for (const match of matches(privateKey)) report(file, "private-key material", location, lineAt(match.index))
      }
      for (const match of [...matches(providerKey), ...matches(jwt)]) {
        if (
          !policy.allowedMatches.some(
            (item) => item.path === file && item.rule === "provider-key" && item.sha256 === digest(match[0])
          )
        ) {
          report(file, "provider/browser key", location, lineAt(match.index))
        }
      }
      for (const match of matches(databaseUrl)) {
        if (isCredentialedDatabaseUrl(match[0]))
          report(file, "credentialed database URL", location, lineAt(match.index))
      }
      if (hasBrowserState(content)) {
        const start = content.search(/"(?:cookies|origins|credentials)"\s*:/)
        report(file, "browser authentication state", location, lineAt(Math.max(start, 0)))
      }
      const identityContent = content
        .split(/\r?\n/)
        .map((line) =>
          policy.allowedIdentifierLines.some((item) => item.path === file && item.sha256 === digest(line)) ? "" : line
        )
        .join("\n")
      for (const match of identifierMatches(identityContent, policy.forbiddenIdentifiers)) {
        if (match.scope === "template") templateMatches.push(match)
        if (match.scope !== "template" || !configured) report(file, match.kind, location, match.line)
      }
    }
    return templateMatches
  }
  const readWorkingFile = (file) => {
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
        return readFileSync(join(root, file))
      } catch {
        report(file, "file content could not be read")
      }
    }
    return undefined
  }
  const configPath = "src/lib/store-config.ts"
  const configBytes = files.includes(configPath) ? readWorkingFile(configPath) : undefined
  const configured = isConfiguredStore(configBytes)
  const matchingIndexFiles = new Set()
  const matchingTemplateLocations = new Map()
  const requestedBlobs = new Set()
  for (const file of files) {
    const indexEntry = indexEntries.get(file)
    if (privatePath(file)) report(file, "private setup state or print artifact must not be tracked")
    if (posixHomePath.test(file) || windowsHomePath.test(file)) report(file, "machine-local path")
    if (indexEntry?.mode === "160000") report(file, "embedded repository in index")
    for (const { kind, scope } of identifierMatches(file, policy.forbiddenIdentifiers)) {
      if (scope !== "template" || !configured) report(file, kind)
    }
    const bytes = file === configPath ? configBytes : readWorkingFile(file)
    if (bytes) {
      const templateMatches = scan(file, bytes, configured)
      if (indexEntry?.objectId === blobHash(bytes)) {
        matchingIndexFiles.add(file)
        if (templateMatches.length) matchingTemplateLocations.set(file, templateMatches)
      }
    }
    if (
      indexEntry &&
      (indexEntry.mode === "120000" || (indexEntry.mode.startsWith("100") && !matchingIndexFiles.has(file)))
    ) {
      requestedBlobs.add(indexEntry.objectId)
    }
  }
  // Compare raw blobs rather than Git diff (which honors skip-worktree and
  // assume-unchanged), then fetch every mismatch through one binary-safe batch.
  let indexBlobs = new Map()
  try {
    indexBlobs = readIndexBlobs(root, requestedBlobs)
  } catch {
    for (const [file, entry] of indexEntries) {
      if (requestedBlobs.has(entry.objectId)) report(file, "index content could not be read", " (index)")
    }
  }
  const indexConfigured =
    indexEntries.get(configPath)?.mode.startsWith("100") &&
    isConfiguredStore(
      matchingIndexFiles.has(configPath) ? configBytes : indexBlobs.get(indexEntries.get(configPath)?.objectId)
    )
  for (const file of files) {
    const entry = indexEntries.get(file)
    if (entry?.mode === "120000") {
      const target = indexBlobs.get(entry.objectId)
      if (target && !allowedSymlink(file, target.toString("utf8")))
        report(file, "unapproved symlink in index", " (index)")
    }
    if (entry?.mode.startsWith("100")) {
      const bytes = indexBlobs.get(entry.objectId)
      if (bytes && !matchingIndexFiles.has(file)) scan(file, bytes, indexConfigured, " (index)")
      // Retain match locations, not every working file's bytes, when unchanged
      // index content needs stricter scope than the current configuration.
      if (configured && !indexConfigured) {
        for (const { kind, line } of matchingTemplateLocations.get(file) ?? []) report(file, kind, " (index)", line)
        for (const { kind, scope } of identifierMatches(file, policy.forbiddenIdentifiers)) {
          if (scope === "template") report(file, kind, " (index)")
        }
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
