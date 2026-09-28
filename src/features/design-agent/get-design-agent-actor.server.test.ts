// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getDesignAgentActor } from "./get-design-agent-actor.server"
const fixture = vi.hoisted(() => ({ enabled: true, query: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({
  env: {
    get ADMIN_LIBRARY_ENABLED() {
      return fixture.enabled
    },
  },
}))
vi.mock("@/features/admin/get-admin-database.server", () => ({ getAdminDatabase: () => ({ query: fixture.query }) }))
const token = `store_agent_73dbaad4-4c76-41e8-b3a0-67b4a323ce88_${"a".repeat(43)}`
const request = (authorization = `Bearer ${token}`) =>
  new Request("https://store.example/api/admin/agent", { headers: { authorization } })
beforeEach(() => {
  fixture.enabled = true
  fixture.query.mockReset()
  fixture.query.mockResolvedValue({ rows: [] })
})
describe("agent identity lookup", () => {
  it("returns null for absent, malformed, unknown or disabled credentials", async () => {
    expect(await getDesignAgentActor(request(""), "library:read")).toBeNull()
    expect(await getDesignAgentActor(request("Bearer invalid"), "library:read")).toBeNull()
    fixture.enabled = false
    expect(await getDesignAgentActor(request(), "library:read")).toBeNull()
    expect(fixture.query).not.toHaveBeenCalled()
    fixture.enabled = true
    expect(await getDesignAgentActor(request(), "library:read")).toBeNull()
    expect(fixture.query).toHaveBeenCalledOnce()
  })
  it("propagates database outages so the HTTP boundary reports service failure rather than rejected credentials", async () => {
    const failure = new Error("database unavailable")
    fixture.query.mockRejectedValue(failure)
    await expect(getDesignAgentActor(request(), "library:read")).rejects.toBe(failure)
  })
})
