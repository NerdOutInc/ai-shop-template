// @vitest-environment node
import Stripe from "stripe"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { fulfillCheckout } from "@/features/checkout/fulfill-checkout.server"
import { getCommerceServices } from "@/features/checkout/get-commerce-services.server"

import { orderAlertFixture } from "../../../../../test/order-alert-fixture"

import { POST } from "./route"

vi.mock("server-only", () => ({}))
vi.mock("@/features/checkout/fulfill-checkout.server", () => ({ fulfillCheckout: vi.fn() }))
vi.mock("@/features/checkout/get-commerce-services.server", () => ({ getCommerceServices: vi.fn() }))

const stripe = new Stripe("sk_test_not_a_real_key")
const secret = "whsec_fixture_signature_test"
const sessionId = "cs_test_fixture12345678901234567890"

function request(eventType: string, validSignature = true, apiVersion = "2026-09-30.endive", timestamp?: number) {
  const body = JSON.stringify({
    id: "evt_fixture",
    object: "event",
    type: eventType,
    api_version: apiVersion,
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
        timestamp,
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

  it("rejects an expired authentic signature before fulfillment", async () => {
    const timestamp = Math.floor(Date.now() / 1000) - 600
    expect((await POST(request("checkout.session.completed", true, "2026-09-30.endive", timestamp))).status).toBe(400)
    expect(fulfillCheckout).not.toHaveBeenCalled()
  })

  describe.each(["2026-08-26.dahlia", "2026-09-30.endive"])("%s webhook snapshots", (apiVersion) => {
    it.each(["checkout.session.completed", "checkout.session.async_payment_succeeded"])(
      "fulfills authenticated %s events by retrieving the session",
      async (eventType) => {
        expect((await POST(request(eventType, true, apiVersion))).status).toBe(200)
        expect(fulfillCheckout).toHaveBeenCalledWith(expect.anything(), sessionId)
      }
    )
  })

  it.each(["matches", "missing", "foreign"] as const)(
    "checks delayed-payment failure against the saved commerce identity: %s",
    async (identity) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined)
      const order = orderAlertFixture().snapshot
      order.commerceIdentity = "permanent-store"
      if (identity === "missing") Reflect.deleteProperty(order, "commerceIdentity")
      const stored = { order, sessionId, state: "pending" }
      const update = vi.fn(async () => {})
      vi.spyOn(stripe.checkout.sessions, "retrieve").mockResolvedValue({
        id: sessionId,
        payment_status: "unpaid",
        metadata: {
          storefront: identity === "foreign" ? "another-store" : "permanent-store",
          checkout_request_id: order.requestId,
          shop_id: order.shopId,
        },
      } as never)
      vi.mocked(getCommerceServices).mockReturnValue({
        stripe,
        webhookSecret: secret,
        store: {
          findBySession: async () => stored,
          withLock: async (_requestId: string, callback: (record: unknown) => Promise<void>) =>
            callback({ get: async () => stored, update }),
        },
      } as never)
      expect((await POST(request("checkout.session.async_payment_failed"))).status).toBe(
        identity === "matches" ? 200 : 500
      )
      if (identity === "matches") expect(update).toHaveBeenCalledExactlyOnceWith({ failureCode: "PAYMENT_FAILED" })
      else expect(update).not.toHaveBeenCalled()
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
