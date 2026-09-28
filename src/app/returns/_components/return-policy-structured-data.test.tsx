import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"

import { ReturnPolicyStructuredData } from "./return-policy-structured-data"

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

it("attaches the link-only returns-page policy to the store identity in server HTML", () => {
  const html = renderToStaticMarkup(<ReturnPolicyStructuredData />)
  const document = new DOMParser().parseFromString(html, "text/html")
  const script = document.querySelector('script[type="application/ld+json"]')
  const data = JSON.parse(script?.textContent ?? "null")

  expect(data).toMatchObject({
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    "@id": "https://store.example/#store",
    url: "https://store.example/",
  })
  expect(data).toHaveProperty("hasMerchantReturnPolicy", {
    "@type": "MerchantReturnPolicy",
    "@id": "https://store.example/returns#return-policy",
    merchantReturnLink: "https://store.example/returns",
  })
})

it("does not advertise the unconfigured template as a merchant", () => {
  config.configured = false
  expect(renderToStaticMarkup(<ReturnPolicyStructuredData />)).toBe("")
})

it("does not publish an unapproved policy", () => {
  config.policies.published = false
  expect(renderToStaticMarkup(<ReturnPolicyStructuredData />)).toBe("")
})
