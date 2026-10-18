import "server-only"
import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { getAdminAuthConfig } from "./get-admin-auth-config.server"
import { isAdminLocalDevelopment } from "./is-admin-local-development"

// Only the gallery photo GET may revalidate a private ETag: that route rechecks admin membership and product
// ownership before every 304 and sets its own private, no-cache headers. Every other admin response stays
// no-store, and so does any response that refreshes session cookies.
const revalidatedPhoto = /^\/api\/admin\/products\/[a-zA-Z0-9_-]{1,128}\/gallery\/assets\/[a-fA-F0-9-]{36}$/

export async function refreshAdminResponse(request: NextRequest) {
  let response = NextResponse.next({ request })
  if (request.method !== "GET" || !revalidatedPhoto.test(request.nextUrl.pathname))
    response.headers.set("Cache-Control", "private, no-store")
  response.headers.set("X-Robots-Tag", "noindex, nofollow")
  const auth = getAdminAuthConfig()
  if (!auth) return response
  const client = createServerClient(auth.url, auth.key, {
    cookieOptions: { secure: !isAdminLocalDevelopment() },
    auth: { experimental: { passkey: true } },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options)
        for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
        response.headers.set("Cache-Control", "private, no-store")
        response.headers.set("X-Robots-Tag", "noindex, nofollow")
      },
    },
  })
  // The route performs authorization; this only refreshes the cookie session for SSR.
  await client.auth.getClaims()
  return response
}
