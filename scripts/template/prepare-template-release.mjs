import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const canonicalRepository = "NerdOutInc/ai-shop-template"
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")

/** Prepare reproducible candidate metadata from committed bytes; never publish or change settings. */
export function prepareTemplateRelease(root, { ref, tag }) {
  if (!/^template-v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag ?? ""))
    throw new Error("Use the template-vMAJOR.MINOR.PATCH release namespace")
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(ref ?? "")) throw new Error("Supply a full pinned commit SHA")
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] })
  const remote = git("remote", "get-url", "origin").toString().trim()
  if (
    !/^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)NerdOutInc\/ai-shop-template(?:\.git)?$/i.test(
      remote
    )
  )
    throw new Error(`Release preparation is limited to ${canonicalRepository}; stores receive releases separately`)
  const commit = git("rev-parse", "--verify", `${ref}^{commit}`).toString().trim()
  if (commit !== ref) throw new Error("The pinned object must identify the commit itself")
  const read = (file) => git("show", `${commit}:${file}`)
  // The first release must establish the owner-data boundary before any generated copy.
  read("src/lib/store-config-values.ts")
  const recordPath = `docs/releases/${tag}.json`
  const recordBytes = read(recordPath)
  const record = JSON.parse(recordBytes.toString())
  if (
    record.schemaVersion !== 1 ||
    !Array.isArray(record.includedPullRequests) ||
    !record.includedPullRequests.length ||
    record.includedPullRequests.some((number) => !Number.isSafeInteger(number) || number < 1) ||
    new Set(record.includedPullRequests).size !== record.includedPullRequests.length ||
    record.upgradeNotes !== `docs/releases/${tag}.md`
  )
    throw new Error("Release record needs schemaVersion 1, distinct positive PR numbers and matching upgrade notes")
  const notes = read(record.upgradeNotes)
  if (!notes.toString().trim()) throw new Error("Upgrade notes must not be empty")
  const entries = git("ls-tree", "-r", "-z", commit, "--", "supabase/migrations").toString().split("\0").filter(Boolean)
  const migrations = entries
    .map((entry) => {
      const [metadata, file] = entry.split("\t")
      const [mode, type] = metadata.split(" ")
      if (
        type !== "blob" ||
        !mode.startsWith("100") ||
        !/^supabase\/migrations\/\d{14}_[A-Za-z0-9_-]+\.sql$/.test(file)
      )
        throw new Error("Release migrations must be ordinary, flat timestamped SQL files")
      return { filename: file.slice("supabase/migrations/".length), sha256: digest(read(file)) }
    })
    .sort((a, b) => a.filename.localeCompare(b.filename))
  if (!migrations.length || new Set(migrations.map((item) => item.filename.slice(0, 14))).size !== migrations.length)
    throw new Error("Release needs migrations with distinct timestamps")
  const sourceLedger = JSON.parse(read("docs/source-port-ledger.json").toString())
  return {
    schemaVersion: 1,
    state: "candidate",
    repository: canonicalRepository,
    tag,
    commit,
    tree: git("rev-parse", `${commit}^{tree}`).toString().trim(),
    lockfileSha256: digest(read("pnpm-lock.yaml")),
    migrations,
    includedPullRequests: record.includedPullRequests,
    releaseRecord: { path: recordPath, sha256: digest(recordBytes) },
    upgradeNotes: { path: record.upgradeNotes, sha256: digest(notes) },
    reviewedThroughSourceCommit: sourceLedger.coverage.reviewedThroughSourceCommit,
    pendingSourcePortReceipts: sourceLedger.dispositions
      .filter((item) => item.disposition === "accepted" && !item.templateCommit)
      .map((item) => ({ sourceCommit: item.sourceCommit, followUp: item.followUp })),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.length !== 4 || args[0] !== "--ref" || args[2] !== "--tag")
      throw new Error("Usage: prepare-template-release.mjs --ref FULL_SHA --tag template-vMAJOR.MINOR.PATCH")
    console.log(JSON.stringify(prepareTemplateRelease(process.cwd(), { ref: args[1], tag: args[3] }), null, 2))
  } catch (error) {
    console.error(`Release preparation failed: ${error.message}`)
    process.exitCode = 1
  }
}
