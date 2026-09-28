import { afterEach, expect, it, vi } from "vitest"
import { sendOrderAlert } from "./send-order-alert.server"
vi.mock("server-only", () => ({}))
afterEach(() => vi.unstubAllGlobals())
const email = {
  from: "orders@example.com",
  to: ["support@example.com"],
  subject: "Check order",
  text: "Internal reminder",
}
it("sends only to the owner with the supplied stable idempotency key", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ id: "receipt" }))
  vi.stubGlobal("fetch", fetch)
  expect(await sendOrderAlert("fixture", email, "order-shipping/id/date")).toBe("receipt")
  expect(fetch).toHaveBeenCalledWith(
    "https://api.resend.com/emails",
    expect.objectContaining({
      method: "POST",
      redirect: "error",
      body: JSON.stringify(email),
      headers: expect.objectContaining({ "Idempotency-Key": "order-shipping/id/date" }),
    })
  )
})
it("rejects customer recipients before network I/O", async () => {
  const fetch = vi.fn()
  vi.stubGlobal("fetch", fetch)
  await expect(sendOrderAlert("fixture", { ...email, to: ["customer@example.test"] }, "key")).rejects.toThrow(
    "Invalid alert recipient"
  )
  expect(fetch).not.toHaveBeenCalled()
})
it("does not expose provider errors", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret customer payload", { status: 500 })))
  await expect(sendOrderAlert("fixture", email, "key")).rejects.toThrow("Owner alert could not be confirmed")
})
