import "../../../test/configured-store"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { storeConfig } from "@/lib/store-config"

import { CartCheckout } from "./cart-checkout"
import { CartContext, type CartContextValue } from "./cart-context"

const { trackStoreEvent, getOrderAttribution } = vi.hoisted(() => ({
  trackStoreEvent: vi.fn(),
  getOrderAttribution: vi.fn(),
}))
vi.mock("@/features/analytics/track-store-event", () => ({ trackStoreEvent }))
vi.mock("@/features/attribution/get-order-attribution", () => ({ getOrderAttribution }))

function mockNavigation(navigate = vi.fn()) {
  const browserWindow = window
  const origin = window.location.origin
  vi.stubGlobal(
    "window",
    new Proxy(browserWindow, {
      get(target, key) {
        return key === "location" ? { origin, assign: navigate } : Reflect.get(target, key, target)
      },
    })
  )
  return navigate
}

const context: CartContextValue = {
  importedCarts: [],
  importCart: async () => "added",
  items: [
    {
      productId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      variantId: 1,
      title: "Sample first design",
      variantTitle: "M",
      unitAmount: 2800,
      quantity: 1,
    },
  ],
  count: 1,
  subtotal: 2800,
  hydrated: true,
  persistenceWarning: false,
  addItem: () => true,
  setQuantity: () => {},
  removeItem: () => {},
  createCheckoutSnapshot: () => ({ createdAt: 1, entries: [{ entryId: "original", quantity: 1 }] }),
  rememberCheckout: () => {},
  confirmPurchase: () => {},
}

describe("cart shipping and checkout", () => {
  it("presents confirmed zero-rate shipping as free without adding a charge to the total", () => {
    storeConfig.commerce.firstItemShippingCents = 0
    storeConfig.commerce.additionalItemShippingCents = 0
    render(
      <CartContext value={context}>
        <CartCheckout />
      </CartContext>
    )
    expect(screen.getByText("Free", { selector: "dd" })).toBeVisible()
    expect(screen.getAllByText("$28.00", { selector: "dd" })).toHaveLength(2)
  })

  beforeEach(() => {
    trackStoreEvent.mockReset().mockReturnValue(true)
    getOrderAttribution.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("shows shipping immediately and starts checkout without collecting personal information", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ code: "NOT_CONFIGURED" }, { status: 503 }))
    vi.stubGlobal("fetch", fetcher)
    render(
      <CartContext value={context}>
        <CartCheckout />
      </CartContext>
    )
    expect(screen.getByText("$4.95", { selector: "dd" })).toBeVisible()
    expect(screen.getByText("$32.95", { selector: "dd" })).toBeVisible()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    expect(fetcher).not.toHaveBeenCalled()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Checkout" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Checkout isn’t open just yet")
    expect(fetcher).toHaveBeenCalledOnce()
    expect(trackStoreEvent).not.toHaveBeenCalled()
    const [url, options] = fetcher.mock.calls[0]!
    expect(url).toBe("/api/checkout")
    expect(JSON.parse(options.body)).toEqual({
      items: [{ productId: context.items[0]!.productId, variantId: 1, quantity: 1, expectedUnitAmount: 2800 }],
      expectedShippingAmount: 495,
      requestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
    })
  })

  it("updates the shipping and total immediately when quantities change across variants", () => {
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    const view = render(
      <CartContext value={context}>
        <CartCheckout />
      </CartContext>
    )
    view.rerender(
      <CartContext
        value={{
          ...context,
          items: [
            { ...context.items[0]!, quantity: 2 },
            { ...context.items[0]!, variantId: 2, quantity: 1 },
          ],
          subtotal: 8400,
        }}
      >
        <CartCheckout />
      </CartContext>
    )
    expect(screen.getByText("$9.75", { selector: "dd" })).toBeVisible()
    expect(screen.getByText("$93.75", { selector: "dd" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Checkout" })).toBeEnabled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("reuses the checkout request identity and original snapshot after an uncertain network failure", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("Network interrupted"))
    const createCheckoutSnapshot = vi.fn(context.createCheckoutSnapshot)
    vi.stubGlobal("fetch", fetcher)
    render(
      <CartContext value={{ ...context, createCheckoutSnapshot }}>
        <CartCheckout />
      </CartContext>
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Checkout" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Network interrupted")
    await user.click(screen.getByRole("button", { name: "Checkout" }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    const firstAttempt = JSON.parse(fetcher.mock.calls[0]![1].body) as { requestId: string }
    const retry = JSON.parse(fetcher.mock.calls[1]![1].body) as { requestId: string; expectedShippingAmount: number }
    expect(firstAttempt.requestId).toMatch(/^[a-f0-9-]{36}$/)
    expect(retry.requestId).toBe(firstAttempt.requestId)
    expect(retry.expectedShippingAmount).toBe(495)
    expect(createCheckoutSnapshot).toHaveBeenCalledOnce()
    expect(trackStoreEvent).not.toHaveBeenCalled()
  })

  it("freezes first-touch attribution with the request identity but stops resending it after an opt-out", async () => {
    const originalAttribution = {
      version: 1,
      capturedAt: "2026-09-21T10:00:00.000Z",
      source: "instagram",
      channel: "social",
      referrerHost: "l.instagram.com",
      utmSource: "instagram",
      utmMedium: "social",
      utmCampaign: "Autumn",
      landingPath: "/shop",
      method: "campaign",
    }
    getOrderAttribution.mockReturnValue(originalAttribution)
    const fetcher = vi.fn().mockRejectedValue(new Error("Network interrupted"))
    vi.stubGlobal("fetch", fetcher)
    render(
      <CartContext value={context}>
        <CartCheckout />
      </CartContext>
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Checkout" }))
    await screen.findByRole("alert")
    getOrderAttribution.mockReturnValue({ ...originalAttribution, source: "newsletter", channel: "email" })
    await user.click(screen.getByRole("button", { name: "Checkout" }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    type Request = { requestId: string; attribution?: typeof originalAttribution }
    const initial = JSON.parse(fetcher.mock.calls[0]![1].body) as Request
    const retry = JSON.parse(fetcher.mock.calls[1]![1].body) as Request
    expect(initial.attribution).toEqual(originalAttribution)
    expect(retry.attribution).toEqual(originalAttribution)
    expect(retry.requestId).toBe(initial.requestId)

    getOrderAttribution.mockReturnValue(undefined)
    await user.click(screen.getByRole("button", { name: "Checkout" }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    const denied = JSON.parse(fetcher.mock.calls[2]![1].body) as Request
    expect(denied.attribution).toBeUndefined()
    expect(denied.requestId).toBe(initial.requestId)
  })

  it.each(["payment", "completed"])("opens the trusted %s checkout destination", async (destination) => {
    const sessionId = "cs_test_completed1234567890"
    const origin = window.location.origin
    const navigate = mockNavigation()
    const url =
      destination === "completed"
        ? `${origin}/checkout/success?session_id=${sessionId}`
        : "https://checkout.stripe.com/c/pay/test"
    const rememberCheckout = vi.fn()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ url, sessionId })))
    render(
      <CartContext value={{ ...context, rememberCheckout }}>
        <CartCheckout />
      </CartContext>
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Checkout" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(url))
    expect(rememberCheckout).toHaveBeenCalledWith(sessionId, context.createCheckoutSnapshot())
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    if (destination === "payment") {
      expect(trackStoreEvent).toHaveBeenCalledExactlyOnceWith({ name: "begin_checkout", subtotalUsd: 28 })
      expect(trackStoreEvent.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]!)
    } else {
      expect(trackStoreEvent).not.toHaveBeenCalled()
    }
  })

  it("tracks a retried navigation once per checkout attempt and tracks a changed cart separately", async () => {
    const navigate = mockNavigation(
      vi.fn().mockImplementationOnce(() => {
        throw new Error("Navigation interrupted")
      })
    )
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          Response.json({ url: "https://checkout.stripe.com/c/pay/test", sessionId: "cs_test_attempt1234567890" })
        )
      )
    vi.stubGlobal("fetch", fetcher)
    const view = render(
      <CartContext value={context}>
        <CartCheckout />
      </CartContext>
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Checkout" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Navigation interrupted")
    expect(trackStoreEvent).toHaveBeenCalledExactlyOnceWith({ name: "begin_checkout", subtotalUsd: 28 })
    await user.click(screen.getByRole("button", { name: "Checkout" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(2))
    expect(trackStoreEvent).toHaveBeenCalledOnce()

    view.rerender(
      <CartContext value={{ ...context, items: [{ ...context.items[0]!, quantity: 2 }], subtotal: 5600 }}>
        <CartCheckout />
      </CartContext>
    )
    await user.click(screen.getByRole("button", { name: "Checkout" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(3))
    expect(trackStoreEvent.mock.calls).toEqual([
      [{ name: "begin_checkout", subtotalUsd: 28 }],
      [{ name: "begin_checkout", subtotalUsd: 56 }],
    ])
    const requestIds = fetcher.mock.calls.map(
      ([, options]) => (JSON.parse(options.body) as { requestId: string }).requestId
    )
    expect(requestIds[1]).toBe(requestIds[0])
    expect(requestIds[2]).not.toBe(requestIds[0])
  })

  it("tracks only after a failed request recovers with a trusted Stripe destination", async () => {
    const navigate = mockNavigation()
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network interrupted"))
      .mockResolvedValueOnce(
        Response.json({ url: "https://checkout.stripe.com/c/pay/test", sessionId: "cs_test_recovered1234567890" })
      )
    vi.stubGlobal("fetch", fetcher)
    render(
      <CartContext value={context}>
        <CartCheckout />
      </CartContext>
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Checkout" }))
    await screen.findByRole("alert")
    expect(trackStoreEvent).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Checkout" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce())
    expect(trackStoreEvent).toHaveBeenCalledExactlyOnceWith({ name: "begin_checkout", subtotalUsd: 28 })
  })

  it("opens Stripe checkout when tracking is unavailable", async () => {
    trackStoreEvent.mockReturnValue(false)
    const navigate = mockNavigation()
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ url: "https://checkout.stripe.com/c/pay/test", sessionId: "cs_test_untracked1234567890" })
        )
    )
    render(
      <CartContext value={context}>
        <CartCheckout />
      </CartContext>
    )
    await userEvent.click(screen.getByRole("button", { name: "Checkout" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/test"))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(trackStoreEvent).toHaveBeenCalledOnce()
  })

  it.each([undefined, "invalid-session"])(
    "does not track a trusted URL with an invalid session: %s",
    async (sessionId) => {
      const navigate = mockNavigation()
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce(Response.json({ url: "https://checkout.stripe.com/c/pay/test", sessionId }))
      )
      render(
        <CartContext value={context}>
          <CartCheckout />
        </CartContext>
      )
      await userEvent.click(screen.getByRole("button", { name: "Checkout" }))
      expect(await screen.findByRole("alert")).toHaveTextContent("We couldn’t open secure checkout")
      expect(trackStoreEvent).not.toHaveBeenCalled()
      expect(navigate).not.toHaveBeenCalled()
    }
  )

  it.each([
    "https://elsewhere.example/checkout/success?session_id=cs_test_completed1234567890",
    "/cart?session_id=cs_test_completed1234567890",
    "/checkout/success?session_id=cs_test_different1234567890",
    "/checkout/success?session_id=cs_test_completed1234567890&session_id=cs_test_different1234567890",
    "/checkout/success?session_id=cs_test_completed1234567890#other",
    "https://checkout.stripe.com.evil.example/c/pay/test",
    "https://someone@checkout.stripe.com/c/pay/test",
  ])("rejects an untrusted or mismatched checkout destination: %s", async (destination) => {
    const rememberCheckout = vi.fn()
    const url = new URL(destination, window.location.origin).href
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(Response.json({ url, sessionId: "cs_test_completed1234567890" }))
    )
    render(
      <CartContext value={{ ...context, rememberCheckout }}>
        <CartCheckout />
      </CartContext>
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Checkout" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn’t open secure checkout")
    expect(rememberCheckout).not.toHaveBeenCalled()
    expect(trackStoreEvent).not.toHaveBeenCalled()
  })

  it("aborts checkout when quantities change and ignores a late checkout response", async () => {
    let resolveCheckout: (value: Response) => void = () => {}
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveCheckout = resolve
        })
    )
    const rememberCheckout = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    const view = render(
      <CartContext value={{ ...context, rememberCheckout }}>
        <CartCheckout />
      </CartContext>
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Checkout" }))
    expect(screen.getByRole("button", { name: "Opening secure checkout…" })).toBeDisabled()
    const signal = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].signal
    view.rerender(
      <CartContext
        value={{ ...context, rememberCheckout, items: [{ ...context.items[0]!, quantity: 2 }], subtotal: 5600 }}
      >
        <CartCheckout />
      </CartContext>
    )
    expect(signal?.aborted).toBe(true)
    expect(screen.getByText("$7.35", { selector: "dd" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Checkout" })).toBeEnabled()
    await act(async () => {
      resolveCheckout(
        Response.json({ url: "https://checkout.stripe.com/c/pay/test", sessionId: "cs_test_stale1234567890" })
      )
    })
    expect(rememberCheckout).not.toHaveBeenCalled()
    expect(trackStoreEvent).not.toHaveBeenCalled()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("keeps a newer checkout identity when a stale request reports an expired checkout", async () => {
    let resolveCheckout: (value: Response) => void = () => {}
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveCheckout = resolve
          })
      )
      .mockRejectedValue(new Error("Network interrupted"))
    vi.stubGlobal("fetch", fetcher)
    const view = render(
      <CartContext value={context}>
        <CartCheckout />
      </CartContext>
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Checkout" }))
    view.rerender(
      <CartContext value={{ ...context, items: [{ ...context.items[0]!, quantity: 2 }], subtotal: 5600 }}>
        <CartCheckout />
      </CartContext>
    )
    await user.click(screen.getByRole("button", { name: "Checkout" }))
    await screen.findByRole("alert")
    await act(async () => {
      resolveCheckout(Response.json({ code: "REQUEST_EXPIRED" }, { status: 409 }))
    })
    await user.click(screen.getByRole("button", { name: "Checkout" }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    const original = JSON.parse(fetcher.mock.calls[0]![1].body) as { requestId: string }
    const changed = JSON.parse(fetcher.mock.calls[1]![1].body) as { requestId: string; expectedShippingAmount: number }
    const retry = JSON.parse(fetcher.mock.calls[2]![1].body) as { requestId: string }
    expect(changed.requestId).not.toBe(original.requestId)
    expect(changed.expectedShippingAmount).toBe(735)
    expect(retry.requestId).toBe(changed.requestId)
  })

  it.each([
    ["REQUEST_EXPIRED", "That checkout has expired"],
    ["SHIPPING_CHANGED", "Refresh this page to review the updated total"],
    ["PRICE_CHANGED", "An item’s price has changed"],
    ["REQUEST_CONFLICT", "Your checkout needs a refresh"],
    ["PRODUCT_CHANGED", "Your checkout needs a refresh"],
    ["CHECKOUT_MODE_MISMATCH", "Your checkout needs a refresh"],
  ])("starts a fresh identity after a confirmed %s failure", async (code, message) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ code }, { status: 409 }))
      .mockRejectedValueOnce(new Error("Network interrupted"))
    vi.stubGlobal("fetch", fetcher)
    render(
      <CartContext value={context}>
        <CartCheckout />
      </CartContext>
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Checkout" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(message!)
    await user.click(screen.getByRole("button", { name: "Checkout" }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    const failed = JSON.parse(fetcher.mock.calls[0]![1].body) as { requestId: string }
    const fresh = JSON.parse(fetcher.mock.calls[1]![1].body) as { requestId: string }
    expect(fresh.requestId).not.toBe(failed.requestId)
    expect(trackStoreEvent).not.toHaveBeenCalled()
  })
})

it.each(["configured", "policies", "shipping"])(
  "keeps checkout and placeholder shipping closed without %s approval",
  async (missing) => {
    if (missing === "configured") storeConfig.configured = false
    if (missing === "policies") storeConfig.policies.published = false
    if (missing === "shipping") storeConfig.commerce.shippingConfirmed = false
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    render(
      <CartContext value={context}>
        <CartCheckout />
      </CartContext>
    )
    expect(screen.getByRole("status")).toHaveTextContent("preparing checkout")
    expect(screen.getByRole("button", { name: "Checkout unavailable" })).toBeDisabled()
    expect(screen.queryByText("US shipping")).not.toBeInTheDocument()
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole("button", { name: "Checkout unavailable" }))
    expect(fetcher).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  }
)
