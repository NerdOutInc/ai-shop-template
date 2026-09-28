import "server-only"

import { isIP } from "node:net"
import { headers } from "next/headers"
import { isAdminLocalDevelopment } from "./is-admin-local-development"

export async function getAdminAuthSource(): Promise<string | null> {
  // Vercel supplies this header itself. Never accept caller-controlled forwarding
  // headers on an unrecognized deployment or use the target email as its identity.
  if (process.env.VERCEL === "1") {
    const address = (await headers()).get("x-vercel-forwarded-for")
    if (!address || !isIP(address)) return null
    return isIP(address) === 6 ? new URL(`http://[${address}]`).hostname : address
  }
  return isAdminLocalDevelopment() ? "local-development" : null
}
