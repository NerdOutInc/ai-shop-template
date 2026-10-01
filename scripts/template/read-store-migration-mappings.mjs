import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs"
import { resolve } from "node:path"

const filename = /^\d{14}_[A-Za-z0-9_-]+\.sql$/
const sha256 = /^[a-f0-9]{64}$/
const commit = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

function regularLocalFile(file) {
  try {
    return lstatSync(file).isFile() && realpathSync(file) === file
  } catch {
    return false
  }
}

/** Alias canonical references only after validating a reviewed receiving-store receipt and local bytes. */
export function readStoreMigrationMappings(root) {
  root = realpathSync(root)
  const mappings = new Map()
  const errors = []
  const ledgerPath = resolve(root, "docs/store-update-ledger.json")
  // lstat also finds dangling symlinks; neither those nor an unreadable ledger may silently disable validation.
  if (!existsSync(ledgerPath)) {
    try {
      lstatSync(ledgerPath)
    } catch (error) {
      if (error.code === "ENOENT") return { mappings, errors }
      throw error
    }
  }
  const fail = (message) => errors.push(`docs/store-update-ledger.json: ${message}`)
  let ledger
  try {
    if (!regularLocalFile(ledgerPath)) throw new Error("not a regular local file")
    ledger = JSON.parse(readFileSync(ledgerPath, "utf8"))
  } catch {
    fail("cannot read an ordinary JSON ledger")
    return { mappings, errors }
  }
  if (
    ledger?.schemaVersion !== 1 ||
    (ledger.migrationMappings !== undefined && !Array.isArray(ledger.migrationMappings))
  ) {
    fail("expected schemaVersion 1 and an optional migrationMappings array")
    return { mappings, errors }
  }
  const canonicalNames = new Set()
  const localNames = new Set()
  for (const [index, item] of (ledger.migrationMappings ?? []).entries()) {
    const label = `migrationMappings[${index}]`
    if (
      !item ||
      !["canonicalFilename", "localFilename", "canonicalSha256", "localSha256", "templateCommit"].every(
        (key) => typeof item[key] === "string"
      ) ||
      !filename.test(item.canonicalFilename) ||
      !filename.test(item.localFilename) ||
      !sha256.test(item.canonicalSha256) ||
      !sha256.test(item.localSha256) ||
      !commit.test(item.templateCommit) ||
      typeof item.reason !== "string" ||
      !item.reason.trim() ||
      item.canonicalFilename === item.localFilename
    ) {
      fail(`${label}: require distinct safe filenames, full template commit, SHA-256 hashes and a review reason`)
      continue
    }
    if (canonicalNames.has(item.canonicalFilename) || localNames.has(item.localFilename)) {
      fail(`${label}: duplicate canonical or local migration`)
      continue
    }
    canonicalNames.add(item.canonicalFilename)
    localNames.add(item.localFilename)
    const localPath = resolve(root, "supabase/migrations", item.localFilename)
    if (!regularLocalFile(localPath)) {
      fail(`${label}: local migration must be an ordinary file inside supabase/migrations`)
      continue
    }
    const digest = createHash("sha256").update(readFileSync(localPath)).digest("hex")
    if (digest !== item.localSha256) {
      fail(`${label}: local migration checksum mismatch`)
      continue
    }
    const canonicalPath = resolve(root, "supabase/migrations", item.canonicalFilename)
    if (existsSync(canonicalPath)) {
      fail(`${label}: canonical migration is present; a forward-port alias must not coexist with it`)
      continue
    }
    mappings.set(item.canonicalFilename, { ...item, localPath })
  }
  // Do not use a partially valid map or chained aliases when the receipt is ambiguous.
  for (const name of localNames) if (canonicalNames.has(name)) fail("migration aliases cannot form chains or cycles")
  if (errors.length) mappings.clear()
  return { mappings, errors }
}
