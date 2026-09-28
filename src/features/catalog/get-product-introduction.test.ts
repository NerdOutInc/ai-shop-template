import { describe, expect, it } from "vitest"

import printifySizeGuideDescriptions from "../../../test/printify-size-guide-descriptions.json"

import { getProductIntroduction } from "./get-product-introduction"
import { readProductDescription } from "./read-product-description"

const title = "Sample Garden Illustration — Fixture Store | Next Level 6210"

describe("getProductIntroduction", () => {
  it.each(printifySizeGuideDescriptions)(
    "uses design prose after the leading Printify $name chart",
    ({ title, description, introduction }) => {
      expect(getProductIntroduction({ title, ...readProductDescription(description) })).toBe(introduction)
    }
  )

  it("uses published design prose across inline formatting, skipping section labels", () => {
    const product = {
      title,
      ...readProductDescription(
        "<p><strong>The design</strong></p><p>A purple <strong>geometric garden</strong> brings a little color to an everyday scene. <em>Small details tell the story.</em></p><p><strong>The tee</strong></p><p>Printed on the Next Level 6210.</p>"
      ),
    }
    expect(getProductIntroduction(product)).toBe(
      "A purple geometric garden brings a little color to an everyday scene. Small details tell the story."
    )
  })

  it("keeps parsed paragraphs authoritative and does not choose a heading or garment list", () => {
    const description = readProductDescription(
      "<h2>Sample Garden Illustration</h2><ul><li>60% cotton</li></ul><p>A bright illustration for everyday adventures.</p>"
    )
    expect(getProductIntroduction({ title, ...description, description: "Stale plain text" })).toBe(
      "A bright illustration for everyday adventures."
    )
  })

  it.each(["Sample Garden Illustration", title, "sample garden  illustration"])(
    "uses the design prose after a heading repeating the product title: %s",
    (heading) => {
      const description = readProductDescription(
        `<h2>${heading}</h2><p>A bright illustration for everyday adventures.</p><p><strong>The tee</strong></p><p>Soft.</p>`
      )
      expect(getProductIntroduction({ title, ...description })).toBe("A bright illustration for everyday adventures.")
    }
  )

  it("reads provider plain-text descriptions without including a repeated product title", () => {
    expect(
      getProductIntroduction({
        title,
        description:
          "Sample Garden Illustration\n\nThe design\nA bright illustration for everyday adventures.\nThe tee\n60% cotton",
      })
    ).toBe("A bright illustration for everyday adventures.")
  })

  it.each([
    "",
    "<h2>Care</h2><p>Machine wash cold.</p>",
    "<p><strong>The tee</strong></p><p>Printed on the Next Level 6210.</p><p>60% cotton, 40% polyester.</p>",
    "<p><strong>The crop top</strong></p><p>Printed on the Next Level 5080.</p>",
    "<h3>The tank</h3><p>Printed on the District DT5300 Concert Tank.</p>",
    "<p><strong>The hoodie</strong></p><p>Printed on the Stanley/Stella Nora (SASW035).</p>",
    "<p>This premium fitted short sleeve is a classic choice.</p><p>60% cotton, 40% polyester.</p>",
  ])("uses the brand fallback when only empty or garment content is available: %s", (description) => {
    expect(getProductIntroduction({ title, ...readProductDescription(description) })).toBe(
      "An original design, made to order. Find your fit and make it yours."
    )
  })

  it("normalizes line breaks and decodes text once through the existing description reader", () => {
    expect(
      getProductIntroduction({
        title,
        ...readProductDescription("<p>Rest &amp; recharge.<br> Your next attempt awaits.</p>"),
      })
    ).toBe("Rest & recharge. Your next attempt awaits.")
  })
})
