import { beforeEach, describe, expect, it, vi } from "vitest"
import { getAdminActor } from "./get-admin-actor.server"

const fixture = vi.hoisted(() => ({
  enabled: true,
  configured: true,
  getUser: vi.fn(),
  query: vi.fn(),
  database: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({
  env: {
    get ADMIN_LIBRARY_ENABLED() {
      return fixture.enabled
    },
  },
}))
vi.mock("./get-admin-auth-config.server", () => ({ getAdminAuthConfig: () => (fixture.configured ? {} : null) }))
vi.mock("./create-admin-server-client.server", () => ({
  createAdminServerClient: () => ({ auth: { getUser: fixture.getUser } }),
}))
vi.mock("./get-admin-database.server", () => ({
  getAdminDatabase: () => {
    fixture.database()
    return { query: fixture.query }
  },
}))

beforeEach(() => {
  fixture.enabled = true
  fixture.configured = true
  fixture.getUser.mockResolvedValue({
    data: {
      user: {
        id: "owner",
        email: "owner@example.test",
        email_confirmed_at: "2026-09-14T00:00:00Z",
        is_anonymous: false,
        user_metadata: { admin: true },
      },
    },
    error: null,
  })
  fixture.query.mockResolvedValue({ rows: [{ active: true }] })
})

describe("cookie-authenticated current admin identity", () => {
  it("does not require or contact auth when the feature is disabled", async () => {
    fixture.enabled = false
    expect(await getAdminActor()).toBeNull()
    expect(fixture.getUser).not.toHaveBeenCalled()
    expect(fixture.database).not.toHaveBeenCalled()
  })

  it("fails closed when auth configuration is missing", async () => {
    fixture.configured = false
    expect(await getAdminActor()).toBeNull()
    expect(fixture.getUser).not.toHaveBeenCalled()
  })

  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: "owner" } }, error: new Error("expired") },
    { data: { user: { id: "owner", is_anonymous: true } }, error: null },
    { data: { user: { id: "owner", email: "owner@example.test", email_confirmed_at: null } }, error: null },
  ])("rejects absent, invalid and anonymous identities before touching membership", async (response) => {
    fixture.getUser.mockResolvedValue(response)
    expect(await getAdminActor()).toBeNull()
    expect(fixture.query).not.toHaveBeenCalled()
  })

  it("ignores user-editable admin metadata and requires an active membership", async () => {
    fixture.query.mockResolvedValue({ rows: [] })
    expect(await getAdminActor()).toBeNull()
    expect(fixture.query).toHaveBeenCalledWith(expect.any(String), ["owner"])
  })

  it("sees revocation on the very next request without caching the actor", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    expect(await getAdminActor()).toEqual({ userId: "owner" })
    fixture.query.mockResolvedValue({ rows: [] })
    expect(await getAdminActor()).toBeNull()
    expect(fixture.getUser).toHaveBeenCalledTimes(2)
    expect(fixture.query).toHaveBeenCalledTimes(2)
    expect(log).not.toHaveBeenCalled()
  })

  it("denies access when the identity service or membership database is unavailable", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    fixture.getUser.mockRejectedValueOnce(new Error("offline"))
    expect(await getAdminActor()).toBeNull()
    fixture.query.mockRejectedValueOnce(
      Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), { code: "ECONNREFUSED" })
    )
    expect(await getAdminActor()).toBeNull()
    expect(log.mock.calls).toEqual([
      ["Admin library unavailable", { code: "ADMIN_ACTOR_LOOKUP_FAILED", cause: "other" }],
      ["Admin library unavailable", { code: "ADMIN_ACTOR_LOOKUP_FAILED", cause: "connection-failure" }],
    ])
  })

  it("logs a permission-denied membership read by reason code and cause, never the query", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    fixture.query.mockRejectedValueOnce(
      Object.assign(new Error("permission denied for table admin_memberships"), {
        code: "42501",
        internalQuery: "select m.active from public.admin_memberships m",
      })
    )
    expect(await getAdminActor()).toBeNull()
    expect(log.mock.calls).toEqual([
      ["Admin library unavailable", { code: "ADMIN_ACTOR_LOOKUP_FAILED", cause: "permission-denied" }],
    ])
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/permission denied|admin_memberships|select/)
  })
})
