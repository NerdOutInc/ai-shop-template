import { NextResponse, type NextRequest } from "next/server"

import { resolveMetaCart } from "@/features/cart/resolve-meta-cart.server"
import { checkoutRecoveryCookie } from "@/features/checkout/checkout-recovery-cookie.server"
import { readCheckoutBody } from "@/features/checkout/read-checkout-body.server"

export const runtime = "nodejs"

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }

export async function POST(request: NextRequest) {
  try {
    // Next may normalize its internal URL to localhost. Host is the actual browser target;
    // browsers cannot override it, unlike application-supplied forwarded-host headers.
    const host = request.headers.get("host")
    const target = host ? new URL(`${request.nextUrl.protocol}//${host}`) : request.nextUrl
    const validTarget =
      !host ||
      (target.host === host &&
        !target.username &&
        !target.password &&
        target.pathname === "/" &&
        !target.search &&
        !target.hash)
    if (
      !validTarget ||
      request.headers.get("origin") !== target.origin ||
      request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
    )
      return NextResponse.json({ error: "This checkout recovery request is invalid." }, { status: 403, headers })
    const text = await readCheckoutBody(request, 256)
    if (text.length > 256)
      return NextResponse.json({ error: "This checkout recovery request is invalid." }, { status: 400, headers })
    const body: unknown = JSON.parse(text)
    if (
      !body ||
      typeof body !== "object" ||
      !("selector" in body) ||
      !("kind" in body) ||
      typeof body.selector !== "string" ||
      !/^[a-f0-9]{32}$/.test(body.selector) ||
      !["success", "meta"].includes(String(body.kind))
    )
      return NextResponse.json({ error: "This checkout recovery request is invalid." }, { status: 400, headers })
    const cookie = request.cookies.get(`${checkoutRecoveryCookie.prefix}${body.selector}`)
    const data = cookie ? checkoutRecoveryCookie.decode(cookie.value) : null
    if (!data || data.kind !== body.kind)
      return NextResponse.json(
        { error: "This checkout link is no longer available in this browser." },
        { status: 404, headers }
      )
    if ("verify" in body && body.verify === true) return new NextResponse(null, { status: 204, headers })
    return NextResponse.json(
      data.kind === "success"
        ? { kind: "success", sessionId: data.sessionId }
        : { kind: "meta", result: await resolveMetaCart(data.params) },
      { headers }
    )
  } catch {
    return NextResponse.json({ error: "We couldn’t recover this checkout just now." }, { status: 400, headers })
  }
}
