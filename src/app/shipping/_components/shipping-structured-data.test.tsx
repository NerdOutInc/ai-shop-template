import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"

import { ShippingStructuredData } from "./shipping-structured-data"

vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))
const config = vi.hoisted(() => ({
  configured: true,
  name: "Fixture Store",
  supportEmail: "support@fixture.example",
  logo: { src: "/images/store-mark.svg" },
  socialLinks: [],
  policies: { published: true },
  commerce: {
    shippingConfirmed: true,
    firstItemShippingCents: 0,
    additionalItemShippingCents: 0,
    deliveryEstimates: {
      handling: { min: 2, max: 10 },
      transit: { min: 2, max: 5 },
      extendedTransit: { min: 9, max: 17 },
      extendedRegions: ["AK", "HI"],
    },
  },
}))
vi.mock("@/lib/store-config", () => ({ storeConfig: config }))
beforeEach(() => {
  config.configured = true
  config.policies.published = true
})

it("attaches the shipping-page service to the store identity in server HTML", () => {
  const html = renderToStaticMarkup(<ShippingStructuredData />)
  const document = new DOMParser().parseFromString(html, "text/html")
  const script = document.querySelector('script[type="application/ld+json"]')
  const data: unknown = JSON.parse(script?.textContent ?? "null")

  expect(data).toMatchObject({
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    "@id": "https://store.example/#store",
    url: "https://store.example/",
    hasShippingService: {
      "@type": "ShippingService",
      "@id": "https://store.example/shipping#standard-shipping",
    },
  })
})

it("does not advertise the unconfigured template as a merchant", () => {
  config.configured = false
  expect(renderToStaticMarkup(<ShippingStructuredData />)).toBe("")
})

it("does not publish an unapproved policy", () => {
  config.policies.published = false
  expect(renderToStaticMarkup(<ShippingStructuredData />)).toBe("")
})
