import { runInNewContext } from "node:vm"

import { renderHook, waitFor } from "@testing-library/react"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createCheckoutIngress } from "./create-checkout-ingress.server"
import { useCheckoutRecovery } from "./use-checkout-recovery"

vi.mock("server-only", () => ({}))

beforeEach(() => {
  vi.resetModules()
  sessionStorage.clear()
  localStorage.clear()
  Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false })
  vi.spyOn(document, "referrer", "get").mockReturnValue("")
  // The readers must recover from the actual handoff, without a storage fallback hiding a mismatch.
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage unavailable")
  })
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable")
  })
})

afterEach(() => vi.unstubAllGlobals())

describe("checkout recovery history contract", () => {
  it.each(["success", "meta"] as const)("recovers the %s handoff through the real readers", async (kind) => {
    const sessionId = "cs_live_historycontract1234567890"
    const query =
      kind === "success" ? `session_id=${sessionId}&utm_medium=social` : "products=private&cart_origin=instagram"
    const path = `/checkout/${kind}`
    window.history.replaceState({ previousPage: "preserved" }, "", `${path}?${query}`)
    const ingress = createCheckoutIngress(new NextRequest(window.location.href))
    const script = new DOMParser()
      .parseFromString(await ingress.text(), "text/html")
      .querySelector("script")!.textContent!
    const recovered =
      kind === "success"
        ? { kind, sessionId }
        : { kind, result: { status: "ready", items: [], importKey: "recovered-selection" } }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json(recovered))
    vi.stubGlobal("fetch", fetcher)
    const location = { href: window.location.href, reload: vi.fn(), replace: vi.fn() }

    runInNewContext(script, {
      fetch: fetcher,
      location,
      history: window.history,
      sessionStorage,
      localStorage,
      navigator,
      URL,
      Date,
      setTimeout,
      clearTimeout,
      AbortController,
    })
    await waitFor(() => expect(location.reload).toHaveBeenCalledOnce())
    expect(location.replace).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe(path)
    expect(window.location.search).toBe("")
    expect(window.history.state.previousPage).toBe("preserved")

    const { result } = renderHook(() => useCheckoutRecovery(kind))
    await waitFor(() => expect(result.current.data).toEqual(recovered))
    const verified = JSON.parse(fetcher.mock.calls[0]![1].body) as { selector: string }
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({ kind, selector: verified.selector })
    expect(result.current.gone).toBe(false)
    const { getStoreVisitSource } = await import("@/features/analytics/get-store-visit-source")
    expect(getStoreVisitSource()).toBe("social")
    if (kind === "meta") {
      const { getOrderAttribution } = await import("@/features/attribution/get-order-attribution")
      expect(getOrderAttribution()).toMatchObject({
        source: "instagram",
        channel: "social",
        method: "meta_checkout",
        landingPath: path,
      })
    }
  })
})
