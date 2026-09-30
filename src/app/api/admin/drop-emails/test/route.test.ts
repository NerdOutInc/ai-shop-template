// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "./route"

const mocks = vi.hoisted(() => ({
  env: { RESEND_API_KEY: "re_fixture", VERCEL_ENV: "production", VERCEL_URL: "preview.vercel.app" },
  actor: vi.fn(),
  next: vi.fn(),
  send: vi.fn(),
  setup: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env: mocks.env }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor: mocks.actor }))
vi.mock("@/features/drop-emails/render-next-drop-email.server", () => ({ renderNextDropEmail: mocks.next }))
vi.mock("@/features/drop-emails/send-drop-email.server", () => ({ sendDropEmail: mocks.send }))
vi.mock("@/features/drop-emails/read-drop-email-setup.server", () => ({ readDropEmailSetup: mocks.setup }))

const request = (origin: string | null = "https://store.example") =>
  new Request("https://store.example/api/admin/drop-emails/test", {
    method: "POST",
    headers: origin ? { origin } : {},
  })

beforeEach(() => {
  mocks.env.RESEND_API_KEY = "re_fixture"
  mocks.actor.mockReset().mockResolvedValue({ userId: "owner" })
  mocks.setup.mockReset().mockReturnValue({ from: "Fixture Store <drops@fixture.example>", storeSettings: [] })
  mocks.next.mockReset().mockResolvedValue({
    status: "ready",
    liveAt: "2026-10-05T09:00:00.000Z",
    sendAt: "2026-10-05T14:00:00.000Z",
    productCount: 1,
    subject: "New this week: Abstract Lines",
    html: '<a href="https://store.example/unsubscribe/drop-email-subscriber-placeholder">Unsubscribe</a>',
    text: "Unsubscribe https://store.example/unsubscribe/drop-email-subscriber-placeholder",
  })
  mocks.send.mockReset().mockResolvedValue({ status: "sent", providerEmailId: "re_test" })
})

describe("drop email test send", () => {
  it("sends the next drop's email to the store's own inbox, marked as a test, with a link that unsubscribes nobody", async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    const [apiKey, message, key] = mocks.send.mock.calls[0]!
    expect(apiKey).toBe("re_fixture")
    expect(message).toMatchObject({
      to: ["support@fixture.example"],
      from: "Fixture Store <drops@fixture.example>",
      subject: "[Test] New this week: Abstract Lines",
      html: '<a href="https://store.example/unsubscribe/00000000-0000-4000-8000-000000000000">Unsubscribe</a>',
    })
    // A fresh key per click: the owner pressing it twice means two tests.
    expect(key).toMatch(/^drop-email-test\/[0-9a-f-]{36}$/)
  })

  it.each([null, "https://foreign.example"])("refuses origin %s before anything else", async (origin) => {
    expect((await POST(request(origin))).status).toBe(403)
    expect(mocks.actor).not.toHaveBeenCalled()
  })

  it("needs an administrator", async () => {
    mocks.actor.mockResolvedValue(null)
    expect((await POST(request())).status).toBe(401)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("explains what is missing instead of trying", async () => {
    mocks.env.RESEND_API_KEY = ""
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: "Email sending isn't set up yet. Add RESEND_API_KEY and DROP_EMAIL_FROM_EMAIL in Vercel first.",
    })
    mocks.env.RESEND_API_KEY = "re_fixture"
    mocks.next.mockResolvedValue({ status: "none" })
    expect((await POST(request())).status).toBe(409)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  // An unconfigured store's support address is still the template's placeholder.
  it("waits for the store configuration before mailing its support address", async () => {
    mocks.setup.mockReturnValue({
      from: "Fixture Store <drops@fixture.example>",
      storeSettings: ["configured", "policies.published"],
    })
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: "Finish the store configuration first: the test goes to its support email.",
    })
    expect(mocks.next).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("does not call an unconfirmed test a success", async () => {
    mocks.send.mockResolvedValue({ status: "unconfirmed" })
    const response = await POST(request())
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: "Resend didn't confirm the test. Check the Resend dashboard before sending another.",
    })
  })
})
