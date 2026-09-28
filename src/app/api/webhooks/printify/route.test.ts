// @vitest-environment node
import { createHmac } from "node:crypto"

import { after } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { getPublishingServices } from "@/features/publishing/get-publishing-services.server"

import { POST } from "./route"

const config = vi.hoisted(() => ({
  PRINTIFY_PUBLISHING_ENABLED: true,
  PRINTIFY_WEBHOOK_SECRET: "fixture-webhook-secret" as string | undefined,
  PRINTIFY_SHOP_ID: "12345" as string | undefined,
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env: config }))
vi.mock("next/server", () => ({ after: vi.fn() }))
vi.mock("@/features/publishing/get-publishing-services.server", () => ({ getPublishingServices: vi.fn() }))

const enqueue = vi.fn<(event: unknown) => Promise<void>>()
const processPending = vi.fn<(limit?: number) => Promise<void>>()
const event = {
  id: "653b6be8-2ff7-4ab5-a7a6-6889a8b3bbf5",
  type: "product:publish:started",
  created_at: "2026-09-09T16:00:00Z",
  resource: {
    id: "111111000000000000000001",
    type: "product",
    data: { shop_id: 12345, action: "update", publish_details: { title: true } },
  },
}

function request(body = JSON.stringify(event), validSignature = true) {
  return new Request("https://shop.example.com/api/webhooks/printify", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-pfy-signature": `sha256=${createHmac("sha256", "fixture-webhook-secret")
        .update(validSignature ? body : "modified")
        .digest("hex")}`,
    },
  })
}

beforeEach(() => {
  config.PRINTIFY_PUBLISHING_ENABLED = true
  config.PRINTIFY_WEBHOOK_SECRET = "fixture-webhook-secret"
  config.PRINTIFY_SHOP_ID = "12345"
  enqueue.mockResolvedValue(undefined)
  processPending.mockResolvedValue(undefined)
  vi.mocked(getPublishingServices).mockReturnValue({ store: { enqueue }, processPending } as never)
})

describe("Printify publishing webhook", () => {
  it("persists authenticated publication before acknowledging and scheduling prompt processing", async () => {
    let finishEnqueue: () => void = () => undefined
    enqueue.mockImplementationOnce(() => new Promise<void>((resolve) => (finishEnqueue = resolve)))
    const response = POST(request())
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledOnce())
    expect(after).not.toHaveBeenCalled()
    finishEnqueue()
    expect((await response).status).toBe(200)
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ id: event.id, action: "update" }))
    const scheduled = vi.mocked(after).mock.calls[0]?.[0]
    expect(typeof scheduled).toBe("function")
    if (typeof scheduled === "function") await scheduled()
    expect(processPending).toHaveBeenCalledWith(1)
  })

  it("rejects modified payloads without opening publishing services", async () => {
    expect((await POST(request(undefined, false))).status).toBe(400)
    expect(getPublishingServices).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it("rejects a signed event for another shop without persisting it", async () => {
    const body = JSON.stringify({
      ...event,
      resource: { ...event.resource, data: { ...event.resource.data, shop_id: 1 } },
    })
    expect((await POST(request(body))).status).toBe(400)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it("queues signed delete events without requiring shop_id in the payload", async () => {
    const body = JSON.stringify({ ...event, resource: { ...event.resource, data: { action: "delete" } } })
    expect((await POST(request(body))).status).toBe(200)
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ action: "delete", shopId: "12345" }))
  })

  it("returns failure when durable persistence fails without leaking provider details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    enqueue.mockRejectedValueOnce(new Error("sensitive-database-connection"))
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(after).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain("sensitive-database-connection")
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("sensitive-database-connection")
  })

  it("keeps a durable event acknowledged when prompt scheduling is unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.mocked(after).mockImplementationOnce(() => {
      throw new Error("No request context")
    })
    expect((await POST(request())).status).toBe(200)
    expect(enqueue).toHaveBeenCalledOnce()
  })

  it("rejects an oversized body even without content-length", async () => {
    expect((await POST(request(" ".repeat(65_537)))).status).toBe(400)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it("does not accept requests while publishing is disabled", async () => {
    config.PRINTIFY_PUBLISHING_ENABLED = false
    expect((await POST(request())).status).toBe(503)
    expect(getPublishingServices).not.toHaveBeenCalled()
  })

  it("rejects requests when the webhook secret is not configured", async () => {
    config.PRINTIFY_WEBHOOK_SECRET = undefined
    expect((await POST(request())).status).toBe(503)
    expect(getPublishingServices).not.toHaveBeenCalled()
  })
})
