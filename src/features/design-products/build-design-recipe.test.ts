import { expect, it } from "vitest"

import { getGarmentDescriptionBlocks } from "@/features/catalog/get-garment-description-blocks"
import { readProductDescription } from "@/features/catalog/read-product-description"

import type { DesignCatalogVariant } from "./design-draft-types"
import type { PublishedProductRecipe } from "./list-published-product-recipes.server"

import { buildDesignRecipe } from "./build-design-recipe"

const garment =
  '<p><strong>The tee</strong></p><ul><li>60% cotton</li></ul><table id="size-guide"><tr><th></th><th>M</th></tr><tr><td>Width, in</td><td>20.50</td></tr></table>'
const model: PublishedProductRecipe = {
  blueprintId: 1317,
  printProviderId: 99,
  productIds: ["a"],
  titles: ["Rest Restores Mana"],
  // The published tee is navy only; the design below asks for other colours.
  variants: [
    { id: 11, price: 2800, color: "CVC Midnight Navy", size: "M" },
    { id: 12, price: 2800, color: "CVC Midnight Navy", size: "L" },
    { id: 13, price: 3200, color: "CVC Midnight Navy", size: "2XL" },
  ],
  placement: { position: "front", x: 0.5, y: 0.4, scale: 0.63, angle: 0 },
  placementDonorProductId: "a",
  placementDonorTitle: "Rest Restores Mana",
  sizeGuideDonor: {
    productId: "a",
    title: "Rest Restores Mana",
    description: `<p><strong>The design</strong></p><p>Somebody else's joke.</p>${garment}`,
    sizes: ["M"],
  },
  unverified: ["variants[].price"],
  blocked: [],
}
const catalog: DesignCatalogVariant[] = [
  { id: 101, color: "CVC Black", size: "M", available: true },
  { id: 102, color: "CVC Black", size: "L", available: true },
  { id: 103, color: "CVC Black", size: "2XL", available: false },
  { id: 201, color: "Heather Maroon", size: "M", available: true },
  { id: 301, color: "CVC Cream", size: "M", available: false },
]
const design = {
  summary: "Beta & a very <optimistic> foothold.",
  colors: [
    { name: "Heather Maroon", position: 1 },
    { name: "CVC Black", position: 0 },
  ],
}
const build = (overrides: Partial<Parameters<typeof buildDesignRecipe>[0]> = {}) =>
  buildDesignRecipe({ model, modelLabel: "Next Level 6210", catalog, design, ...overrides })

it("offers the design's own colours, in saved order, at the shop's per-size prices", () => {
  const { recipe, colors, sizes, blockers } = build()
  expect(blockers).toEqual([])
  expect(colors).toEqual(["CVC Black", "Heather Maroon"])
  expect(recipe?.variants).toEqual([
    { id: 101, price: 2800, color: "CVC Black", size: "M" },
    { id: 102, price: 2800, color: "CVC Black", size: "L" },
    { id: 201, price: 2800, color: "Heather Maroon", size: "M" },
  ])
  // No navy: the published tee lends its sizes, prices and placement, never its colours.
  expect(recipe?.variants.some((variant) => variant.color === "CVC Midnight Navy")).toBe(false)
  expect(recipe).toMatchObject({ blueprintId: 1317, printProviderId: 99, titleTemplate: "{title}" })
  expect(recipe?.placement).toEqual(model.placement)
  // 2XL was published but no assigned colour can be made in it, so it is not promised.
  expect(sizes).toEqual([
    { size: "M", price: 2800 },
    { size: "L", price: 2800 },
  ])
})

it("names every garment it leaves out, whether unavailable or unlisted", () => {
  expect(build().skipped).toEqual([
    { color: "CVC Black", size: "2XL", reason: "Printify cannot make it right now" },
    { color: "Heather Maroon", size: "L", reason: "Printify does not list it" },
    { color: "Heather Maroon", size: "2XL", reason: "Printify does not list it" },
  ])
})

it("reports a colour with nothing available once, not size by size", () => {
  const result = build({ design: { ...design, colors: [...design.colors, { name: "CVC Cream", position: 2 }] } })
  expect(result.colors).not.toContain("CVC Cream")
  expect(result.skipped.filter(({ color }) => color === "CVC Cream")).toEqual([
    { color: "CVC Cream", size: null, reason: "No size of this color is available" },
  ])
})

it("writes only the design's paragraph and copies the garment sections untouched", () => {
  expect(build().recipe?.description).toBe(
    `<p><strong>The design</strong></p><p>Beta &amp; a very &lt;optimistic&gt; foothold.</p>${garment}`
  )
})

// Crop tops title their garment section "The crop top", so a copy that looked only for "The tee"
// started at Care and left the draft's "The garment" empty on the product page.
it("copies a crop top's garment paragraph and fabric list along with its care and chart", () => {
  const table = '<table id="size-guide"><tr><th></th><th>M</th></tr><tr><td>Width, in</td><td>20.50</td></tr></table>'
  const details =
    "<p><strong>The crop top</strong></p><p>Printed on the Next Level 5080, a soft, lightweight crop top.</p><ul><li><p>65% polyester and 35% combed ring-spun cotton</p></li><li><p>Raw sleeve and bottom hems</p></li></ul><p><strong>Care</strong></p><p>Wash cold.</p>"
  const donorTitle = "Rubber Duck Beta - Festival Crop Top"
  const description = `<h2>${donorTitle}</h2><p>Somebody else's joke.</p>${details}${table}`
  const result = build({
    model: {
      ...model,
      blueprintId: 1312,
      sizeGuideDonor: { ...model.sizeGuideDonor!, title: donorTitle, description },
    },
  })

  expect(result.blockers).toEqual([])
  expect(result.recipe?.description).toBe(
    `<p><strong>The design</strong></p><p>Beta &amp; a very &lt;optimistic&gt; foothold.</p>${details}${table}`
  )
  const draft = readProductDescription(result.recipe!.description)
  expect(getGarmentDescriptionBlocks({ title: "Beta Crop Top", ...draft })).toEqual([
    {
      type: "paragraph",
      content: [{ text: "Printed on the Next Level 5080, a soft, lightweight crop top.", bold: false, italic: false }],
    },
    {
      type: "list",
      ordered: false,
      items: [
        [
          {
            type: "paragraph",
            content: [{ text: "65% polyester and 35% combed ring-spun cotton", bold: false, italic: false }],
          },
        ],
        [{ type: "paragraph", content: [{ text: "Raw sleeve and bottom hems", bold: false, italic: false }] }],
      ],
    },
  ])
})

it.each([false, true])("shows the placement donor and uncertainty even when the proposal is blocked: %s", (blocked) => {
  const source = { ...model, blocked: blocked ? ["Needs review"] : [], unverified: ["variants[].price", "placement"] }
  const result = build({ model: source })

  expect(result.placementDonor).toEqual({
    productId: "a",
    title: "Rest Restores Mana",
    placement: model.placement,
  })
  expect(result.unverified).toEqual(source.unverified)
  expect(result.unverified).not.toBe(source.unverified)
  expect(result.recipe === null).toBe(blocked)
})

it("reports no donor when the model or its placement reference is unavailable", () => {
  expect(build({ model: null })).toMatchObject({ placementDonor: null, unverified: [] })
  expect(
    build({ model: { ...model, placementDonorProductId: null, placementDonorTitle: null } }).placementDonor
  ).toBeNull()
})

it("preserves a leading provider size chart without copying the previous design's paragraph", () => {
  const table = '<table id="size-guide"><tr><th></th><th>M</th></tr><tr><td>Width, in</td><td>20.50</td></tr></table>'
  const details = "<p><strong>The tee</strong></p><p>60% cotton.</p><p><strong>Care</strong></p><p>Wash cold.</p>"
  const description = `${table}<p>Somebody else's joke.</p>${details}`
  const result = build({ model: { ...model, sizeGuideDonor: { ...model.sizeGuideDonor!, description } } })

  expect(result.blockers).toEqual([])
  expect(result.recipe?.description).toBe(
    `<p><strong>The design</strong></p><p>Beta &amp; a very &lt;optimistic&gt; foothold.</p>${details}${table}`
  )
})

it.each(["leading", "trailing"])("compacts a %s indented size chart so it fits the draft limit", (position) => {
  const indent = `\n${" ".repeat(2500)}`
  const table = `<table id="size-guide" style="min-width:360px;">${indent}<tr><th></th><th>M</th></tr>${indent}<tr><td> Width, in </td><td>${indent}20.50${indent}</td></tr>${indent}</table>`
  const details = "<p><strong>The tee</strong></p><p>Soft.</p>"
  const description =
    position === "leading"
      ? `${table}<p>Somebody else's joke.</p>${details}`
      : `<p>Somebody else's joke.</p>${details}${table}`
  expect(description.length).toBeGreaterThan(10000)

  const result = build({ model: { ...model, sizeGuideDonor: { ...model.sizeGuideDonor!, description } } })

  expect(result.blockers).toEqual([])
  expect(result.recipe?.description).toContain(
    '<table id="size-guide" style="min-width:360px;"><tr><th></th><th>M</th></tr><tr><td>Width, in</td><td>20.50</td></tr></table>'
  )
  expect(result.recipe?.description.length).toBeLessThan(10000)
  expect(result.recipe?.description).not.toContain("Somebody else's joke.")
})

it("copies dollar replacement tokens literally in trailing table cells and garment text", () => {
  const label = "Width, $& $' $` $$ in"
  const detailText = "Wash cold, $& $' $` $$ unchanged."
  const table = `<table id="size-guide"><tr><th></th><th>M</th></tr><tr><td>${label}</td><td>20.50</td></tr></table>`
  const details = `<p><strong>The tee</strong></p><p>${detailText}</p>`
  const description = `<p>Somebody else's joke.</p>${details}${table}`
  const result = build({ model: { ...model, sizeGuideDonor: { ...model.sizeGuideDonor!, description } } })

  expect(result.recipe?.description).toBe(
    `<p><strong>The design</strong></p><p>Beta &amp; a very &lt;optimistic&gt; foothold.</p>${details}${table}`
  )
  expect(readProductDescription(result.recipe!.description).sizeGuide?.measurements[0]?.label).toBe(label)
})

it.each(["<p><strong>Size guide</strong></p>", "<h2>Sizing:</h2>"])(
  "does not mistake the leading chart caption %s for the garment section",
  (caption) => {
    const table = '<table id="size-guide"><tr><th></th><th>M</th></tr><tr><td>Width, in</td><td>20.50</td></tr></table>'
    const details = "<p><strong>The tee</strong></p><p>Soft.</p><p><strong>Care</strong></p><p>Wash cold.</p>"
    const description = `${caption}\n${table}<p>Somebody else's joke.</p>${details}`
    const result = build({ model: { ...model, sizeGuideDonor: { ...model.sizeGuideDonor!, description } } })

    expect(result.recipe?.description).toBe(
      `<p><strong>The design</strong></p><p>Beta &amp; a very &lt;optimistic&gt; foothold.</p>${details}${table}`
    )
    expect(readProductDescription(result.recipe!.description).description).not.toContain("Somebody else's joke.")
  }
)

it("copies one chart when equivalent leading and trailing tables use different formatting", () => {
  const table =
    '<table id="size-guide" style="min-width:360px;"><tr><th></th><th>M</th></tr><tr><td>Width, in</td><td>20.50</td></tr></table>'
  const repeated =
    '<table id="size-guide">\n<tr><th></th><th><span>M</span></th></tr>\n<tr><td>Width, in</td><td>20.50</td></tr>\n</table>'
  const details = "<p><strong>The tee</strong></p><p>Soft.</p>"
  const description = `<p>Size guide</p>${table}<p>Somebody else's joke.</p>${details}<h2>Sizing</h2>${repeated}`
  const result = build({ model: { ...model, sizeGuideDonor: { ...model.sizeGuideDonor!, description } } })

  expect(result.recipe?.description).toBe(
    `<p><strong>The design</strong></p><p>Beta &amp; a very &lt;optimistic&gt; foothold.</p>${details}${table}`
  )
  expect(result.recipe!.description.match(/<table\b/g)).toHaveLength(1)
  const read = readProductDescription(result.recipe!.description)
  expect(read.sizeGuide).toEqual(readProductDescription(table).sizeGuide)
  expect(read.description).not.toContain("Width, in")
  expect(read.description).not.toContain("Somebody else's joke.")
})

it("copies visible garment facts rather than a chart inside non-rendered provider HTML", () => {
  const table = '<table id="size-guide"><tr><th></th><th>M</th></tr><tr><td>Width, in</td><td>20.50</td></tr></table>'
  const hidden = table.replace("20.50", "99.00")
  const details = "<p><strong>The tee</strong></p><p>Soft.</p>"
  const description = `<!--${hidden}--><template><p>Care</p>${hidden}</template>${table}<p>Somebody else's joke.</p>${details}`
  const result = build({ model: { ...model, sizeGuideDonor: { ...model.sizeGuideDonor!, description } } })

  expect(result.blockers).toEqual([])
  expect(readProductDescription(result.recipe!.description).sizeGuide).toEqual(
    readProductDescription(description).sizeGuide
  )
  expect(result.recipe!.description).not.toContain("99.00")
  expect(result.recipe!.description).not.toContain("Somebody else's joke.")
})

it.each([
  '<table id="size-guide"><tr><th></th><th>M</th></tr><tr><td>Width, in</td><td>21.00</td></tr></table>',
  '<table id="size-guide"><tr><th></th><th>XL</th></tr><tr><td>Width, in</td><td>20.50</td></tr></table>',
  '<table id="size-guide"><tr><th>M</th></tr></table>',
  '<table id="size-guide"><tr><th>M</th></tr>',
])("refuses conflicting or unreadable duplicate charts: %s", (repeated) => {
  const table = '<table id="size-guide"><tr><th></th><th>M</th></tr><tr><td>Width, in</td><td>20.50</td></tr></table>'
  const description = `${table}<p>Somebody else's joke.</p><p><strong>The tee</strong></p><p>Soft.</p>${repeated}`
  const result = build({ model: { ...model, sizeGuideDonor: { ...model.sizeGuideDonor!, description } } })

  expect(result.recipe).toBeNull()
  expect(result.blockers.join(" ")).toContain("no garment section with a size guide")
})

it("refuses a chart and sizing caption when no garment section follows the old design", () => {
  const description =
    '<p>Size guide</p><table id="size-guide"><tr><th></th><th>M</th></tr><tr><td>Width, in</td><td>20.50</td></tr></table><p>Somebody else\'s joke.</p>'
  const result = build({ model: { ...model, sizeGuideDonor: { ...model.sizeGuideDonor!, description } } })

  expect(result.recipe).toBeNull()
  expect(result.blockers.join(" ")).toContain("no garment section with a size guide")
})

it("preserves visible spaces between inline elements inside size-chart cells", () => {
  const table =
    '<table id="size-guide">\n <tr><th></th><th>M</th></tr>\n <tr><td><span>Width,</span> <span>in</span></td><td><strong>20.50</strong> <span>in</span></td></tr>\n </table>'
  const description = `${table}<p>Somebody else's joke.</p><p><strong>The tee</strong></p><p>Soft.</p>`
  const result = build({ model: { ...model, sizeGuideDonor: { ...model.sizeGuideDonor!, description } } })

  expect(result.recipe?.description).toContain("<td><span>Width,</span> <span>in</span></td>")
  expect(result.recipe?.description).toContain("<td><strong>20.50</strong> <span>in</span></td>")
})

it.each([
  ["no published tee of the model", { model: null }, "Publish one Next Level 6210 tee first"],
  ["a model the shop's own recipe blocks", { model: { ...model, blocked: ["Placement disagrees"] } }, "Placement"],
  ["a design with no colours", { design: { ...design, colors: [] } }, "Assign this design's garment colors"],
  ["a design with no summary", { design: { ...design, summary: "  " } }, "no summary"],
  [
    "one size published at two prices",
    { model: { ...model, variants: [...model.variants, { id: 14, price: 2900, color: "CVC Red", size: "M" }] } },
    "published M is sold at more than one price",
  ],
  [
    "a description with no garment section",
    { model: { ...model, sizeGuideDonor: { ...model.sizeGuideDonor!, description: "<p>Just a joke.</p>" } } },
    "no garment section with a size guide",
  ],
  [
    "a garment section that lost its size guide",
    {
      model: {
        ...model,
        sizeGuideDonor: { ...model.sizeGuideDonor!, description: "<p><strong>The tee</strong></p><p>Soft.</p>" },
      },
    },
    "no garment section with a size guide",
  ],
  [
    "a garment section with an empty marked size guide",
    {
      model: {
        ...model,
        sizeGuideDonor: {
          ...model.sizeGuideDonor!,
          description: '<p><strong>The tee</strong></p><table id="size-guide"></table>',
        },
      },
    },
    "no garment section with a size guide",
  ],
  ["no assigned colour being available", { catalog: [] }, "None of this design's colors is available"],
])("refuses rather than guesses with %s", (_case, overrides, reason) => {
  const result = build(overrides)
  expect(result.recipe).toBeNull()
  expect(result.blockers.join(" ")).toContain(reason)
})
