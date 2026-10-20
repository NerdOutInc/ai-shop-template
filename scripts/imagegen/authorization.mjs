import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

export const PROGRESS_FILE = ".store-setup.local.json"

/**
 * Paid generation needs the owner's authorization from the active conversation, asserted with
 * `--authorized-by-owner`. The skills already say that a large requested count never authorizes
 * switching to a paid API; this check is that rule, enforced before the first request leaves the
 * machine. A `delegation.imageGeneration.paidApi` value saved in setup progress is reported as
 * evidence the agent can cite, never as permission on its own: `.worktreeinclude` copies that
 * file into later worktrees, where the owner's actual instruction and its scope may be unknown.
 */
export async function resolvePaidApiAuthorization({ flags = [], cwd = process.cwd() } = {}) {
  let savedDelegation = null
  try {
    const progress = JSON.parse(await readFile(resolve(cwd, PROGRESS_FILE), "utf8"))
    const paidApi = progress?.delegation?.imageGeneration?.paidApi
    savedDelegation = typeof paidApi === "boolean" ? paidApi : null
  } catch {
    savedDelegation = null
  }
  const authorized = flags.includes("--authorized-by-owner")
  return { authorized, source: authorized ? "flag" : "none", savedDelegation }
}
