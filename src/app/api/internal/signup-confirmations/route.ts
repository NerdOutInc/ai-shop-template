import { timingSafeEqual } from "node:crypto"
import { getDropEmailPool } from "@/features/drop-emails/get-drop-email-pool.server"
import { pruneSignupConfirmationBudget } from "@/features/drop-signup/prune-signup-confirmation-budget.server"
import { prunePendingSubscribers } from "@/features/subscribers/prune-pending-subscribers.server"
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
  if (env.VERCEL_ENV !== "production") return Response.json({ processed: false, reason: "disabled" }, { headers })
  if (!env.DATABASE_URL) return Response.json({ error: "Not configured" }, { status: 503, headers })
  let pruned = 0
  let cleanupFailed = false
  try {
    pruned = await prunePendingSubscribers(getDropEmailPool())
  } catch {
    cleanupFailed = true
    console.error("Pending signup cleanup needs attention")
  }
  try {
    await pruneSignupConfirmationBudget(getDropEmailPool())
  } catch {
    cleanupFailed = true
    console.error("Signup admission cleanup needs attention")
  }
  const cleanup = { pruned, ...(cleanupFailed ? { cleanupError: "Signup housekeeping needs attention" } : {}) }
  try {
    if (env.SIGNUP_CONFIRMATIONS_ENABLED !== "true")
      return Response.json(
        { processed: false, reason: "disabled", ...cleanup },
        { status: cleanupFailed ? 503 : 200, headers }
      )
    const result = await runSignupConfirmations()
    if (result.saturationNeedsAttention) console.error("Signup admission has remained saturated for three hours")
    return Response.json(
      { ...result, ...cleanup },
      { status: result.errors || cleanupFailed || result.saturationNeedsAttention ? 503 : 200, headers }
    )
  } catch {
    console.error("Signup confirmations need attention")
    return Response.json({ error: "Signup confirmations need attention" }, { status: 503, headers })
  }
}
