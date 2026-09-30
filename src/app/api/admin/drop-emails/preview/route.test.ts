// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { GET } from "./route"

const mocks = vi.hoisted(() => ({ actor: vi.fn(), next: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor: mocks.actor }))
vi.mock("@/features/drop-emails/render-next-drop-email.server", () => ({ renderNextDropEmail: mocks.next }))

beforeEach(() => {
  mocks.actor.mockReset().mockResolvedValue({ userId: "owner" })
  mocks.next.mockReset().mockResolvedValue({
    status: "ready",
    html: '<p>This week’s picks.</p><a href="https://store.example/unsubscribe/drop-email-subscriber-placeholder">Unsubscribe</a>',
  })
})

describe("drop email preview", () => {
  it("serves the email as a sandboxed document only this site can frame", async () => {
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
    expect(response.headers.get("content-security-policy")).toContain("sandbox")
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'self'")
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(await response.text()).toContain("https://store.example/unsubscribe/00000000-0000-4000-8000-000000000000")
  })

  it("shows nothing to anyone but an administrator", async () => {
    mocks.actor.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
    expect(mocks.next).not.toHaveBeenCalled()
  })

  it("answers plainly when there is nothing to preview or the read fails", async () => {
    mocks.next.mockResolvedValue({ status: "none" })
    expect((await GET()).status).toBe(404)
    mocks.next.mockRejectedValue(new Error("database down"))
    expect((await GET()).status).toBe(503)
  })
})
