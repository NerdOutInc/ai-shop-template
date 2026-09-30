// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "./route"

const { unsubscribe } = vi.hoisted(() => ({ unsubscribe: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/features/drop-signup/get-drop-signup-store.server", () => ({
  getDropSignupStore: () => ({ unsubscribe }),
}))

const token = "5f0b2c4e-8a51-4d8e-9a57-2c1f7f3b9d10"
const post = (value = token, headers: Record<string, string> = {}) =>
  POST(new Request(`https://store.example/api/drop-unsubscribe/${value}`, { method: "POST", headers }), {
    params: Promise.resolve({ token: value }),
  })

beforeEach(() => {
  unsubscribe.mockReset().mockResolvedValue(undefined)
})

describe("drop unsubscribe route", () => {
  // Gmail and Yahoo POST from their own servers: no Origin, no cookies, a form body they choose.
  it("honors a mail app's one-click unsubscribe with no Origin at all", async () => {
    const response = await POST(
      new Request(`https://store.example/api/drop-unsubscribe/${token}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
      { params: Promise.resolve({ token }) }
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ unsubscribed: true })
    expect(unsubscribe).toHaveBeenCalledWith(token)
    expect(response.headers.get("cache-control")).toContain("no-store")
  })

  it("sends a browser without JavaScript back to the page, finished", async () => {
    const response = await post(token, { "sec-fetch-mode": "navigate" })
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(`/unsubscribe/${token}`)
  })

  it.each(["not-a-token", "customer@example.com", `${token}x`])(
    "turns away %s without touching the list",
    async (value) => {
      expect((await post(value)).status).toBe(404)
      expect(unsubscribe).not.toHaveBeenCalled()
    }
  )

  it("admits a failure rather than claiming success", async () => {
    unsubscribe.mockRejectedValue(new Error("database down"))
    const response = await post()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "That didn't go through. Try again in a moment." })
  })
})
