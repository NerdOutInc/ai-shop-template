import "../../../test/configured-store"
import { render, screen, waitFor } from "@testing-library/react"
import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { usePathname } from "next/navigation"

import { storeConfig } from "@/lib/store-config"

import { StoreAnalytics } from "./store-analytics"

const { getOrderAttribution } = vi.hoisted(() => ({ getOrderAttribution: vi.fn() }))
vi.mock("@/features/attribution/get-order-attribution", () => ({ getOrderAttribution }))
vi.mock("@vercel/analytics/next", () => ({ Analytics: vi.fn(() => <div data-testid="analytics-mounted" />) }))
vi.mock("next/navigation", () => ({ usePathname: vi.fn(() => "/shop") }))

async function analyticsBeforeSend() {
  render(<StoreAnalytics />)
  await waitFor(() => expect(Analytics).toHaveBeenCalled())
  const beforeSend = vi.mocked(Analytics).mock.calls.at(-1)?.[0].beforeSend
  if (!beforeSend) throw new Error("Store analytics must redact checkout references before sending events.")
  return beforeSend
}

describe("store analytics privacy", () => {
  beforeEach(() => vi.mocked(usePathname).mockReturnValue("/shop"))

  it.each(["identity", "policies", "shipping"])(
    "does not collect attribution or mount analytics before %s readiness",
    (flag) => {
      if (flag === "identity") storeConfig.configured = false
      if (flag === "policies") storeConfig.policies.published = false
      if (flag === "shipping") storeConfig.commerce.shippingConfirmed = false
      render(<StoreAnalytics />)
      expect(getOrderAttribution).not.toHaveBeenCalled()
      expect(Analytics).not.toHaveBeenCalled()
      expect(screen.queryByTestId("analytics-mounted")).not.toBeInTheDocument()
    }
  )

  it("captures first-party attribution on arrival and does not capture private navigation", async () => {
    const view = render(<StoreAnalytics />)
    await waitFor(() => expect(getOrderAttribution).toHaveBeenCalledOnce())
    vi.mocked(usePathname).mockReturnValue("/admin/account")
    view.rerender(<StoreAnalytics />)
    expect(getOrderAttribution).toHaveBeenCalledOnce()
  })

  it.each(["/admin", "/admin/setup", "/admin/sign-in", "/admin/account"])(
    "unmounts the loaded analytics component on %s",
    async (pathname) => {
      const view = render(<StoreAnalytics />)
      await screen.findByTestId("analytics-mounted")
      expect(Analytics).toHaveBeenCalled()
      vi.mocked(Analytics).mockClear()

      vi.mocked(usePathname).mockReturnValue(pathname)
      view.rerender(<StoreAnalytics />)

      await waitFor(() => expect(screen.queryByTestId("analytics-mounted")).not.toBeInTheDocument())
      expect(Analytics).not.toHaveBeenCalled()
    }
  )

  it.each<BeforeSendEvent["type"]>(["pageview", "event"])(
    "removes every checkout session reference from a %s without changing campaign data or the original event",
    async (type) => {
      const beforeSend = await analyticsBeforeSend()
      const url =
        "https://store.example/checkout/success?session_id=cs_test_first&%73ession_id=cs_live_second&utm_source=design%20club&utm_campaign=fall&session_id=cs_test_third#receipt"
      const payload = Object.freeze({ name: "Visit", data: { source: "navigation" } })
      const event = Object.freeze({ type, url, payload })

      const result = beforeSend(event)

      expect(result).toEqual({
        type,
        url: "https://store.example/checkout/success?utm_source=design+club&utm_campaign=fall#receipt",
        payload,
      })
      expect(result).not.toBe(event)
      expect(event).toEqual({ type, url, payload })
    }
  )

  it("preserves an ordinary pageview and its unrelated query parameters", async () => {
    const beforeSend = await analyticsBeforeSend()
    const event: BeforeSendEvent = {
      type: "pageview",
      url: "https://store.example/shop?utm_source=newsletter&ref=design-club",
    }

    expect(beforeSend(event)).toEqual(event)
  })
})
