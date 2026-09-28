import { beforeEach, describe, expect, it, vi } from "vitest"

import { CheckoutError } from "@/features/checkout/checkout-error"
import { createCheckout } from "@/features/checkout/create-checkout.server"
import { getCommerceServices } from "@/features/checkout/get-commerce-services.server"

import { POST } from "./route"

vi.mock("server-only", () => ({}))
vi.mock("@/features/checkout/create-checkout.server", () => ({ createCheckout: vi.fn() }))
vi.mock("@/features/checkout/get-commerce-services.server", () => ({ getCommerceServices: vi.fn() }))

const capacity = { admit: vi.fn() }
const origin = "https://shop.example.com"
const body = {
  items: [{ productId: "111111000000000000000002", variantId: 101, quantity: 1, expectedUnitAmount: 3000 }],
  requestId: "dff5c7c9-3637-4d90-95c4-1eed416f24bd",
  expectedShippingAmount: 495,
}
const address = {
  firstName: "Robin",
  lastName: "Sample",
  email: "robin@example.com",
  phone: "+16125550101",
  country: "US",
  region: "MN",
  city: "Minneapolis",
  address1: "123 Test Street",
  address2: "",
  zip: "55401",
}

function request(data: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/checkout`, {
    method: "POST",
    headers: { origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
}

describe("checkout session route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capacity.admit.mockReset().mockResolvedValue(undefined)
    vi.mocked(getCommerceServices).mockReturnValue({ siteUrl: origin, capacity } as unknown as ReturnType<
      typeof getCommerceServices
    >)
    vi.mocked(createCheckout).mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay/test",
      sessionId: "cs_test_123",
    })
  })

  it("accepts an address-free checkout and keeps its response private", async () => {
    const response = await POST(request(body))
    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(createCheckout).toHaveBeenCalledWith({ siteUrl: origin, capacity }, body)
  })

  it("drops invalid marketing metadata while preserving the payment request", async () => {
    const response = await POST(request({ ...body, attribution: { source: "person@example.com" } }))
    expect(response.status).toBe(200)
    expect(createCheckout).toHaveBeenCalledWith({ siteUrl: origin, capacity }, { ...body, attribution: undefined })
  })

  it("does not persist submitted attribution when the request carries Global Privacy Control", async () => {
    const input = request({
      ...body,
      attribution: {
        version: 1,
        capturedAt: new Date().toISOString(),
        channel: "social",
        source: "instagram",
        referrerHost: "instagram.com",
        utmSource: "instagram",
        utmMedium: "social",
        utmCampaign: "autumn_drop",
        landingPath: "/shop",
        method: "campaign",
      },
    })
    input.headers.set("sec-gpc", "1")
    expect((await POST(input)).status).toBe(200)
    expect(createCheckout).toHaveBeenCalledWith({ siteUrl: origin, capacity }, body)
  })

  it.each([
    { ...body, shippingAddress: { country: "US" } },
    { ...body, total: 1 },
    { ...body, shippingAddress: { ...address, country: "CA" } },
  ])("rejects client-supplied addresses and payment overrides without dropping fields", async (invalid) => {
    expect((await POST(request(invalid))).status).toBe(400)
    expect(createCheckout).not.toHaveBeenCalled()
  })

  it("stops rejected capacity before creating checkout and includes retry guidance", async () => {
    capacity.admit.mockRejectedValue(new CheckoutError("CHECKOUT_RATE_LIMITED", "Try later", 429))
    const response = await POST(request(body))
    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("60")
    expect(createCheckout).not.toHaveBeenCalled()
  })

  it("fails closed on limiter storage failure without exposing database details", async () => {
    capacity.admit.mockRejectedValue(new Error("private database detail"))
    const response = await POST(request(body))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain("private database detail")
    expect(createCheckout).not.toHaveBeenCalled()
  })

  it("rejects a checkout request from another origin", async () => {
    expect((await POST(request(body, "https://elsewhere.example"))).status).toBe(403)
    expect(createCheckout).not.toHaveBeenCalled()
  })
})
