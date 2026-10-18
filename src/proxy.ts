import type { NextRequest } from "next/server"
import { refreshAdminResponse } from "@/features/admin/refresh-admin-response.server"
import { protectCheckoutRequest } from "@/features/checkout/protect-checkout-request.server"

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/checkout/")) return protectCheckoutRequest(request)
  return refreshAdminResponse(request)
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*", "/checkout/success", "/checkout/meta"] }
