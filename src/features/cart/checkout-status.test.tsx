import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { trackPurchaseConversion } from "@/features/analytics/track-purchase-conversion"

import { CartContext, type CartContextValue } from "./cart-context"
import { CheckoutStatus } from "./checkout-status"

vi.mock("@/features/analytics/track-purchase-conversion", () => ({ trackPurchaseConversion: vi.fn() }))

function context(confirmPurchase: CartContextValue["confirmPurchase"]): CartContextValue {
  return {
    importedCarts: [],
    importCart: async () => "added",
    items: [],
    count: 0,
    subtotal: 0,
    hydrated: true,
    persistenceWarning: false,
    addItem: () => true,
    setQuantity: () => {},
    removeItem: () => {},
    createCheckoutSnapshot: () => ({ createdAt: 1, entries: [] }),
    rememberCheckout: () => {},
    confirmPurchase,
  }
}

describe("checkout payment confirmation", () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(["pending", "expired", "failed"])("keeps the bag when payment is %s", async (paymentStatus) => {
    const confirmPurchase = vi.fn()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ paymentStatus, fulfillmentStatus: "pending" })))
    render(
      <CartContext value={context(confirmPurchase)}>
        <CheckoutStatus sessionId="cs_test_example1234567890" />
      </CartContext>
    )
    await waitFor(() => expect(screen.queryByText(/confirming your payment with Stripe/)).not.toBeInTheDocument())
    expect(confirmPurchase).not.toHaveBeenCalled()
    expect(trackPurchaseConversion).not.toHaveBeenCalled()
  })

  it("consumes only the paid session snapshot and clearly distinguishes test fulfillment", async () => {
    const confirmPurchase = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ paymentStatus: "paid", fulfillmentStatus: "simulated" }))
    )
    render(
      <CartContext value={context(confirmPurchase)}>
        <CheckoutStatus sessionId="cs_test_example1234567890" />
      </CartContext>
    )
    expect(await screen.findByText(/No real order was sent for printing/)).toBeVisible()
    expect(confirmPurchase).toHaveBeenCalledExactlyOnceWith("cs_test_example1234567890")
    expect(trackPurchaseConversion).not.toHaveBeenCalled()
  })

  it("measures a confirmed live payment even when printing needs attention", async () => {
    const purchase = { receipt: "a".repeat(64), totalUsd: 32.95 }
    const confirmPurchase = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ paymentStatus: "paid", fulfillmentStatus: "action_required", purchase }))
    )
    render(
      <CartContext value={context(confirmPurchase)}>
        <CheckoutStatus sessionId="cs_live_example1234567890" />
      </CartContext>
    )
    expect(await screen.findByText(/order needs a little attention/)).toBeVisible()
    expect(trackPurchaseConversion).toHaveBeenCalledExactlyOnceWith(purchase)
    expect(confirmPurchase).toHaveBeenCalledExactlyOnceWith("cs_live_example1234567890")
  })

  it("offers retry after an unavailable status without claiming a failed payment", async () => {
    const confirmPurchase = vi.fn()
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")))
    render(
      <CartContext value={context(confirmPurchase)}>
        <CheckoutStatus sessionId="cs_test_example1234567890" />
      </CartContext>
    )
    expect(await screen.findByRole("button", { name: "Check order status" })).toBeVisible()
    expect(screen.getByText(/doesn’t mean your payment failed/)).toBeVisible()
    expect(confirmPurchase).not.toHaveBeenCalled()
  })

  it("does not make a status request without a valid Stripe session", () => {
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    render(
      <CartContext value={context(vi.fn())}>
        <CheckoutStatus sessionId="untrusted" />
      </CartContext>
    )
    expect(screen.getByText(/doesn’t include a valid checkout/)).toBeVisible()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
