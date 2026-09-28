import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { getAdminAuthConfig } from "@/features/admin/get-admin-auth-config.server"
import { protectCheckoutRequest } from "@/features/checkout/protect-checkout-request.server"
import { isAdminLocalDevelopment } from "@/features/admin/is-admin-local-development"

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/checkout/")) return protectCheckoutRequest(request)
  let response = NextResponse.next({ request })
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

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*", "/checkout/success", "/checkout/meta"] }
