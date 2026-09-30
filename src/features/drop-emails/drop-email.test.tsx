// @vitest-environment node
import { render } from "react-email"
import { describe, expect, it, vi } from "vitest"

import { DropEmail } from "./drop-email"

// Deliberately unlike the template's defaults and the test fixture, so a hard-coded brand cannot pass.
vi.mock("@/lib/store-config", () => ({
  storeConfig: {
    name: "Harbor & Pine",
    tagline: "Salt air, good threads.",
    theme: {
      background: "#fffdf8",
      foreground: "#102030",
      primary: "#0b5d4b",
      primaryForeground: "#fefefe",
      secondary: "#e9f1ee",
      mutedForeground: "#4a5a55",
    },
    fonts: {
      body: '"Harbor Sans", sans-serif',
      heading: '"Harbor Serif", serif',
      label: '"Harbor Narrow", sans-serif',
    },
  },
}))

const email = (
  <DropEmail
    products={[{ id: "tee", title: "Abstract Lines - Premium T-Shirt", image: null, price: { min: 3000, max: 3000 } }]}
    designNames={["Abstract Lines"]}
    siteUrl="https://harbor.example"
    unsubscribeUrl="https://harbor.example/unsubscribe/00000000-0000-4000-8000-000000000000"
    postalAddress="PO Box 1, Portland, ME 04101"
    campaign="dotw-2026-10-05"
  />
)

describe("DropEmail", () => {
  it("wears whichever name, tagline, colors and fonts the store configures", async () => {
    const [html, text] = await Promise.all([render(email), render(email, { plainText: true })])
    expect(text).toContain("signed up to hear about new Harbor & Pine designs")
    expect(text).toContain("Harbor & Pine · PO Box 1, Portland, ME 04101")
    expect(text).toContain("Salt air, good threads.")
    for (const style of [
      "background-color:#e9f1ee",
      "background-color:#fffdf8",
      "background-color:#0b5d4b",
      "color:#fefefe",
      "color:#102030",
      "color:#4a5a55",
    ])
      expect(html).toContain(style)
    for (const font of ["Harbor Sans", "Harbor Serif", "Harbor Narrow"]) expect(html).toContain(font)
    // The template's own default palette never leaks in.
    expect(html).not.toContain("#25364d")
  })
})
