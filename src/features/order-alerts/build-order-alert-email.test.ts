import { describe, expect, it } from "vitest"
import { orderAlertFixture } from "../../../test/order-alert-fixture"
import { buildOrderAlertEmail } from "./build-order-alert-email"

describe("owner-only shipping reminder", () => {
  const input = () => ({
    order: orderAlertFixture(),
    shipment: { complete: false, needsAttention: false, summary: "0 of 1 lines shipped.", items: [] },
    payment: "paid" as const,
    now: new Date("2026-09-14T16:00:00Z"),
    from: "orders@example.com",
    siteUrl: "https://example.com",
  })
  it("includes a private exact order link, useful facts and a clearly unsent draft", () => {
    const email = buildOrderAlertEmail(input())
    expect(email.to).toEqual(["support@fixture.example"])
    expect(email.subject).toContain("Shipping check-in")
    expect(email.text).toContain("Original ship-by date: 2026-09-16")
    expect(email.text).toContain("Business days since payment: 8")
    expect(email.text).toContain("https://example.com/admin/orders?order=6224014e-39f1-4dfb-9198-824768f4b53f")
    expect(email.text).toContain("jamie@example.test")
    expect(email.text).toContain("Everyday tee (Black / M)")
    expect(email.text).toContain("has NOT been sent to the customer")
    expect(email.text).toContain("[confirmed reason]")
  })
  it("keeps the original handling window and time zone in the promised deadline", () => {
    const checkout = input()
    checkout.order.payment.paidAt = "2026-09-01T01:00:00Z"
    checkout.order.snapshot.shippingEstimate = {
      handlingBusinessDays: 2,
      calendar: "us-federal-v1",
      timeZone: "America/Los_Angeles",
    }
    const email = buildOrderAlertEmail(checkout)
    expect(email.text).toContain(
      "Original ship-by date: 2026-09-02 (end of day, America/Los_Angeles; 2 business days after payment)"
    )
  })
})
