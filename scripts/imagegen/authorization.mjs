import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

export const PROGRESS_FILE = ".store-setup.local.json"

/**
 * Paid generation needs the owner's authorization. The skills already say that a large requested
 * count never authorizes switching to a paid API; this check is that rule, enforced before the
 * first request leaves the machine. A saved delegation is evidence the owner recorded it earlier
 * in this store's setup progress, not a fresh approval, so the dry run still reports its source.
 */
export async function resolvePaidApiAuthorization({ flags = [], cwd = process.cwd() } = {}) {
  if (flags.includes("--authorized-by-owner")) return { authorized: true, source: "flag" }
  let progress = null
  try {
    progress = JSON.parse(await readFile(resolve(cwd, PROGRESS_FILE), "utf8"))
  } catch {
    return { authorized: false, source: "none" }
  }
  const paidApi = progress?.delegation?.imageGeneration?.paidApi
  return paidApi === true ? { authorized: true, source: PROGRESS_FILE } : { authorized: false, source: "none" }
}
