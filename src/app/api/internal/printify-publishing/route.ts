import { timingSafeEqual } from "node:crypto"

import { getPublishingServices } from "@/features/publishing/get-publishing-services.server"
import { env } from "@/lib/env"

export const runtime = "nodejs"
export const maxDuration = 60

async function runPublishing(request: Request) {
  if (!env.CRON_SECRET) {
    return Response.json({ error: "Publishing worker is not configured" }, { status: 503 })
  }
  const received = Buffer.from(request.headers.get("authorization") ?? "", "utf8")
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`, "utf8")
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!env.PRINTIFY_PUBLISHING_ENABLED) {
    return Response.json({ processed: false, reason: "disabled" }, { headers: { "Cache-Control": "no-store" } })
  }
  try {
    await getPublishingServices().processPending(5)
    return Response.json({ processed: true }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    console.error("Printify publishing worker needs retry")
    return Response.json({ error: "Publication processing needs retry" }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return runPublishing(request)
}

export async function POST(request: Request) {
  return runPublishing(request)
}
