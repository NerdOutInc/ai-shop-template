import "server-only"

import { isIP } from "node:net"

import { headers } from "next/headers"

export type PublicRequestIdentity = {
  subject: string
  limit: number
  /** The address to record as proof of sign-up, or null when there is no trustworthy one. */
  address: string | null
}

/**
 * URL canonicalizes an IPv6 address (compressing zero runs) but hands it back inside the brackets its
 * own syntax needs. They have to come off: this value is stored in an `inet` column, and Postgres
 * rejects a bracketed address outright. Null for what URL refuses, such as a zone id (`fe80::1%eth0`),
 * which `isIP` happily accepts.
 */
function canonicalizeIPv6(address: string) {
  try {
    return new URL(`http://[${address}]`).hostname.slice(1, -1)
  } catch {
    return null
  }
}

/**
 * One customer is routinely handed a whole /64, so a bucket per address would give a flooder 2^64 of
 * them. IPv4-mapped addresses all sit in ::/64, so each of those stays its own bucket.
 */
function getIPv6Subject(canonical: string) {
  if (canonical.startsWith("::ffff:")) return canonical
  const [head, tail] = canonical.split("::")
  const left = head ? head.split(":") : []
  const right = tail ? tail.split(":") : []
  const zeros = Array<string>(8 - left.length - right.length).fill("0")
  const hextets = tail === undefined ? left : [...left, ...zeros, ...right]
  return `${hextets.slice(0, 4).join(":")}::/64`
}

/**
 * Who to count this request against, and how generously.
 *
 * On Vercel the platform's own forwarded address is the only trustworthy identity; a caller-supplied
 * `x-forwarded-for` is never read, because a flooder would simply vary it. A missing or malformed
 * address FAILS CLOSED — the route refuses — since treating it as "no bucket, so allow" would hand
 * the form to anyone able to reach it off the platform's header path. IPv6 is counted by /64 but
 * recorded in full: the bucket is about abuse, the address is the proof of sign-up.
 *
 * Off Vercel there is no per-visitor identity at all, so everyone shares one bucket with a much
 * larger allowance. That is a local and preview affordance, NOT production protection: without it
 * three browser projects plus anyone clicking would lock each other out inside one window and the
 * suite would be flaky by construction. Keying on the submitted address instead would be worse than
 * nothing, because the address is caller-controlled.
 */
export async function getPublicRequestIdentity(): Promise<PublicRequestIdentity | null> {
  if (process.env.VERCEL === "1") {
    const forwarded = (await headers()).get("x-vercel-forwarded-for")
    if (!forwarded || !isIP(forwarded)) return null
    if (isIP(forwarded) === 4) return { subject: forwarded, limit: 5, address: forwarded }
    const address = canonicalizeIPv6(forwarded)
    if (address === null) return null
    return { subject: getIPv6Subject(address), limit: 5, address }
  }
  // No trustworthy address off the platform, and inventing one would be worse than a null.
  return { subject: "unidentified-host", limit: 60, address: null }
}
