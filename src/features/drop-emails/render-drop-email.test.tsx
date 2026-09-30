// @vitest-environment node
import { describe, expect, it } from "vitest"

import type { DropEmailProduct } from "./drop-email-product"
import { renderDropEmail } from "./render-drop-email"

const products: DropEmailProduct[] = [
  {
    id: "0a1b2c3d4e5f60718293a4b5",
    title: "Abstract Lines - Premium T-Shirt",
    image: {
      src: "https://example.public.blob.vercel-storage.com/published-mockups/v1/abstract-lines.jpg",
      alt: "Abstract Lines tee",
    },
    price: { min: 3000, max: 3400 },
  },
  {
    id: "5b4a3c2d1e0f98877665a4b3",
    title: "Abstract Lines - Festival Crop Top",
    image: null,
    price: { min: 3200, max: 3200 },
  },
]
const render = (liveAt = "2026-10-05T09:00:00.000Z") =>
  renderDropEmail({
    liveAt,
    products,
    siteUrl: "https://store.example",
    postalAddress: "PO Box 123, Austin, TX 78701",
    unsubscribeUrl: "https://store.example/unsubscribe/5f0b2c4e-8a51-4d8e-9a57-2c1f7f3b9d10",
  })

describe("renderDropEmail", () => {
  it("announces the design once, with each garment linked for the store's own attribution", async () => {
    const { subject, html } = await render()
    expect(subject).toBe("New this week: Abstract Lines")
    expect(html).toContain("Abstract Lines just dropped. Come take a look.")
    expect(html).toContain("Abstract Lines - Premium T-Shirt")
    expect(html).toContain("From $30.00")
    expect(html).toContain("$32.00")
    // The day is the drop's Central date, so a late-evening UTC render cannot shift the label.
    expect(html).toContain(
      "https://store.example/shop/0a1b2c3d4e5f60718293a4b5?utm_source=drop-email&amp;utm_medium=email&amp;utm_campaign=dotw-2026-10-05"
    )
    expect(html).toContain('href="https://store.example/privacy"')
  })

  // 3 AM UTC on October 5 is still Sunday evening in Chicago, the fixture store's zone.
  it("labels the campaign with the drop's date in the store's own time zone", async () => {
    const { html } = await render("2026-10-05T03:00:00.000Z")
    expect(html).toContain("utm_campaign=dotw-2026-10-04")
    expect(html).not.toContain("dotw-2026-10-05")
  })

  it("carries the legal footer and no tracking pixel", async () => {
    const { html, text } = await render()
    for (const body of [html, text]) {
      expect(body).toContain("https://store.example/unsubscribe/5f0b2c4e-8a51-4d8e-9a57-2c1f7f3b9d10")
      expect(body).toContain("PO Box 123, Austin, TX 78701")
      expect(body).toContain("all this list ever sends")
    }
    // One image per product that has one: nothing invisible that reports an open.
    expect(html.match(/<img\b/g)).toHaveLength(1)
    expect(html).toContain('alt="Abstract Lines tee"')
  })

  // Unit tests build the fixture brand, so these values come from test/store-config.ts.
  it("wears the store's own name, tagline and theme", async () => {
    const { html, text } = await render()
    expect(text).toContain("Fixture Store · PO Box 123, Austin, TX 78701")
    expect(text).toContain("Wear your Friday feeling.")
    expect(text).toContain("signed up to hear about new Fixture Store designs")
    expect(html).toMatch(/background-color:#25364d/)
    expect(html).toMatch(/color:#ffffff/)
  })

  it("reads as plain text for mail apps that never show HTML, each product linked once", async () => {
    const { text } = await render()
    // Plain text has no type sizes, so headings come out in capitals.
    expect(text).toContain("THIS WEEK’S PICKS.")
    expect(text).toContain("ABSTRACT LINES - FESTIVAL CROP TOP https://store.example/shop/5b4a3c2d1e0f98877665a4b3?")
    expect(text).toContain("From $30.00")
    expect(text.match(/shop\/0a1b2c3d4e5f60718293a4b5/g)).toHaveLength(1)
    expect(text).not.toContain("<")
    expect(text).not.toContain("abstract-lines.jpg")
  })
})
