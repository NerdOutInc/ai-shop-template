import { timingSafeEqual } from "node:crypto"

import type { PublishingHealth } from "@/features/publishing/publishing-health"
import { readPublishingHealth } from "@/features/publishing/read-publishing-health.server"
import { env } from "@/lib/env"

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(request: Request) {
  const unavailable = (issue: string, status = 503) =>
    Response.json(
      {
        status: "unhealthy",
        checkedAt: new Date().toISOString(),
        issues: [issue],
        counts: { activeProducts: 0, attentionJobs: 0, overdueJobs: 0, checkedProducts: 0 },
      } satisfies PublishingHealth,
      { status, headers: { "Cache-Control": "no-store" } }
    )
  if (!env.PRINTIFY_MONITOR_SECRET) return unavailable("MONITOR_NOT_CONFIGURED")
  const received = Buffer.from(request.headers.get("authorization") ?? "", "utf8")
  const expected = Buffer.from(`Bearer ${env.PRINTIFY_MONITOR_SECRET}`, "utf8")
  if (received.length !== expected.length || !timingSafeEqual(received, expected))
    return unavailable("UNAUTHORIZED", 401)
  try {
    const health = await readPublishingHealth()
    return Response.json(health, {
      status: health.status === "healthy" ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    })
  } catch {
    return unavailable("CHECK_INCOMPLETE")
  }
}
