import type Stripe from "stripe"
import { describe, expect, it, vi } from "vitest"
import { orderAlertFixture } from "../../../test/order-alert-fixture"
import { readOrderPayment } from "./read-order-payment.server"
vi.mock("server-only", () => ({}))

describe("current payment checks", () => {
  it.each(["paid", "refunded", "partial_refund", "disputed", "unknown"] as const)(
    "handles %s without changing payment or refunding",
    async (expected) => {
      const order = orderAlertFixture()
      const intent = {
        id: "pi_fixture",
        livemode: true,
        status: "succeeded",
        currency: "usd",
        amount_received: 3495,
        metadata: { storefront: "fixture-store", checkout_request_id: order.request_id },
        latest_charge: {
          paid: true,
          livemode: true,
          currency: "usd",
          amount: 3495,
          amount_refunded: 0,
          refunded: false,
          disputed: false,
        },
      }
      if (expected === "refunded") {
        intent.latest_charge.refunded = true
        intent.latest_charge.amount_refunded = 3495
      }
      if (expected === "partial_refund") intent.latest_charge.amount_refunded = 495
      if (expected === "disputed") intent.latest_charge.disputed = true
      if (expected === "unknown") intent.metadata.checkout_request_id = "wrong-order"
      const retrieve = vi.fn().mockResolvedValue(intent)
      const stripe = { paymentIntents: { retrieve } } as unknown as Stripe
      expect(await readOrderPayment(stripe, order)).toBe(expected)
      expect(retrieve).toHaveBeenCalledExactlyOnceWith(
        "pi_fixture",
        { expand: ["latest_charge"] },
        { maxNetworkRetries: 0, timeout: 15_000 }
      )
    }
  )
  it("keeps alerts eligible when a payment read is unavailable", async () => {
    const stripe = { paymentIntents: { retrieve: vi.fn().mockRejectedValue(new Error("secret")) } } as unknown as Stripe
    expect(await readOrderPayment(stripe, orderAlertFixture())).toBe("unknown")
  })
})
