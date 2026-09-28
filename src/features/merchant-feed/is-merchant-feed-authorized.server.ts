import "server-only"

import { timingSafeEqual } from "node:crypto"

import { env } from "@/lib/env"

export function isMerchantFeedAuthorized(request: Request, destination: "google" | "meta"): boolean {
  const password = destination === "meta" ? env.META_CATALOG_FEED_PASSWORD : env.GOOGLE_MERCHANT_FEED_PASSWORD
  if (!password) return false
  const authorization = request.headers.get("authorization") ?? ""
  if (authorization.length > 2048) return false
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization)
  if (!match) return false
  const received = Buffer.from(match[1]!, "base64")
  const username = destination === "meta" ? "meta-catalog" : "google-merchant"
  const expected = Buffer.from(`${username}:${password}`, "utf8")
  return received.length === expected.length && timingSafeEqual(received, expected)
}
