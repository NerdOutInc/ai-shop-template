import { describe, expect, it } from "vitest"

import { isCheckoutSessionId } from "./is-checkout-session-id"

describe("checkout session IDs", () => {
  it.each(["cs_", "cs_test_", "cs_live_"])("accepts the existing API bounds for %s", (prefix) => {
    expect(isCheckoutSessionId(`${prefix}${"a".repeat(10)}`)).toBe(true)
    expect(isCheckoutSessionId(`${prefix}${"Z9".repeat(125)}`)).toBe(true)
    expect(isCheckoutSessionId(`${prefix}${"a".repeat(9)}`)).toBe(false)
    expect(isCheckoutSessionId(`${prefix}${"a".repeat(251)}`)).toBe(false)
  })

  it.each([null, undefined, 1, {}, "", "cs_test_abcdefghij_", "cs_test_abcdefghij\n", "cs_test_abcdefghij?x=1"])(
    "rejects malformed input %s",
    (value) => expect(isCheckoutSessionId(value)).toBe(false)
  )
})
