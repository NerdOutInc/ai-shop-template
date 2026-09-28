// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

import { checkoutClientKey } from "./checkout-client-key.server"

vi.mock("server-only", () => ({}))
const secret = "capacity-test-secret-not-for-deployment"
const headers = (ip: string) => new Headers({ "x-vercel-forwarded-for": ip })

describe("checkout anonymous network identity", () => {
  it("ignores spoofable forwarding and request identity headers", () => {
    const input = headers("192.0.2.1")
    const key = checkoutClientKey(input, secret, true)
    input.set("x-forwarded-for", "198.51.100.1")
    input.set("x-real-ip", "198.51.100.2")
    input.set("cookie", "customer=another")
    expect(checkoutClientKey(input, secret, true)).toBe(key)
    expect(key).toMatch(/^[a-f0-9]{64}$/)
    expect(checkoutClientKey(headers("192.0.2.2"), secret, true)).not.toBe(key)
    expect(checkoutClientKey(input, `${secret}-rotated`, true)).not.toBe(key)
  })

  it("does not trust any client header on hosts without the Vercel trust boundary", () => {
    expect(checkoutClientKey(headers("192.0.2.1"), secret, false)).toBe(
      checkoutClientKey(headers("198.51.100.1"), secret, false)
    )
  })

  it("normalizes IPv6 spelling, groups a /64, and preserves distinct networks", () => {
    const key = checkoutClientKey(headers("2001:db8:0:1::123"), secret, true)
    expect(checkoutClientKey(headers("2001:0db8:0000:0001:0:0:0:abcd"), secret, true)).toBe(key)
    expect(checkoutClientKey(headers("2001:db8:0:2::123"), secret, true)).not.toBe(key)
    expect(checkoutClientKey(headers("::ffff:192.0.2.1"), secret, true)).toBe(
      checkoutClientKey(headers("192.0.2.1"), secret, true)
    )
  })

  it.each(["", "bad", "192.0.2.1, 198.51.100.1", "192.0.2.1:8080", "[2001:db8::1]"])(
    "fails closed for missing/ambiguous hosting identity: %s",
    (ip) => {
      expect(() => checkoutClientKey(headers(ip), secret, true)).toThrow()
    }
  )

  it("requires the shared hash secret", () => {
    expect(() => checkoutClientKey(headers("192.0.2.1"), undefined, true)).toThrow()
  })
})
