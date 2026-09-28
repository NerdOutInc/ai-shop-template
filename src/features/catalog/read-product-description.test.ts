import { describe, expect, it } from "vitest"

import printifySizeGuideDescriptions from "../../../test/printify-size-guide-descriptions.json"

import { readProductDescription } from "./read-product-description"

const unmarkedGuide =
  "<table><tbody><tr><td></td><td>S</td><td>M</td></tr><tr><td>Width, in</td><td>19.00</td><td>20.50</td></tr></tbody></table>"

describe("readProductDescription", () => {
  it.each(printifySizeGuideDescriptions)(
    "reads the published $name size chart and keeps its design prose",
    (fixture) => {
      const result = readProductDescription(fixture.description)
      expect(result.sizeGuide).toEqual(fixture.sizeGuide)
      expect(result.description).toBe(fixture.introduction)
      expect(result.descriptionBlocks).toEqual([
        { type: "paragraph", content: [{ text: fixture.introduction, bold: false, italic: false }] },
      ])
    }
  )

  it("finds an unmarked garment chart after an unrelated table, preserving unrelated text", () => {
    const pricing = "<table><tr><td>Quantity</td><td>Price</td></tr><tr><td>1</td><td>$28</td></tr></table>"
    const result = readProductDescription(`${pricing}${unmarkedGuide}<p>Good company.</p>`)
    expect(result.sizeGuide?.sizes).toEqual(["S", "M"])
    expect(result.description).toBe("Quantity Price 1 $28 Good company.")
    expect(result.description).not.toContain("19.00")
  })

  it("prefers the explicit guide and preserves other tables", () => {
    const explicit = unmarkedGuide.replace("<table>", '<table id = "size-guide">').replace("Width, in", "Length, in")
    const result = readProductDescription(`${unmarkedGuide}${explicit}`)
    expect(result.sizeGuide?.measurements[0]?.label).toBe("Length, in")
    expect(result.description).toBe("S M Width, in 19.00 20.50")
  })

  it("accepts metric measurements and alternate apparel size spellings", () => {
    const result = readProductDescription(
      unmarkedGuide.replace("<td>S</td><td>M</td>", "<td>XXS</td><td>XXL</td>").replace("Width, in", "Width, cm")
    )
    expect(result.sizeGuide).toEqual({
      sizes: ["XXS", "XXL"],
      measurements: [{ label: "Width, cm", values: ["19.00", "20.50"] }],
    })
  })

  it("keeps explicitly marked charts compatible with other size and measurement labels", () => {
    const result = readProductDescription(
      '<table id="size-guide"><tr><th></th><th>32</th><th>34</th></tr><tr><td>Waist</td><td>32</td><td>34</td></tr></table>'
    )
    expect(result.sizeGuide).toEqual({
      sizes: ["32", "34"],
      measurements: [{ label: "Waist", values: ["32", "34"] }],
    })
  })

  it.each(["", "&nbsp;"])("preserves a blank marked-chart measurement (%s)", (blank) => {
    const result = readProductDescription(
      unmarkedGuide.replace("<table>", '<table id="size-guide">').replace("20.50", blank) + "<p>Good company.</p>"
    )
    expect(result.sizeGuide?.measurements).toEqual([{ label: "Width, in", values: ["19.00", ""] }])
    expect(result.description).toBe("Good company.")
  })

  it("preserves repeated size columns in an explicitly marked chart", () => {
    const result = readProductDescription(
      unmarkedGuide.replace("<table>", '<table id="size-guide">').replace("<td>M</td>", "<td>S</td>")
    )
    expect(result.sizeGuide).toEqual({
      sizes: ["S", "S"],
      measurements: [{ label: "Width, in", values: ["19.00", "20.50"] }],
    })
    expect(result.descriptionBlocks).toEqual([])
  })

  it.each(["", ' id="size-guide"'])("accepts one-cell spans without treating them as merged (%s)", (marker) => {
    const html = unmarkedGuide.replace("<table>", `<table${marker}>`).replaceAll("<td>", '<td colspan="1" rowspan="1">')
    expect(readProductDescription(html).sizeGuide).toEqual({
      sizes: ["S", "M"],
      measurements: [{ label: "Width, in", values: ["19.00", "20.50"] }],
    })
  })

  it.each(["Waist, in", "Hip, in", "Inseam, in", "Sleeve length from center back, in", "Body width (at chest), cm"])(
    "recognizes an unmarked measurement by its unit: %s",
    (label) => {
      const result = readProductDescription(unmarkedGuide.replace("Width, in", label))
      expect(result.sizeGuide?.measurements).toEqual([{ label, values: ["19.00", "20.50"] }])
      expect(result.description).toBe("")
    }
  )

  it.each([
    ["One size", "<td>One size</td>", "<td>19.00</td>", ["One size"], ["19.00"]],
    ["youth", "<td>YS</td><td>YM</td>", "<td>19.00</td><td>20.50</td>", ["YS", "YM"], ["19.00", "20.50"]],
    ["numeric", "<td>28</td><td>30</td>", "<td>19.00</td><td>20.50</td>", ["28", "30"], ["19.00", "20.50"]],
    ["combined", "<td>S/M</td><td>L/XL</td>", "<td>19.00</td><td>20.50</td>", ["S/M", "L/XL"], ["19.00", "20.50"]],
  ])("recognizes %s size headers without a table marker", (_label, header, cells, sizes, values) => {
    const result = readProductDescription(
      `<table><tr><td></td>${header}</tr><tr><td>Width, in</td>${cells}</tr></table>`
    )
    expect(result.sizeGuide).toEqual({ sizes, measurements: [{ label: "Width, in", values }] })
  })

  it("removes the selected top-level table rather than an identical nested copy", () => {
    const nested = `<table><tr><td><strong>${unmarkedGuide}</strong></td></tr></table>`
    const result = readProductDescription(`${nested}<p>After the nested table.</p>${unmarkedGuide}<p>Design prose.</p>`)
    expect(result.sizeGuide?.sizes).toEqual(["S", "M"])
    expect(result.descriptionBlocks).toHaveLength(3)
    const retained = result.descriptionBlocks[0]!
    expect(retained.type).toBe("paragraph")
    if (retained.type !== "paragraph") throw new Error("Expected retained nested chart text")
    expect(retained.content.every((part) => part.bold)).toBe(true)
    expect(
      retained.content
        .map((part) => part.text)
        .join("")
        .replace(/\s+/g, " ")
        .trim()
    ).toBe("S M Width, in 19.00 20.50")
    expect(result.descriptionBlocks[1]).toEqual({
      type: "paragraph",
      content: [{ text: "After the nested table.", bold: false, italic: false }],
    })
  })

  it.each(["colspan", "rowspan"])("continues rejecting a marked chart with a real %s", (attribute) => {
    const html = unmarkedGuide
      .replace("<table>", '<table id="size-guide">')
      .replace("<td>19.00", `<td ${attribute}="2">19.00`)
    expect(readProductDescription(html).sizeGuide).toBeNull()
  })

  it.each([
    ["duplicate sizes", unmarkedGuide.replace("<td>M</td>", "<td>S</td>")],
    ["missing values", unmarkedGuide.replace("<td>20.50</td>", "")],
    ["empty values", unmarkedGuide.replace("20.50", "&nbsp;")],
    ["nonnumeric values", unmarkedGuide.replace("20.50", "Unknown")],
    ["unrecognized columns", unmarkedGuide.replace("<td>S</td>", "<td>Standard</td>")],
    ["unrelated measurements", unmarkedGuide.replace("Width, in", "Price, USD")],
    ["missing units", unmarkedGuide.replace("Width, in", "Width")],
    ["tolerances without garment measurements", unmarkedGuide.replace("Width, in", "Size tolerance, in")],
    ["non-size corner", unmarkedGuide.replace("<td></td>", "<td>Shipping</td>")],
    ["merged columns", unmarkedGuide.replace("<td>19.00", '<td colspan="2">19.00')],
    ["merged rows", unmarkedGuide.replace("<td>19.00", '<td rowspan="2">19.00')],
    ["nested tables", `<table><tr><td>${unmarkedGuide}${unmarkedGuide}</td></tr></table>`],
    ["ambiguous unmarked charts", `${unmarkedGuide}${unmarkedGuide.replace("Width, in", "Length, in")}`],
    ["unfinished table", unmarkedGuide.replace("</table>", "")],
    ["unfinished cell", unmarkedGuide.replace("<td>M</td>", "<td>M</td><td>L")],
    ["unfinished row", unmarkedGuide.replace("</tbody>", "<tr><td>Length, in</td><td>28</td><td>29</td></tbody>")],
    ["duplicate explicit guides", (unmarkedGuide + unmarkedGuide).replaceAll("<table>", '<table id="size-guide">')],
    [
      "conflicting units",
      unmarkedGuide.replace("</tbody>", "<tr><td>Length, cm</td><td>48.26</td><td>52.07</td></tr></tbody>"),
    ],
  ])("retains %s as prose rather than inventing a size guide", (_label, html) => {
    const result = readProductDescription(html)
    expect(result.sizeGuide).toBeNull()
    expect(result.description).toContain("19.00")
  })

  it("does not fall back to a different chart when the explicitly marked one is invalid", () => {
    const malformed = '<table id="size-guide"><tr><td></td><td>XS</td></tr></table>'
    const result = readProductDescription(`${malformed}${unmarkedGuide}`)
    expect(result.sizeGuide).toBeNull()
    expect(result.description).toContain("XS")
    expect(result.description).toContain("19.00")
  })

  it("does not treat data attributes or quoted attribute text as an explicit marker", () => {
    for (const opening of ['<table data-id="size-guide">', "<table title=\" id='size-guide' \">"]) {
      expect(
        readProductDescription(unmarkedGuide.replace("<table>", opening).replace("Width, in", "Price")).sizeGuide
      ).toBeNull()
    }
  })

  it("ignores unmarked charts in hidden templates", () => {
    expect(readProductDescription(`<template>${unmarkedGuide}</template><p>A good tee.</p>`)).toMatchObject({
      sizeGuide: null,
      description: "A good tee.",
    })
  })

  it("extracts a size guide without passing provider HTML into storefront content", () => {
    const result = readProductDescription(
      '<table id="size-guide"><tr><th></th><th>S</th><th>M</th></tr><tr><td>Width, in</td><td>19.00</td><td>20.50</td></tr></table><p>Soft &amp; sturdy.</p><p>Wander. Snack. Repeat.</p><script>alert(1)</script>'
    )
    expect(result).toEqual({
      description: "Soft & sturdy.\nWander. Snack. Repeat.",
      descriptionBlocks: [
        { type: "paragraph", content: [{ text: "Soft & sturdy.", bold: false, italic: false }] },
        { type: "paragraph", content: [{ text: "Wander. Snack. Repeat.", bold: false, italic: false }] },
      ],
      sizeGuide: { sizes: ["S", "M"], measurements: [{ label: "Width, in", values: ["19.00", "20.50"] }] },
    })
  })

  it("keeps malformed table data as text instead of publishing a misleading size chart", () => {
    const result = readProductDescription(
      '<table id="size-guide"><tr><th></th><th>S</th><th>M</th></tr><tr><td>Width</td><td>19</td></tr></table>'
    )
    expect(result.sizeGuide).toBeNull()
    expect(result.description).toBe("S M Width 19")
  })

  it("decodes escaped prose as text and rejects invalid numeric character values", () => {
    expect(readProductDescription("<p>&lt;img onerror=oops&gt; &#x1f9d7; &#99999999;</p>").description).toBe(
      "<img onerror=oops> 🧗"
    )
  })

  it("omits unfinished scripts and non-prose containers from both text and formatted content", () => {
    const result = readProductDescription(
      "<!-- hidden --><template>Invisible</template><p>A good tee.</p><iframe>Untrusted</iframe><script>unfinished"
    )
    expect(result.description).toBe("A good tee.")
    expect(result.descriptionBlocks).toEqual([
      { type: "paragraph", content: [{ text: "A good tee.", bold: false, italic: false }] },
    ])
  })

  it("does not extract a misleading size guide from a hidden template", () => {
    const result = readProductDescription(
      '<template><table id="size-guide"><tr><th></th><th>S</th></tr><tr><td>Width</td><td>999</td></tr></table></template><p>A good tee.</p>'
    )
    expect(result.description).toBe("A good tee.")
    expect(result.sizeGuide).toBeNull()
  })
})
