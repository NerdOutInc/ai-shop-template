import { render } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import { StoreStructuredData } from "./store-structured-data"

vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))
const config = vi.hoisted(() => ({
  configured: true,
  name: "Fixture Store",
  supportEmail: "support@fixture.example",
  logo: { src: "/images/store-mark.svg" },
  socialLinks: [],
  policies: { published: true },
}))
vi.mock("@/lib/store-config", () => ({ storeConfig: config }))
beforeEach(() => {
  config.configured = true
  config.policies.published = true
})

it("describes the public store identity and customer support", () => {
  const { container } = render(<StoreStructuredData />)
  const script = container.querySelector('script[type="application/ld+json"]')
  const data: unknown = JSON.parse(script?.textContent ?? "null")
  expect(data).toMatchObject({
    "@type": "OnlineStore",
    "@id": "https://store.example/#store",
    name: "Fixture Store",
    url: "https://store.example/",
    email: "support@fixture.example",
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "support@fixture.example",
    },
  })
  expect(data).not.toHaveProperty("hasMerchantReturnPolicy")
})

it("does not advertise the unconfigured template as a merchant", () => {
  config.configured = false
  const { container } = render(<StoreStructuredData />)
  expect(container.querySelector("script")).toBeNull()
})
