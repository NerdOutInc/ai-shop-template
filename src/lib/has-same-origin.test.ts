import { expect, it } from "vitest"

import { hasSameOrigin } from "./has-same-origin"

const siteUrl = new URL("https://store.example")

it.each([undefined, "null", "https://attacker.example", "https://store.example.attacker.example"])(
  "rejects a cookie mutation from origin %s",
  (origin) => {
    expect(
      hasSameOrigin(
        new Request("https://store.example/api/admin/favorites", { headers: origin ? { origin } : {} }),
        siteUrl
      )
    ).toBe(false)
  }
)

it("permits the site's own browser mutation", () => {
  expect(
    hasSameOrigin(
      new Request("https://store.example/api/admin/favorites", { headers: { origin: "https://store.example" } }),
      siteUrl
    )
  ).toBe(true)
})

it("uses the configured public origin behind a TLS proxy", () => {
  expect(
    hasSameOrigin(
      new Request("http://0.0.0.0:3000/api/admin/favorites", { headers: { origin: siteUrl.origin } }),
      siteUrl
    )
  ).toBe(true)
  expect(
    hasSameOrigin(
      new Request("http://0.0.0.0:3000/api/admin/favorites", {
        headers: { origin: "https://evil.example", "x-forwarded-host": "evil.example" },
      }),
      siteUrl
    )
  ).toBe(false)
})

it("permits only the explicitly configured preview deployment", () => {
  const request = new Request("http://0.0.0.0:3000/api/admin/favorites", {
    headers: { origin: "https://preview.vercel.app" },
  })
  expect(hasSameOrigin(request, siteUrl)).toBe(false)
  expect(hasSameOrigin(request, siteUrl, new URL("https://preview.vercel.app"))).toBe(true)
})
