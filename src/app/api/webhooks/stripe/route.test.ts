// @vitest-environment node
import Stripe from "stripe"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { fulfillCheckout } from "@/features/checkout/fulfill-checkout.server"
import { getCommerceServices } from "@/features/checkout/get-commerce-services.server"

import { POST } from "./route"

vi.mock("server-only", () => ({}))
vi.mock("@/features/checkout/fulfill-checkout.server", () => ({ fulfillCheckout: vi.fn() }))
vi.mock("@/features/checkout/get-commerce-services.server", () => ({ getCommerceServices: vi.fn() }))

const stripe = new Stripe("sk_test_not_a_real_key")
const secret = "whsec_fixture_signature_test"
const sessionId = "cs_test_fixture12345678901234567890"

function request(eventType: string, validSignature = true) {
  const body = JSON.stringify({
    id: "evt_fixture",
    object: "event",
    type: eventType,
    data: { object: { id: sessionId } },
  })
  return new Request("https://shop.example.com/api/webhooks/stripe", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "stripe-signature": stripe.webhooks.generateTestHeaderString({
        payload: validSignature ? body : "tampered",
        secret,
      }),
    },
  })
}

beforeEach(() => {
  vi.mocked(getCommerceServices).mockReturnValue({ stripe, webhookSecret: secret } as never)
  vi.mocked(fulfillCheckout).mockResolvedValue("submitted")
})

describe("Stripe webhook", () => {
  it("rejects a modified payload before fulfillment", async () => {
    expect((await POST(request("checkout.session.completed", false))).status).toBe(400)
    expect(fulfillCheckout).not.toHaveBeenCalled()
  })

  it.each(["checkout.session.completed", "checkout.session.async_payment_succeeded"])(
    "fulfills authenticated %s events",
    async (eventType) => {
      expect((await POST(request(eventType))).status).toBe(200)
      expect(fulfillCheckout).toHaveBeenCalledWith(expect.anything(), sessionId)
    }
  )

  it("returns an error so Stripe retries unsuccessful fulfillment", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.mocked(fulfillCheckout).mockRejectedValue(new Error("sensitive-provider-response"))
    const response = await POST(request("checkout.session.completed"))
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain("sensitive-provider-response")
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("sensitive-provider-response")
  })

  it("acknowledges unrelated events without creating orders", async () => {
    expect((await POST(request("customer.created"))).status).toBe(200)
    expect(fulfillCheckout).not.toHaveBeenCalled()
  })
})
