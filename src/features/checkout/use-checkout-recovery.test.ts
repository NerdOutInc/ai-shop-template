import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { checkoutRecoveryHistoryKey } from "./checkout-recovery-history-key"
import { useCheckoutRecovery } from "./use-checkout-recovery"

const selector = "a".repeat(32)
const sessionId = "cs_live_original1234567890"

beforeEach(() => {
  window.history.replaceState({ [checkoutRecoveryHistoryKey]: { kind: "success", selector } }, "", "/checkout/success")
})

afterEach(() => vi.unstubAllGlobals())

describe("checkout recovery in the current history entry", () => {
  it("recovers the exact session using a body selector without adding it to the page URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ kind: "success", sessionId })))
    vi.stubGlobal("fetch", fetcher)
    const { result } = renderHook(() => useCheckoutRecovery("success"))
    await waitFor(() => expect(result.current.data).toEqual({ kind: "success", sessionId }))
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "/api/checkout/recovery",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ kind: "success", selector }),
      })
    )
    expect(window.location.search).toBe("")
  })

  it.each([null, { kind: "meta", selector }, { kind: "success", selector: "invalid" }])(
    "treats an absent, wrong-kind, or malformed history reference as permanently gone: %j",
    (reference) => {
      window.history.replaceState({ [checkoutRecoveryHistoryKey]: reference }, "", "/checkout/success")
      const fetcher = vi.fn()
      vi.stubGlobal("fetch", fetcher)
      const { result } = renderHook(() => useCheckoutRecovery("success"))
      expect(result.current.gone).toBe(true)
      expect(result.current.error).toBe(false)
      expect(fetcher).not.toHaveBeenCalled()
    }
  )

  it("treats a missing, expired, or evicted recovery cookie as permanently gone", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    vi.stubGlobal("fetch", fetcher)
    const { result } = renderHook(() => useCheckoutRecovery("success"))
    await waitFor(() => expect(result.current.gone).toBe(true))
    expect(result.current.error).toBe(false)
    expect(result.current.data).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each(["network", "server"])("retries a transient %s failure and clears it during retry", async (failure) => {
    const fetcher = vi.fn()
    if (failure === "network") fetcher.mockRejectedValueOnce(new Error("offline"))
    else fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }))
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ kind: "success", sessionId })))
    vi.stubGlobal("fetch", fetcher)
    const { result } = renderHook(() => useCheckoutRecovery("success"))
    await waitFor(() => expect(result.current.error).toBe(true))
    expect(result.current.gone).toBe(false)
    act(() => result.current.retry())
    expect(result.current.error).toBe(false)
    await waitFor(() => expect(result.current.data).toEqual({ kind: "success", sessionId }))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("uses the history entry's distinct reference after back/forward and ignores an obsolete response", async () => {
    let finishFirst: ((value: Response) => void) | undefined
    const secondSession = "cs_live_second1234567890"
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishFirst = resolve
          })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ kind: "success", sessionId: secondSession })))
    vi.stubGlobal("fetch", fetcher)
    const { result } = renderHook(() => useCheckoutRecovery("success"))
    act(() => {
      window.history.replaceState(
        { [checkoutRecoveryHistoryKey]: { kind: "success", selector: "b".repeat(32) } },
        "",
        "/checkout/success"
      )
      window.dispatchEvent(new PopStateEvent("popstate"))
    })
    await waitFor(() => expect(result.current.data).toEqual({ kind: "success", sessionId: secondSession }))
    await act(async () => finishFirst!(new Response(JSON.stringify({ kind: "success", sessionId }))))
    expect(result.current.data).toEqual({ kind: "success", sessionId: secondSession })
    expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(true)
  })
})
