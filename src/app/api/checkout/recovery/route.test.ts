import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { checkoutRecoveryCookie } from "@/features/checkout/checkout-recovery-cookie.server"

import { POST } from "./route"

const { resolveMetaCart } = vi.hoisted(() => ({ resolveMetaCart: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/features/cart/resolve-meta-cart.server", () => ({ resolveMetaCart }))

const selector = "a".repeat(32)
const sessionId = "cs_live_original1234567890"
const productId = "b".repeat(24)

function request(body: unknown, options: { cookie?: string; origin?: string } = {}) {
  return new NextRequest("https://example.com/api/checkout/recovery", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: options.origin ?? "https://example.com",
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: JSON.stringify(body),
  })
}

function cookie(kind: "success" | "meta" = "success", createdAt = Date.now()) {
  return `${checkoutRecoveryCookie.prefix}${selector}=${checkoutRecoveryCookie.encode(kind === "success" ? { kind, sessionId, createdAt } : { kind, params: { products: `${productId}-1001:2` }, createdAt })}`
}

beforeEach(() =>
  resolveMetaCart.mockReset().mockResolvedValue({ status: "ready", items: [], importKey: "c".repeat(32) })
)

describe("checkout recovery route", () => {
  it("requires both the selector and the matching cookie", async () => {
    expect((await POST(request({ kind: "success", selector }))).status).toBe(404)
    expect((await POST(request({ kind: "success", selector: "b".repeat(32) }, { cookie: cookie() }))).status).toBe(404)
    const response = await POST(request({ kind: "success", selector }, { cookie: cookie() }))
    expect(await response.json()).toEqual({ kind: "success", sessionId })
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  })

  it("verifies storage without resolving a catalog or returning the session", async () => {
    const response = await POST(request({ kind: "success", selector, verify: true }, { cookie: cookie() }))
    expect(response.status).toBe(204)
    expect(await response.text()).toBe("")
    expect(resolveMetaCart).not.toHaveBeenCalled()
  })

  it("uses the browser Host when Next normalizes the internal URL to localhost", async () => {
    const normalized = new NextRequest("http://localhost:3200/api/checkout/recovery", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "127.0.0.1:3200",
        Origin: "http://127.0.0.1:3200",
        Cookie: cookie(),
      },
      body: JSON.stringify({ kind: "success", selector, verify: true }),
    })
    expect((await POST(normalized)).status).toBe(204)
  })

  it.each([
    { host: "127.0.0.1:3200", origin: "https://127.0.0.1:3200" },
    { host: "127.0.0.1:3200", origin: "http://localhost:3200" },
    { host: "evil.example@127.0.0.1:3200", origin: "http://127.0.0.1:3200" },
  ])("retains exact browser origin and scheme checks for $host $origin", async ({ host, origin }) => {
    const normalized = new NextRequest("http://localhost:3200/api/checkout/recovery", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: host,
        Origin: origin,
        "X-Forwarded-Host": "elsewhere.example",
        Cookie: cookie(),
      },
      body: JSON.stringify({ kind: "success", selector, verify: true }),
    })
    expect((await POST(normalized)).status).toBe(403)
  })

  it("resolves the saved selection afresh for each review and retry", async () => {
    for (let i = 0; i < 2; i++) {
      const response = await POST(request({ kind: "meta", selector }, { cookie: cookie("meta") }))
      expect(response.status).toBe(200)
    }
    expect(resolveMetaCart).toHaveBeenCalledTimes(2)
    expect(resolveMetaCart).toHaveBeenLastCalledWith({ products: `${productId}-1001:2`, coupon: undefined })
  })

  it("rejects cross-origin, expired, wrong-kind, and oversized requests", async () => {
    expect(
      (await POST(request({ kind: "success", selector }, { cookie: cookie(), origin: "https://elsewhere.example" })))
        .status
    ).toBe(403)
    expect(
      (
        await POST(
          request(
            { kind: "success", selector },
            { cookie: cookie("success", Date.now() - checkoutRecoveryCookie.lifetime("success")) }
          )
        )
      ).status
    ).toBe(404)
    expect((await POST(request({ kind: "meta", selector }, { cookie: cookie() }))).status).toBe(404)
    expect(
      (await POST(request({ kind: "success", selector, extra: "x".repeat(300) }, { cookie: cookie() }))).status
    ).toBe(400)
  })
})
