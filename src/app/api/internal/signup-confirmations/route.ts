import { timingSafeEqual } from "node:crypto"
import { runSignupConfirmations } from "@/features/drop-signup/run-signup-confirmations.server"
import { env } from "@/lib/env"

export const runtime = "nodejs"
export const maxDuration = 120

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" }
  if (!env.CRON_SECRET) return Response.json({ error: "Not configured" }, { status: 503, headers })
  const received = Buffer.from(request.headers.get("authorization") ?? "", "utf8")
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`, "utf8")
  if (received.length !== expected.length || !timingSafeEqual(received, expected))
    return Response.json({ error: "Unauthorized" }, { status: 401, headers })
  if (env.SIGNUP_CONFIRMATIONS_ENABLED !== "true" || env.VERCEL_ENV !== "production")
    return Response.json({ processed: false, reason: "disabled" }, { headers })
  try {
    const result = await runSignupConfirmations()
    return Response.json(result, { status: result.errors ? 503 : 200, headers })
  } catch {
    console.error("Signup confirmations need attention")
    return Response.json({ error: "Signup confirmations need attention" }, { status: 503, headers })
  }
}
