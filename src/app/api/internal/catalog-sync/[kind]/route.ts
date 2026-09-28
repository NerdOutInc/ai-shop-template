import { timingSafeEqual } from "node:crypto"

import { refreshCatalog } from "@/features/catalog-sync/refresh-catalog.server"
import { env } from "@/lib/env"

export const runtime = "nodejs"
export const maxDuration = 60

async function run(request: Request, context: { params: Promise<{ kind: string }> }, force: boolean) {
  const headers = { "Cache-Control": "no-store" }
  if (!env.CRON_SECRET) return Response.json({ error: "Catalog worker is not configured" }, { status: 503, headers })
  const received = Buffer.from(request.headers.get("authorization") ?? "", "utf8")
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`, "utf8")
  if (received.length !== expected.length || !timingSafeEqual(received, expected))
    return Response.json({ error: "Unauthorized" }, { status: 401, headers })
  const { kind } = await context.params
  if (kind !== "stock" && kind !== "popularity")
    return Response.json({ error: "Unknown refresh" }, { status: 404, headers })
  if (!env.PRINTIFY_PUBLISHING_ENABLED) return Response.json({ processed: false, reason: "disabled" }, { headers })
  try {
    const result = await refreshCatalog(kind, { force })
    return Response.json({ processed: result === "updated", result }, { headers })
  } catch {
    console.error("Catalog background refresh failed", { kind })
    return Response.json({ error: "Catalog refresh needs retry" }, { status: 500, headers })
  }
}

export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) {
  return run(request, context, false)
}
export async function POST(request: Request, context: { params: Promise<{ kind: string }> }) {
  return run(request, context, true)
}
