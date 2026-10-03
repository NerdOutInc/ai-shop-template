import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const canonicalRepository = "NerdOutInc/ai-shop-template"
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")

/** Prepare reproducible candidate metadata from committed bytes; never publish or change settings. */
export function prepareTemplateRelease(root, { ref, tag, candidate = false }) {
  if (!/^template-v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag ?? ""))
    throw new Error("Use the template-vMAJOR.MINOR.PATCH release namespace")
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(ref ?? "")) throw new Error("Supply a full pinned commit SHA")
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], maxBuffer: Infinity })
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
  let mainCommit
  try {
    mainCommit = git("rev-parse", "--verify", "origin/main^{commit}").toString().trim()
  } catch {
    throw new Error("Fetch origin/main with full history before preparing metadata")
  }
  if (candidate) {
    try {
      git("merge-base", "--is-ancestor", mainCommit, commit)
    } catch {
      throw new Error("Candidate must include fetched origin/main; update the branch and release inventory")
    }
  }
  const history = git("log", "--first-parent", "--format=%H %s", commit).toString().trim().split("\n")
  const mainHistory = git("log", "--first-parent", "--format=%H %s", mainCommit).toString().trim().split("\n")
  // Rebase merges can lose PR labels. An operator verifies these receipts against GitHub;
  // require merged main commits within the pinned ancestry; a branch cannot supply a receipt.
  const receipts = record.rebasedPullRequests === undefined ? [] : record.rebasedPullRequests
  if (
    !Array.isArray(receipts) ||
    receipts.some(
      (item) =>
        !item ||
        !Number.isSafeInteger(item.number) ||
        !record.includedPullRequests.includes(item.number) ||
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(item.commit ?? "") ||
        (!candidate && !history.some((line) => line.startsWith(`${item.commit} `))) ||
        !mainHistory.some((line) => line.startsWith(`${item.commit} `))
    ) ||
    new Set(receipts.map((item) => item.number)).size !== receipts.length ||
    new Set(receipts.map((item) => item.commit)).size !== receipts.length
  )
    throw new Error("Rebased PR receipts need distinct listed PRs and full commits in pinned and fetched main history")
  const pullRequests = (lines) =>
    [
      ...new Set([
        ...lines.flatMap((line) => {
          const subject = line.slice(line.indexOf(" ") + 1)
          const match = subject.match(/\(#([1-9]\d*)\)\s*$/) ?? subject.match(/^Merge pull request #([1-9]\d*) from /)
          return match ? [Number(match[1])] : []
        }),
        ...receipts.map((item) => item.number),
      ]),
    ].sort((a, b) => a - b)
  const historyPullRequests = candidate
    ? [...new Set([...pullRequests(history), ...pullRequests(mainHistory)])].sort((a, b) => a - b)
    : pullRequests(history)
  const mergedPullRequests = candidate ? pullRequests(mainHistory) : historyPullRequests
  const unmergedListedPullRequests = record.includedPullRequests.filter(
    (number) => !mergedPullRequests.includes(number)
  )
  const unlistedHistoryPullRequests = historyPullRequests.filter(
    (number) => !record.includedPullRequests.includes(number)
  )
  if (!candidate) {
    try {
      git("merge-base", "--is-ancestor", commit, mainCommit)
    } catch {
      throw new Error("Pinned commit is not on fetched origin/main; use --candidate only for unmerged review")
    }
  }
  if (unlistedHistoryPullRequests.length || (!candidate && unmergedListedPullRequests.length))
    throw new Error(
      `PR record/history mismatch: listed but absent ${unmergedListedPullRequests.join(",") || "none"}; merged but unlisted ${unlistedHistoryPullRequests.join(",") || "none"}`
    )
  const publicationBlockers = record.publicationBlockers === undefined ? [] : record.publicationBlockers
  if (
    !Array.isArray(publicationBlockers) ||
    publicationBlockers.some(
      (item) =>
        !item ||
        typeof item.id !== "string" ||
        !item.id.trim() ||
        typeof item.reason !== "string" ||
        !item.reason.trim()
    ) ||
    new Set(publicationBlockers.map((item) => item.id)).size !== publicationBlockers.length
  )
    throw new Error("Publication blockers need distinct nonempty ids and reasons")
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
    includedPullRequests: historyPullRequests,
    proposedPullRequests: record.includedPullRequests,
    rebasedPullRequests: receipts,
    pullRequestVerification: {
      mode: candidate ? "unmerged-candidate" : "main-history",
      mainCommit,
      mergedPullRequests,
      unmergedListedPullRequests,
      unlistedHistoryPullRequests,
    },
    releaseRecord: { path: recordPath, sha256: digest(recordBytes) },
    upgradeNotes: { path: record.upgradeNotes, sha256: digest(notes) },
    reviewedThroughSourceCommit: sourceLedger.coverage.reviewedThroughSourceCommit,
    pendingSourcePortReceipts: sourceLedger.dispositions
      .filter((item) => item.disposition === "accepted" && !item.templateCommit)
      .map((item) => ({ sourceCommit: item.sourceCommit, followUp: item.followUp })),
    pendingSourcePortFollowUps: sourceLedger.dispositions
      .filter((item) => item.disposition === "accepted" && item.followUp)
      .map((item) => ({
        sourceCommit: item.sourceCommit,
        templateCommit: item.templateCommit,
        followUp: item.followUp,
      })),
    publicationBlockers,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    const candidate = args.at(-1) === "--candidate"
    if (candidate) args.pop()
    if (args.length !== 4 || args[0] !== "--ref" || args[2] !== "--tag")
      throw new Error(
        "Usage: prepare-template-release.mjs --ref FULL_SHA --tag template-vMAJOR.MINOR.PATCH [--candidate]"
      )
    console.log(
      JSON.stringify(prepareTemplateRelease(process.cwd(), { ref: args[1], tag: args[3], candidate }), null, 2)
    )
  } catch (error) {
    console.error(`Release preparation failed: ${error.message}`)
    process.exitCode = 1
  }
}
