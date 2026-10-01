import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { isDeepStrictEqual } from "node:util"

import { readStoreMigrationMappings } from "./read-store-migration-mappings.mjs"

const directory = "supabase/migrations/"
const filename = /^\d{14}_[A-Za-z0-9_-]+\.sql$/

/** Compare immutable migration receipts with an explicit prior Git commit, including staged edits. */
export function checkMigrationHistory(root, baseRef) {
  const { errors } = readStoreMigrationMappings(root)
  const git = (args) => execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], maxBuffer: Infinity })
  let base
  const emptyHistory = /^(?:0{40}|0{64})$/.test(baseRef ?? "")
  try {
    if (!baseRef) throw new Error("missing base")
    if (!emptyHistory)
      base = git(["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`])
        .toString()
        .trim()
  } catch {
    return [
      ...errors,
      "Migration history: base commit is unavailable; fetch it and set MIGRATION_BASE_REF for pnpm check, or pass --base to check:migration-history",
    ]
  }
  const previous = new Map()
  if (base) {
    for (const entry of git(["ls-tree", "-r", "-z", base, "--", directory]).toString().split("\0").filter(Boolean)) {
      const [metadata, file] = entry.split("\t")
      if (!file.endsWith(".sql")) continue
      const [mode, type, oid] = metadata.split(" ")
      previous.set(file, { mode, type, oid })
    }
  }
  const sharedFiles = new Set()
  if (base) {
    const shared = git(["merge-base", "HEAD", base]).toString().trim()
    for (const file of git(["ls-tree", "-r", "--name-only", shared, "--", directory]).toString().trim().split("\n"))
      sharedFiles.add(file)
  }
  const staged = new Map()
  for (const entry of git(["ls-files", "--stage", "-z", "--", directory]).toString().split("\0").filter(Boolean)) {
    const [metadata, file] = entry.split("\t")
    const [mode, oid, stage] = metadata.split(" ")
    if (stage !== "0") errors.push(`${file}: unresolved migration conflict`)
    staged.set(file, { mode, oid })
  }
  for (const [file, old] of previous) {
    const local = resolve(root, file)
    try {
      if (!lstatSync(local).isFile()) throw new Error("not regular")
    } catch {
      errors.push(
        !existsSync(local) && !sharedFiles.has(file)
          ? `${file}: branch is behind ${baseRef}; fetch and update it before checking migrations`
          : `${file}: merged migration removed, renamed or replaced`
      )
      continue
    }
    const localOid = git(["hash-object", "--no-filters", local]).toString().trim()
    if (old.type !== "blob" || !old.mode.startsWith("100") || localOid !== old.oid)
      errors.push(`${file}: merged migration bytes changed; add a forward migration instead`)
    const index = staged.get(file)
    if (!index || index.oid !== old.oid || index.mode !== old.mode)
      errors.push(`${file}: merged migration changed or removed in the index`)
  }
  const lastVersion = [...previous.keys()]
    .map((file) => file.slice(directory.length, directory.length + 14))
    .sort()
    .at(-1)
  const stagedVersions = new Set()
  for (const file of staged.keys()) {
    if (!file.endsWith(".sql")) continue
    const name = file.slice(directory.length)
    const version = name.slice(0, 14)
    if (!filename.test(name)) errors.push(`${file}: require a flat timestamped SQL migration in the index`)
    if (stagedVersions.has(version)) errors.push(`${file}: duplicate migration timestamp in the index`)
    stagedVersions.add(version)
    if (!previous.has(file) && lastVersion && version <= lastVersion)
      errors.push(`${file}: new staged migration must follow ${lastVersion}`)
  }
  const versions = new Set()
  const migrationsPath = resolve(root, directory)
  if (existsSync(migrationsPath)) {
    for (const name of readdirSync(migrationsPath).sort()) {
      if (!name.endsWith(".sql")) continue
      const file = `${directory}${name}`
      if (!filename.test(name) || !lstatSync(resolve(root, file)).isFile()) {
        errors.push(`${file}: require an ordinary timestamped SQL migration`)
        continue
      }
      const version = name.slice(0, 14)
      if (versions.has(version)) errors.push(`${file}: duplicate migration timestamp`)
      versions.add(version)
      if (!previous.has(file) && lastVersion && version <= lastVersion)
        errors.push(`${file}: new migration must follow ${lastVersion}; prepare a reviewed forward port and mapping`)
    }
  }
  if (base) {
    const ledgerPath = "docs/store-update-ledger.json"
    const tree = git(["ls-tree", "-z", base, "--", ledgerPath]).toString()
    if (tree) {
      try {
        const old = JSON.parse(git(["show", `${base}:${ledgerPath}`]).toString())
        const current = JSON.parse(readFileSync(resolve(root, ledgerPath), "utf8"))
        const indexed = JSON.parse(git(["show", `:${ledgerPath}`]).toString())
        for (const [location, ledger] of [
          ["worktree", current],
          ["index", indexed],
        ]) {
          for (const item of old.migrationMappings ?? []) {
            const matching =
              ledger.migrationMappings?.filter((entry) => entry.canonicalFilename === item.canonicalFilename) ?? []
            if (matching.length !== 1 || !isDeepStrictEqual(item, matching[0]))
              errors.push(`${ledgerPath}: merged migration mapping changed or removed (${location})`)
          }
        }
      } catch {
        errors.push(`${ledgerPath}: cannot compare prior migration receipts`)
      }
    }
  }
  return [...new Set(errors)].sort()
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.length && (args.length !== 2 || args[0] !== "--base"))
      throw new Error("Usage: check-migration-history.mjs [--base REF]")
    const errors = checkMigrationHistory(process.cwd(), args[1] ?? process.env.MIGRATION_BASE_REF ?? "origin/main")
    if (errors.length) {
      console.error(errors.join("\n"))
      process.exitCode = 1
    } else console.log("Merged migration history checks passed.")
  } catch (error) {
    console.error(`Migration history checks failed: ${error.message}`)
    process.exitCode = 1
  }
}
