import { describe, expect, it } from "vitest"

import printifySizeGuideDescriptions from "../../../test/printify-size-guide-descriptions.json"

import type { CatalogDescriptionBlock } from "./catalog-product"
import { getGarmentDescriptionBlocks } from "./get-garment-description-blocks"
import { readProductDescription } from "./read-product-description"

const title = "Baggage Welcome - Premium T-Shirt"
const chart = '<table id="size-guide"><tr><th></th><th>M</th></tr><tr><td>Width, in</td><td>20.50</td></tr></table>'

function garmentText(description: string, productTitle = title) {
  return textOf(getGarmentDescriptionBlocks({ title: productTitle, ...readProductDescription(description) }))
}

function textOf(blocks: CatalogDescriptionBlock[]): string[] {
  return blocks.flatMap((block) =>
    block.type === "list"
      ? block.items.flatMap((item) => textOf(item).map((text) => `• ${text}`))
      : [block.content.map((part) => part.text).join("")]
  )
}

describe("getGarmentDescriptionBlocks", () => {
  it("keeps only the garment paragraph and fabric bullets from a published description", () => {
    expect(
      garmentText(
        "<p>A hermit crab has moved into a chalk bucket.</p><p><strong>The tee</strong></p><p>Printed on the Next Level 6210, a soft, lightweight crewneck.</p><ul><li><p>60% combed ring-spun cotton and 40% polyester</p></li><li><p>Tear-away label</p></li></ul><p><strong>Care</strong></p><p>Wash cold, up to 30°C / 90°F.</p>" +
          chart
      )
    ).toEqual([
      "Printed on the Next Level 6210, a soft, lightweight crewneck.",
      "• 60% combed ring-spun cotton and 40% polyester",
      "• Tear-away label",
    ])
  })

  it("follows the owner's garment names and skips a leading design section", () => {
    expect(
      garmentText(
        "<p><strong>The design</strong></p><p>Wavy lines.</p><h3>The crop top</h3><p>Printed on the Next Level 5080.</p><ul><li>Raw hems</li></ul><h3>Size guide</h3>" +
          chart
      )
    ).toEqual(["Printed on the Next Level 5080.", "• Raw hems"])
  })

  it("keeps inline emphasis inside the garment section without mistaking it for a new heading", () => {
    const blocks = getGarmentDescriptionBlocks({
      title,
      ...readProductDescription(
        "<p><strong>The tee</strong></p><p><strong>Soft</strong> and light.</p><p><strong>Care</strong></p><p>Cold.</p>"
      ),
    })
    expect(blocks).toEqual([
      {
        type: "paragraph",
        content: [
          { text: "Soft", bold: true, italic: false },
          { text: " and light.", bold: false, italic: false },
        ],
      },
    ])
  })

  it.each(["Rest Restores Mana", "Rest Restores Mana — Your Store | Next Level 6210", "rest restores  mana"])(
    "does not treat a heading repeating the product title as the garment section: %s",
    (heading) => {
      const productTitle = "Rest Restores Mana — Your Store | Next Level 6210"
      expect(garmentText(`<h2>${heading}</h2><p>Your forearms need a recharge, too.</p>`, productTitle)).toEqual([])
      expect(
        garmentText(
          `<h2>${heading}</h2><p>Your forearms need a recharge, too.</p><p><strong>The tee</strong></p><p>Garment facts.</p>`,
          productTitle
        )
      ).toEqual(["Garment facts."])
    }
  )

  it.each(printifySizeGuideDescriptions)("finds no garment section in the design-only $name description", (fixture) => {
    expect(garmentText(fixture.description, fixture.title)).toEqual([])
  })

  it.each([
    "",
    "<p><strong>The design</strong></p><p>Wavy lines.</p><p><strong>Care</strong></p><p>Wash cold.</p>",
    "<p><strong>The tee</strong></p><p><strong>Care</strong></p><p>Wash cold.</p>",
    "<p>This premium fitted short sleeve is a classic choice.</p><ul><li>60% cotton</li></ul>",
  ])("finds no garment section to show in %j", (description) => {
    expect(garmentText(description)).toEqual([])
  })

  it("finds nothing when a product has no parsed description", () => {
    expect(getGarmentDescriptionBlocks({ title })).toEqual([])
  })
})
