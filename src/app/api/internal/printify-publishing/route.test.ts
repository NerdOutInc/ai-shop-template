// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { getPublishingServices } from "@/features/publishing/get-publishing-services.server"

import { GET, POST } from "./route"

const config = vi.hoisted(() => ({
  PRINTIFY_PUBLISHING_ENABLED: true,
  CRON_SECRET: "fixture-cron-secret" as string | undefined,
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env: config }))
vi.mock("@/features/publishing/get-publishing-services.server", () => ({ getPublishingServices: vi.fn() }))
const processPending = vi.fn<(limit?: number) => Promise<void>>()

function request(authorization: string | null = "Bearer fixture-cron-secret") {
  return new Request("https://shop.example.com/api/internal/printify-publishing", {
    headers: authorization === null ? {} : { authorization },
  })
}

beforeEach(() => {
  config.PRINTIFY_PUBLISHING_ENABLED = true
  config.CRON_SECRET = "fixture-cron-secret"
  processPending.mockResolvedValue(undefined)
  vi.mocked(getPublishingServices).mockReturnValue({ processPending } as never)
})

describe("Printify publishing worker trigger", () => {
  it.each([GET, POST])("processes a bounded batch for an authenticated trigger", async (handler) => {
    const response = await handler(request())
    expect(response.status).toBe(200)
    expect(processPending).toHaveBeenCalledWith(5)
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it.each([null, "", "Bearer wrong-secret", "Bearer fixture-cron-secrex", "Basic fixture-cron-secret"])(
    "rejects missing or invalid bearer credentials before accessing services",
    async (authorization) => {
      expect((await GET(request(authorization))).status).toBe(401)
      expect(getPublishingServices).not.toHaveBeenCalled()
    }
  )

  it.each([GET, POST])("skips an authenticated trigger while publishing is disabled", async (handler) => {
    config.PRINTIFY_PUBLISHING_ENABLED = false
    const response = await handler(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ processed: false, reason: "disabled" })
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(getPublishingServices).not.toHaveBeenCalled()
    expect(processPending).not.toHaveBeenCalled()
  })

  it.each([null, "Bearer wrong-secret"])("authenticates before revealing disabled status", async (authorization) => {
    config.PRINTIFY_PUBLISHING_ENABLED = false
    for (const handler of [GET, POST]) {
      const response = await handler(request(authorization))
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: "Unauthorized" })
    }
    expect(getPublishingServices).not.toHaveBeenCalled()
  })

  it.each([true, false])("fails closed when the cron secret is missing with publishing %s", async (enabled) => {
    config.PRINTIFY_PUBLISHING_ENABLED = enabled
    config.CRON_SECRET = undefined
    expect((await GET(request())).status).toBe(503)
    expect(getPublishingServices).not.toHaveBeenCalled()
  })

  it("reports failure without exposing sensitive worker details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    processPending.mockRejectedValueOnce(new Error("sensitive-provider-response"))
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain("sensitive-provider-response")
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("sensitive-provider-response")
  })
})
