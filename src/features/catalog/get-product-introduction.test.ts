import { describe, expect, it } from "vitest"

import printifySizeGuideDescriptions from "../../../test/printify-size-guide-descriptions.json"

import { getProductIntroduction } from "./get-product-introduction"
import { readProductDescription } from "./read-product-description"

const title = "Rest Restores Mana — Fixture Store | Next Level 6210"

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
        "<p><strong>The design</strong></p><p>A purple <strong>pixel-art chalk bag</strong> brings a little RPG logic to the climbing gym. <em>Rest is part of the quest.</em></p><p><strong>The tee</strong></p><p>Printed on the Next Level 6210.</p>"
      ),
    }
    expect(getProductIntroduction(product)).toBe(
      "A purple pixel-art chalk bag brings a little RPG logic to the climbing gym. Rest is part of the quest."
    )
  })

  it("keeps parsed paragraphs authoritative and does not choose a heading or garment list", () => {
    const description = readProductDescription(
      "<h2>Rest Restores Mana</h2><ul><li>60% cotton</li></ul><p>Your forearms need a recharge, too.</p>"
    )
    expect(getProductIntroduction({ title, ...description, description: "Stale plain text" })).toBe(
      "Your forearms need a recharge, too."
    )
  })

  it.each(["Rest Restores Mana", title, "rest restores  mana"])(
    "uses the design prose after a heading repeating the product title: %s",
    (heading) => {
      const description = readProductDescription(
        `<h2>${heading}</h2><p>Your forearms need a recharge, too.</p><p><strong>The tee</strong></p><p>Soft.</p>`
      )
      expect(getProductIntroduction({ title, ...description })).toBe("Your forearms need a recharge, too.")
    }
  )

  it("reads provider plain-text descriptions without including a repeated product title", () => {
    expect(
      getProductIntroduction({
        title,
        description: "Rest Restores Mana\n\nThe design\nYour forearms need a recharge, too.\nThe tee\n60% cotton",
      })
    ).toBe("Your forearms need a recharge, too.")
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
