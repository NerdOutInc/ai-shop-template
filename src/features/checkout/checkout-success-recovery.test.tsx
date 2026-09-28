import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { checkoutRecoveryHistoryKey } from "./checkout-recovery-history-key"
import { CheckoutSuccessRecovery } from "./checkout-success-recovery"

vi.mock("@/features/cart/checkout-status", () => ({
  CheckoutStatus: ({ sessionId }: { sessionId: string | null }) => <p>Recovered checkout: {sessionId}</p>,
}))

beforeEach(() => {
  window.history.replaceState(
    { [checkoutRecoveryHistoryKey]: { kind: "success", selector: "a".repeat(32) } },
    "",
    "/checkout/success"
  )
})

afterEach(() => vi.unstubAllGlobals())

describe("order status recovery feedback", () => {
  it.each(["404", "missing history"])("offers receipt and support guidance without retry for %s", async (failure) => {
    if (failure === "missing history") window.history.replaceState(null, "", "/checkout/success")
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    vi.stubGlobal("fetch", fetcher)

    render(<CheckoutSuccessRecovery />)

    expect(await screen.findByRole("alert")).toHaveTextContent("no longer available in this browser")
    expect(screen.getByRole("alert")).toHaveTextContent("Check your Stripe receipt")
    expect(screen.getByRole("alert")).toHaveTextContent("Please don’t place another order")
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Contact us about your order" })).toHaveAttribute(
      "href",
      "mailto:support@example.com"
    )
    expect(screen.getByRole("link", { name: "Browse the shirts" })).toHaveAttribute("href", "/shop")
    expect(fetcher).toHaveBeenCalledTimes(failure === "404" ? 1 : 0)
  })

  it("lets a customer retry a temporary failure and resumes their exact checkout", async () => {
    const user = userEvent.setup()
    const sessionId = "cs_live_original1234567890"
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ kind: "success", sessionId }))
    vi.stubGlobal("fetch", fetcher)

    render(<CheckoutSuccessRecovery />)

    const retry = await screen.findByRole("button", { name: "Try again" })
    expect(screen.getByRole("alert")).toHaveTextContent("This doesn’t mean your payment failed")
    await user.click(retry)
    expect(await screen.findByText(`Recovered checkout: ${sessionId}`)).toBeVisible()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
