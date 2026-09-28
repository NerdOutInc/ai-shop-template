import "../../../test/configured-store"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it, vi } from "vitest"

import { storeConfig } from "@/lib/store-config"
import { calculateCartShipping } from "@/features/checkout/calculate-cart-shipping"
import { createShippingService } from "@/features/store-policies/create-shipping-service"

import ShippingPage from "./page"

vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))

it.each([
  { first: 435, additional: 200, firstText: "$4.35", additionalText: "$2.00" },
  { first: 0, additional: 0, firstText: "$0.00", additionalText: "$0.00" },
])(
  "uses checkout amounts in visible copy and structured data, including confirmed free shipping: $first",
  ({ first, additional, firstText, additionalText }) => {
    storeConfig.commerce.firstItemShippingCents = first
    storeConfig.commerce.additionalItemShippingCents = additional
    storeConfig.policies.shippingText = ["Wash with similar colors."]
    const html = renderToStaticMarkup(<ShippingPage />)
    const document = new DOMParser().parseFromString(html, "text/html")
    document.querySelectorAll("script").forEach((script) => script.remove())
    const text = document.querySelector("main")!.textContent!

    expect(text).toContain(`${firstText} for the first shirt, plus ${additionalText} for each additional shirt`)
    expect(text).toContain("all 50 US states and Washington, DC")
    expect(text).toContain("4–15 business days")
    expect(text).toContain("11–27 business days")
    expect(text).toContain("Wash with similar colors.")
    expect(text).toContain("They do not change checkout charges")
    expect(calculateCartShipping([{ quantity: 3 }])).toBe(first + 2 * additional)
    const service = createShippingService(new URL("https://store.example"))!
    expect(service.shippingConditions.every(({ shippingRate }) => shippingRate.value === first / 100)).toBe(true)
  }
)

it("does not expose draft zero rates, estimates, or structured shipping data before confirmation", () => {
  storeConfig.commerce.shippingConfirmed = false
  storeConfig.commerce.firstItemShippingCents = 0
  const html = renderToStaticMarkup(<ShippingPage />)
  expect(html).toContain("Shipping rates and delivery estimates are being confirmed")
  expect(html).not.toContain("$0.00")
  expect(html).not.toContain("ShippingService")
  expect(html).not.toContain("4–15")
})
