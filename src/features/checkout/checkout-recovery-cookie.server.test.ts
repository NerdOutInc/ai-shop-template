import { describe, expect, it, vi } from "vitest"

import { checkoutRecoveryCookie } from "./checkout-recovery-cookie.server"

vi.mock("server-only", () => ({}))

const now = 1_800_000_000_000
const productId = "a".repeat(24)
const sessionId = "cs_live_original1234567890"

describe("checkout recovery cookie", () => {
  it("round-trips the exact session needed to consume its checkout snapshot", () => {
    const data = checkoutRecoveryCookie.fromUrl(
      new URL(`https://example.com/checkout/success?session_id=${sessionId}`),
      now
    )
    expect(checkoutRecoveryCookie.decode(checkoutRecoveryCookie.encode(data), now)).toEqual({
      kind: "success",
      sessionId,
      createdAt: now,
    })
  })

  it("stores a canonical selection without click identifiers, campaigns, or raw coupon values", () => {
    const data = checkoutRecoveryCookie.fromUrl(
      new URL(
        `https://example.com/checkout/meta?products=${productId}-1001:1,${productId}-1001:2&fbclid=private&utm_campaign=private`
      ),
      now
    )
    expect(data).toEqual({ kind: "meta", params: { products: `${productId}-1001:3` }, createdAt: now })
    expect(checkoutRecoveryCookie.decode(checkoutRecoveryCookie.encode(data), now)).toEqual(data)
    const coupon = checkoutRecoveryCookie.fromUrl(
      new URL(`https://example.com/checkout/meta?products=${productId}-1001:1&coupon=private-offer`),
      now
    )
    expect(coupon).toEqual({ kind: "meta", params: { coupon: "unsupported" }, createdAt: now })
    expect(JSON.stringify(coupon)).not.toContain("private")
  })

  it.each(["products=bad", `products=${productId}-1001:1&products=${productId}-1001:2`, "coupon=one&coupon=two"])(
    "preserves invalid selection rejection for %s",
    (query) => {
      const data = checkoutRecoveryCookie.fromUrl(new URL(`https://example.com/checkout/meta?${query}`), now)
      expect(data).toEqual({ kind: "meta", params: {}, createdAt: now })
      expect(checkoutRecoveryCookie.decode(checkoutRecoveryCookie.encode(data), now)).toEqual(data)
    }
  )

  it("rejects duplicate session parameters instead of choosing another order", () => {
    expect(
      checkoutRecoveryCookie.fromUrl(
        new URL(`https://example.com/checkout/success?session_id=${sessionId}&session_id=cs_live_other1234567890`),
        now
      )
    ).toEqual({ kind: "success", sessionId: null, createdAt: now })
  })

  it("keeps order status for 30 days and rejects future or malformed payloads", () => {
    const value = checkoutRecoveryCookie.encode({ kind: "success", sessionId, createdAt: now })
    expect(checkoutRecoveryCookie.lifetime("success")).toBe(30 * 24 * 60 * 60 * 1000)
    expect(checkoutRecoveryCookie.decode(value, now + 24 * 60 * 60 * 1000)).not.toBeNull()
    expect(checkoutRecoveryCookie.decode(value, now + checkoutRecoveryCookie.lifetime("success") - 1)).not.toBeNull()
    expect(checkoutRecoveryCookie.decode(value, now + checkoutRecoveryCookie.lifetime("success"))).toBeNull()
    expect(checkoutRecoveryCookie.decode(value, now - 1)).toBeNull()
    expect(checkoutRecoveryCookie.decode("corrupt", now)).toBeNull()
    expect(checkoutRecoveryCookie.decode("a".repeat(3001), now)).toBeNull()
  })

  it("expires Meta selections after 24 hours", () => {
    const value = checkoutRecoveryCookie.encode({
      kind: "meta",
      params: { products: `${productId}-1001:1` },
      createdAt: now,
    })
    expect(checkoutRecoveryCookie.lifetime("meta")).toBe(24 * 60 * 60 * 1000)
    expect(checkoutRecoveryCookie.decode(value, now + checkoutRecoveryCookie.lifetime("meta") - 1)).not.toBeNull()
    expect(checkoutRecoveryCookie.decode(value, now + checkoutRecoveryCookie.lifetime("meta"))).toBeNull()
  })
})
