import "server-only"
import { storeConfig } from "@/lib/store-config"

import type { DropSignupRequest } from "./drop-signup-request"
import { getDropSignupStore } from "./get-drop-signup-store.server"
import { getPublicRequestIdentity } from "./get-public-request-identity.server"
import { normalizeEmail } from "./normalize-email"

export type SubscribeResult = "saved" | "unidentified" | "rate-limited" | "unavailable"

/**
 * Take a signup, or say why not.
 *
 * Orchestration lives here rather than in the route so a future Server Action can call exactly the
 * same thing without a guard moving.
 */
export async function subscribeToDrops(input: DropSignupRequest): Promise<SubscribeResult> {
  // A filled honeypot is a script, not a person. Report success and write nothing: the response must
  // teach a bot nothing about why it failed.
  if (input.company !== undefined && input.company !== "") return "saved"

  if (!storeConfig.configured || !storeConfig.policies.published) return "unavailable"

  const identity = await getPublicRequestIdentity()
  // Fail closed. "No bucket, so allow" would hand the form to anyone off the platform's header path.
  if (identity === null) return "unidentified"

  try {
    const store = getDropSignupStore()
    if (!(await store.allowRequest(identity.subject, identity.limit))) return "rate-limited"
    await store.subscribe(normalizeEmail(input.email), input.source, identity.address)
    return "saved"
  } catch {
    console.warn("Drop signup unavailable", { reason: "storage" })
    return "unavailable"
  }
}
