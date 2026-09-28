import "server-only"

import { NextResponse, type NextRequest } from "next/server"

import { createCheckoutIngress } from "./create-checkout-ingress.server"

export function protectCheckoutRequest(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const fallback = searchParams.get("recovery_unavailable") === "1"
  if (!fallback && ["session_id", "products", "coupon"].some((key) => searchParams.has(key)))
    return createCheckoutIngress(request)
  const response = NextResponse.next()
  response.headers.set("Referrer-Policy", "no-referrer")
  response.headers.set("Cache-Control", "no-store")
  if (fallback)
    response.headers.set(
      "Content-Security-Policy",
      "script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'"
    )
  return response
}
