// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { readPublishingHealth } from "@/features/publishing/read-publishing-health.server"

import { GET } from "./route"

const config = vi.hoisted(() => ({ PRINTIFY_MONITOR_SECRET: "fixture-monitor-secret" as string | undefined }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env: config }))
vi.mock("@/features/publishing/read-publishing-health.server", () => ({ readPublishingHealth: vi.fn() }))

const healthy = {
  status: "healthy" as const,
  checkedAt: "2026-09-09T12:00:00.000Z",
  issues: [],
  counts: { activeProducts: 24, attentionJobs: 0, overdueJobs: 0, checkedProducts: 24 },
}

function request(authorization: string | null = "Bearer fixture-monitor-secret") {
  return new Request("https://shop.example.com/api/internal/printify-publishing/health", {
    headers: authorization === null ? {} : { authorization },
  })
}
beforeEach(() => {
  config.PRINTIFY_MONITOR_SECRET = "fixture-monitor-secret"
  vi.mocked(readPublishingHealth).mockResolvedValue(healthy)
})

describe("publishing monitor authentication", () => {
  it("returns the complete authenticated health result without caching", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual(healthy)
    expect(readPublishingHealth).toHaveBeenCalledExactlyOnceWith()
  })

  it.each([
    null,
    "",
    "Bearer wrong",
    "Bearer fixture-monitor-secrex",
    "Bearer fixture-cron-secret",
    "Basic fixture-monitor-secret",
  ])("rejects %s before any database or provider check", async (authorization) => {
    const response = await GET(request(authorization))
    expect(response.status).toBe(401)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toMatchObject({ status: "unhealthy", issues: ["UNAUTHORIZED"] })
    expect(readPublishingHealth).not.toHaveBeenCalled()
  })

  it("fails closed when the dedicated secret is absent", async () => {
    config.PRINTIFY_MONITOR_SECRET = undefined
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toMatchObject({ issues: ["MONITOR_NOT_CONFIGURED"] })
    expect(readPublishingHealth).not.toHaveBeenCalled()
  })

  it("uses an uncached failure status for an unhealthy report", async () => {
    vi.mocked(readPublishingHealth).mockResolvedValue({
      ...healthy,
      status: "unhealthy",
      issues: ["PUBLISHING_DISABLED"],
    })
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toMatchObject({ issues: ["PUBLISHING_DISABLED"] })
  })

  it("redacts unexpected errors and never returns a partial success", async () => {
    vi.mocked(readPublishingHealth).mockRejectedValue(new Error("private database/password/provider response"))
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("no-store")
    const body = await response.text()
    expect(body).not.toContain("private")
    expect(JSON.parse(body)).toMatchObject({ status: "unhealthy", issues: ["CHECK_INCOMPLETE"] })
  })
})
