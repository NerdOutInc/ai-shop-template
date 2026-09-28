import type { AlertOrder } from "@/features/order-alerts/order-alert"

export function orderAlertFixture(): AlertOrder {
  const requestId = "6224014e-39f1-4dfb-9198-824768f4b53f"
  return {
    request_id: requestId,
    session_id: "cs_live_fixture",
    printify_order_id: "printify-fixture",
    state: "submitted",
    failure_code: null,
    snapshot: {
      requestId,
      requestFingerprint: "fixture",
      expiresAt: 0,
      shopId: "123",
      currency: "usd",
      shippingMode: "flat_rate",
      shippingAmount: 495,
      subtotal: 3000,
      shippingEstimate: { handlingBusinessDays: 10, calendar: "us-federal-v1", timeZone: "America/Chicago" },
      items: [
        {
          productId: "tee",
          variantId: 1,
          quantity: 1,
          unitAmount: 3000,
          title: "Everyday tee",
          variantLabel: "Black / M",
          productFingerprint: "fixture",
        },
      ],
    },
    payment: {
      status: "paid",
      paymentIntentId: "pi_fixture",
      paidAt: "2026-09-01T16:00:00.000Z",
      livemode: true,
      currency: "usd",
      subtotalAmount: 3000,
      shippingAmount: 495,
      taxAmount: 0,
      totalAmount: 3495,
      customerName: "Jamie Customer",
      customerEmail: "jamie@example.test",
    },
  }
}
