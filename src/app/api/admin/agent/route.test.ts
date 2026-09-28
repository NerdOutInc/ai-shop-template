// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from "vitest"
import { POST, maxDuration } from "./route"
import { DesignDraftError } from "@/features/design-products/design-draft-error"
import { designDraftInput } from "../../../../../test/design-draft-input"
const { env, actor, execute } = vi.hoisted(() => ({
  env: { ADMIN_LIBRARY_ENABLED: true },
  actor: vi.fn(),
  execute: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env }))
vi.mock("@/features/admin/get-admin-database.server", () => ({ getAdminDatabase: () => ({}) }))
vi.mock("@/features/design-agent/get-design-agent-actor.server", () => ({ getDesignAgentActor: actor }))
vi.mock("@/features/design-agent/execute-design-agent-command.server", () => ({ executeDesignAgentCommand: execute }))
const request = (body: unknown, authorization = "Bearer token") =>
  new Request("https://store.example/api/admin/agent", {
    method: "POST",
    headers: { "content-type": "application/json", authorization },
    body: JSON.stringify(body),
  })
beforeEach(() => {
  vi.clearAllMocks()
  env.ADMIN_LIBRARY_ENABLED = true
  actor.mockResolvedValue({ userId: "actor", grantId: "grant" })
  execute.mockResolvedValue({ saved: true })
})
describe("scoped agent command HTTP boundary", () => {
  it("does not accept a browser cookie or absent bearer token", async () => {
    const response = await POST(
      new Request("https://store.example/api/admin/agent", {
        method: "POST",
        headers: { cookie: "session=valid", "content-type": "application/json" },
        body: "{}",
      })
    )
    expect(response.status).toBe(401)
    expect(execute).not.toHaveBeenCalled()
  })
  it("chooses the required command scope, retains private headers, and denies revoked tokens", async () => {
    const read = await POST(request({ command: "library.favorites" }))
    expect(read.status).toBe(200)
    expect(actor).toHaveBeenLastCalledWith(expect.any(Request), "library:read")
    expect(read.headers.get("cache-control")).toContain("private, no-store")
    expect(read.headers.get("cdn-cache-control")).toBe("no-store")
    expect(read.headers.get("vary")).toBe("Cookie, Authorization")
    await POST(
      request({
        command: "batch.create",
        requestId: "c0159a1a-fc4b-4102-9d33-065c71bcf41b",
        title: "Ten",
        brief: "Sloths",
        count: 10,
      })
    )
    expect(actor).toHaveBeenLastCalledWith(expect.any(Request), "library:write")
    actor.mockResolvedValue(null)
    expect((await POST(request({ command: "library.favorites" }))).status).toBe(401)
  })
  it("rejects overlarge bodies, unsupported publishing commands and malformed JSON", async () => {
    expect((await POST(request({ command: "publish" }))).status).toBe(400)
    expect((await POST(request({ data: "x".repeat(512 * 1024) }))).status).toBe(413)
    expect(
      (
        await POST(
          new Request("https://store.example/api/admin/agent", {
            method: "POST",
            headers: { authorization: "Bearer token", "content-type": "application/json" },
            body: "{",
          })
        )
      ).status
    ).toBe(400)
    expect(execute).not.toHaveBeenCalled()
  })
  it("does not reflect provider failures or token-bearing errors to the caller", async () => {
    execute.mockRejectedValue(new Error("provider credentials secret-value"))
    const response = await POST(request({ command: "library.favorites" }))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain("secret-value")
  })
  it.each([
    { command: "drafts.create", input: designDraftInput },
    { command: "drafts.propose", numbers: [149, 211] },
    { command: "drafts.reconcile", requestId: designDraftInput.requestId },
    { command: "drafts.reconcileBinding", bindingId: designDraftInput.requestId },
  ])("requires draft authority for $command and carries the request cancellation signal", async (command) => {
    const incoming = request(command)
    expect((await POST(incoming)).status).toBe(200)
    expect(actor).toHaveBeenLastCalledWith(incoming, "drafts:create")
    expect(execute).toHaveBeenLastCalledWith({}, { userId: "actor", grantId: "grant" }, command, {
      signal: incoming.signal,
    })
    expect(maxDuration).toBeGreaterThan(50)
  })
  it("rejects incomplete draft input before provider work and classifies durable conflicts", async () => {
    const invalid = await POST(request({ command: "drafts.create", input: { requestId: designDraftInput.requestId } }))
    expect(invalid.status).toBe(400)
    expect(execute).not.toHaveBeenCalled()
    execute.mockRejectedValueOnce(
      new DesignDraftError("CONFLICT", "An existing product reserves this design and model")
    )
    expect((await POST(request({ command: "drafts.create", input: designDraftInput }))).status).toBe(409)
    execute.mockRejectedValueOnce(new DesignDraftError("PROVIDER_UNAVAILABLE", "Reconcile the saved request"))
    expect((await POST(request({ command: "drafts.reconcile", requestId: designDraftInput.requestId }))).status).toBe(
      503
    )
  })
  it("rejects an unknown command before invoking the executor", async () => {
    const response = await POST(request({ command: "unsupported.command" }))
    expect(response.status).toBe(400)
    expect(execute).not.toHaveBeenCalled()
  })
})
