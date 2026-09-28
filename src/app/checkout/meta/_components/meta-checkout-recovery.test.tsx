import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { checkoutRecoveryHistoryKey } from "@/features/checkout/checkout-recovery-history-key"

import { MetaCheckoutRecovery } from "./meta-checkout-recovery"

vi.mock("./meta-checkout-content", () => ({
  MetaCheckoutContent: () => <p>Recovered selection</p>,
}))

beforeEach(() => {
  window.history.replaceState(
    { [checkoutRecoveryHistoryKey]: { kind: "meta", selector: "a".repeat(32) } },
    "",
    "/checkout/meta"
  )
})

afterEach(() => vi.unstubAllGlobals())

describe("shopping selection recovery feedback", () => {
  it.each(["404", "missing history"])("offers shopping links without retry for %s", async (failure) => {
    if (failure === "missing history") window.history.replaceState(null, "", "/checkout/meta")
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    vi.stubGlobal("fetch", fetcher)

    render(<MetaCheckoutRecovery />)

    expect(await screen.findByRole("alert")).toHaveTextContent("no longer available in this browser")
    expect(screen.getByRole("alert")).toHaveTextContent("Reopen the original Facebook or Instagram shopping link")
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Browse the shirts" })).toHaveAttribute("href", "/shop")
    expect(screen.getByRole("link", { name: "View your existing cart" })).toHaveAttribute("href", "/cart")
    expect(fetcher).toHaveBeenCalledTimes(failure === "404" ? 1 : 0)
  })

  it("lets a customer retry a network failure and resumes their selection", async () => {
    const user = userEvent.setup()
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(Response.json({ kind: "meta", result: { status: "ready", items: [], importKey: "key" } }))
    vi.stubGlobal("fetch", fetcher)

    render(<MetaCheckoutRecovery />)

    await user.click(await screen.findByRole("button", { name: "Try again" }))
    expect(await screen.findByText("Recovered selection")).toBeVisible()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
