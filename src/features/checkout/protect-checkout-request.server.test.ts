import { NextRequest } from "next/server"
import { describe, expect, it, vi } from "vitest"

import { checkoutRecoveryHistoryKey } from "./checkout-recovery-history-key"
import { protectCheckoutRequest } from "./protect-checkout-request.server"

vi.mock("server-only", () => ({}))

describe("checkout document boundary", () => {
  it("intercepts encoded sensitive parameter names before the application", async () => {
    const response = protectCheckoutRequest(
      new NextRequest("https://example.com/checkout/success?%73ession_id=cs_live_browser1234567890")
    )
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
    expect(await response.text()).toContain(checkoutRecoveryHistoryKey)
  })

  it("leaves clean recovery pages to Next with no-referrer and no-store", () => {
    const response = protectCheckoutRequest(new NextRequest("https://example.com/checkout/meta"))
    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it("preserves original query recovery without another ingress loop and blocks external scripts", () => {
    const response = protectCheckoutRequest(
      new NextRequest(
        "https://example.com/checkout/success?session_id=cs_live_browser1234567890&recovery_unavailable=1"
      )
    )
    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self' 'unsafe-inline'")
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'")
  })
})
