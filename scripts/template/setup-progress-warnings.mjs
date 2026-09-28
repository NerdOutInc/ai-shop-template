import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

export function setupProgressWarnings(cwd, setupState) {
  let worktrees
  try {
    worktrees = execFileSync("git", ["worktree", "list", "--porcelain", "-z"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
  } catch {
    return []
  }
  const currentTimestamp = Date.parse(setupState?.resume?.updatedAt)
  let newer = 0
  let unreadable = 0
  for (const record of worktrees.split("\0")) {
    if (!record.startsWith("worktree ")) continue
    const directory = record.slice("worktree ".length)
    if (path.resolve(directory) === path.resolve(cwd)) continue
    try {
      const progress = JSON.parse(readFileSync(path.join(directory, ".store-setup.local.json"), "utf8"))
      const timestamp = Date.parse(progress?.resume?.updatedAt)
      if (Number.isFinite(timestamp) && (!Number.isFinite(currentTimestamp) || timestamp > currentTimestamp)) newer++
    } catch (error) {
      if (error.code !== "ENOENT") unreadable++
    }
  }
  return [
    ...(newer
      ? [
          `Newer setup progress exists in ${newer} other worktree(s). Inspect git worktree list and reconcile the non-secret .store-setup.local.json snapshots before resuming; no files were copied.`,
        ]
      : []),
    ...(unreadable
      ? [`Setup progress could not be read in ${unreadable} other worktree(s); progress comparison is incomplete.`]
      : []),
  ]
}
