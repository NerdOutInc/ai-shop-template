import { after } from "next/server"

import { getPublishingServices } from "@/features/publishing/get-publishing-services.server"
import { readPublishingEvent } from "@/features/publishing/read-publishing-event.server"
import { env } from "@/lib/env"

export const runtime = "nodejs"
export const maxDuration = 60

async function readBody(request: Request) {
  const maxBytes = 65_536
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json" ||
    !request.body ||
    Number(request.headers.get("content-length")) > maxBytes
  ) {
    throw new Error("Invalid webhook body")
  }
  const reader = request.body.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
  let body = ""
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > maxBytes) throw new Error("Webhook body is too large")
      body += decoder.decode(part.value, { stream: true })
    }
    return body + decoder.decode()
  } catch {
    await reader.cancel().catch(() => undefined)
    throw new Error("Invalid webhook body")
  } finally {
    reader.releaseLock()
  }
}

export async function POST(request: Request) {
  if (!env.PRINTIFY_PUBLISHING_ENABLED) {
    return Response.json({ error: "Publishing is disabled" }, { status: 503 })
  }
  if (!env.PRINTIFY_WEBHOOK_SECRET || !env.PRINTIFY_SHOP_ID) {
    return Response.json({ error: "Publishing webhook is not configured" }, { status: 503 })
  }
  let event: ReturnType<typeof readPublishingEvent>
  try {
    event = readPublishingEvent(await readBody(request), request.headers.get("x-pfy-signature"), {
      secret: env.PRINTIFY_WEBHOOK_SECRET,
      shopId: env.PRINTIFY_SHOP_ID,
    })
  } catch {
    return Response.json({ error: "Invalid signature or payload" }, { status: 400 })
  }

  let services: ReturnType<typeof getPublishingServices>
  try {
    services = getPublishingServices()
    await services.store.enqueue(event)
  } catch {
    console.error("Printify publishing event could not be persisted", { eventId: event.id })
    return Response.json({ error: "Publication not queued; retry required" }, { status: 500 })
  }
  // The event is durable before acknowledgment. Cron resumes queued work if
  // this optional prompt run is interrupted or unavailable after the response.
  try {
    after(async () => {
      try {
        await services.processPending(1)
      } catch {
        console.error("Printify publishing worker needs retry", { eventId: event.id })
      }
    })
  } catch {
    console.error("Printify publishing prompt run was not scheduled", { eventId: event.id })
  }
  return Response.json({ received: true }, { headers: { "Cache-Control": "no-store" } })
}
