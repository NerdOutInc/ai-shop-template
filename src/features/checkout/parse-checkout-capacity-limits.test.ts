import { describe, expect, it } from "vitest"

import { parseCheckoutCapacityLimits } from "./parse-checkout-capacity-limits"

describe("checkout capacity tuning", () => {
  it("retains conservative defaults and applies partial explicit overrides", () => {
    expect(parseCheckoutCapacityLimits()).toEqual({
      ingress: { perMinute: 60, burst: 30 },
      status: { perMinute: 120, burst: 20 },
      stripeRead: { perMinute: 120, burst: 10 },
      providerRead: { perMinute: 120, burst: 20 },
    })
    expect(parseCheckoutCapacityLimits('{"ingress":{"perMinute":180},"stripeRead":{"burst":15}}')).toEqual({
      ingress: { perMinute: 180, burst: 30 },
      status: { perMinute: 120, burst: 20 },
      stripeRead: { perMinute: 120, burst: 15 },
      providerRead: { perMinute: 120, burst: 20 },
    })
  })

  it.each([
    "not JSON",
    "null",
    "[]",
    '{"unknown":{}}',
    '{"ingress":{"perMinute":"120"}}',
    '{"ingress":{"perMinute":0}}',
    '{"stripeRead":{"burst":1.5}}',
    '{"status":{"burst":60001}}',
    '{"providerRead":{"burst":19}}',
    '{"ingress":{"perMinut":120}}',
  ])("rejects invalid limits instead of silently weakening admission: %s", (value) => {
    expect(() => parseCheckoutCapacityLimits(value)).toThrow()
  })
})
