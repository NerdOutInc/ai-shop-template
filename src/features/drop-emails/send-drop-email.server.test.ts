import { afterEach, describe, expect, it, vi } from "vitest"

import type { DropEmailMessage } from "./drop-email-message"
import { sendDropEmail } from "./send-drop-email.server"

vi.mock("server-only", () => ({}))
afterEach(() => vi.unstubAllGlobals())

const message: DropEmailMessage = {
  from: "Fixture Store <drops@fixture.example>",
  to: ["customer@example.com"],
  reply_to: "support@fixture.example",
  subject: "New this week: Abstract Lines",
  html: "<p>This week’s picks.</p>",
  text: "This week’s picks.",
  headers: {
    "List-Unsubscribe": "<https://store.example/api/drop-unsubscribe/5f0b2c4e-8a51-4d8e-9a57-2c1f7f3b9d10>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  },
}

describe("sendDropEmail", () => {
  it("hands Resend exactly this message under the caller's key", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: "re_123" }))
    vi.stubGlobal("fetch", fetch)
    expect(await sendDropEmail("fixture-key", message, "drop-email/2026-10-05T09:00:00.000Z/id")).toEqual({
      status: "sent",
      providerEmailId: "re_123",
    })
    expect(fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        body: JSON.stringify(message),
        headers: expect.objectContaining({
          Authorization: "Bearer fixture-key",
          "Idempotency-Key": "drop-email/2026-10-05T09:00:00.000Z/id",
        }),
      })
    )
  })

  it.each([
    [422, "rejected"],
    [400, "rejected"],
    // Nothing was accepted, and the cause is the account or the moment, not this address.
    [401, "not-sent"],
    [403, "not-sent"],
    [429, "not-sent"],
    // An idempotency conflict or a server error says nothing about whether the first try landed.
    [409, "unconfirmed"],
    [500, "unconfirmed"],
    [503, "unconfirmed"],
  ])("reads HTTP %i as %s", async (status, outcome) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("provider detail", { status })))
    expect(await sendDropEmail("fixture-key", message, "key")).toEqual({ status: outcome })
  })

  it("treats a lost connection or an unreadable receipt as unconfirmed, never as sent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")))
    expect(await sendDropEmail("fixture-key", message, "key")).toEqual({ status: "unconfirmed" })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })))
    expect(await sendDropEmail("fixture-key", message, "key")).toEqual({ status: "unconfirmed" })
  })

  it("refuses to address one email to several people", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const group = { ...message, to: ["a@example.com", "b@example.com"] } as unknown as DropEmailMessage
    await expect(sendDropEmail("fixture-key", group, "key")).rejects.toThrow("exactly one recipient")
    expect(fetch).not.toHaveBeenCalled()
  })
})
