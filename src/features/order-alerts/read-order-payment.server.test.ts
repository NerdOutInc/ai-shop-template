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
      order.snapshot.commerceIdentity = "permanent-store"
      const intent = {
        id: "pi_fixture",
        livemode: true,
        status: "succeeded",
        currency: "usd",
        amount_received: 3495,
        metadata: { storefront: "permanent-store", checkout_request_id: order.request_id },
