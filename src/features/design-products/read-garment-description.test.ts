import { describe, expect, it } from "vitest"

import { readProductDescription } from "@/features/catalog/read-product-description"

import { readGarmentDescription } from "./read-garment-description"

const chart = "<table><tr><th></th><th>M</th></tr><tr><td>Width, in</td><td>20.50</td></tr></table>"
const markedChart = chart.replace("<table>", '<table id="size-guide">')
const details = "<p><strong>The tee</strong></p><ul><li>60% cotton</li></ul>"
const care = "<p><strong>Care</strong></p><p>Wash cold.</p>"
const oldDesign = "<p>The design</p><p>Somebody else's joke.</p>"
const sizeGuide = { sizes: ["M"], measurements: [{ label: "Width, in", values: ["20.50"] }] }
const title = "Rest Restores Mana - Premium T-Shirt"
const read = (html: string) => readGarmentDescription(html, title)

describe("readGarmentDescription", () => {
  it.each([chart, markedChart])("recovers the only chart before the garment section: %s", (table) => {
    expect(read(`${table}${oldDesign}${details}${care}`)).toEqual({
      description: `${details}${care}${table}`,
      sizeGuide,
    })
  })

  it.each([chart, markedChart])("moves a readable suffix chart after the garment and care prose: %s", (table) => {
    expect(read(`${oldDesign}${details}${table}${care}`)).toEqual({
      description: `${details}${care}${table}`,
      sizeGuide,
    })
  })

  it.each([
    [chart, chart],
    [markedChart, markedChart],
    [chart, markedChart],
    [markedChart, chart],
  ])("copies one semantically equivalent chart across mixed marker layouts", (first, repeated) => {
    const formatted = repeated.replace("<th>M</th>", "<th><span>M</span></th>").replaceAll("<tr>", "\n<tr>")
    const result = read(`${first}${oldDesign}${details}${formatted}${care}`)
    expect(result).toEqual({ description: `${details}${care}${first}`, sizeGuide })
    expect(result!.description.match(/<table\b/g)).toHaveLength(1)
    expect(readProductDescription(result!.description).description).not.toContain("Width, in")
  })

  it.each([
    [chart, chart],
    [markedChart, markedChart],
    [chart, markedChart],
    [markedChart, chart],
  ])("refuses conflicting charts anywhere rather than choosing the suffix", (leading, trailing) => {
    expect(read(`${leading.replace("20.50", "21.00")}${oldDesign}${details}${trailing}`)).toBeNull()
    expect(read(`${leading.replace("<th>M</th>", "<th>XL</th>")}${oldDesign}${details}${trailing}`)).toBeNull()
  })

  it.each(["<p><strong>Size guide</strong></p>", "<h2>Sizing:</h2>"])(
    "excludes the attached caption and old design prose: %s",
    (caption) => {
      for (const table of [chart, markedChart]) {
        expect(read(`${caption}\n${table}${oldDesign}${details}${care}`)).toEqual({
          description: `${details}${care}${table}`,
          sizeGuide,
        })
      }
    }
  )

  it.each(["leading", "trailing"])("compacts an indented %s chart without changing its facts or styles", (position) => {
    const indent = `\n${" ".repeat(3000)}`
    const compact = chart.replace("<table>", '<table style="min-width:360px;">')
    const indented = compact.replaceAll("<tr>", `${indent}<tr>`).replace("20.50", `${indent}20.50${indent}`)
    const html = position === "leading" ? `${indented}${oldDesign}${details}` : `${oldDesign}${details}${indented}`
    expect(html.length).toBeGreaterThan(10000)

    const result = read(html)
    expect(result).toEqual({ description: `${details}${compact}`, sizeGuide })
    expect(result!.description.length).toBeLessThan(10000)
  })

  it("preserves literal replacement tokens and visible inline whitespace", () => {
    const label = "Width, $& $' $` $$ in"
    const table = markedChart.replace("Width, in", () => `<span>${label}</span> <strong>visible</strong>`)
    const garment = details + "<p>Care costs $& $' $` $$.</p>"
    const result = read(`${oldDesign}${garment}${table}`)
    expect(result?.description).toBe(`${garment}${table}`)
    expect(result?.sizeGuide.measurements[0]?.label).toBe(`${label} visible`)
  })

  it("ignores hidden charts and headings when selecting visible garment facts", () => {
    const hidden = `<p>Care</p>${markedChart.replace("20.50", "99.00")}`
    const result = read(`<!--${hidden}--><template>${hidden}</template>${chart}${oldDesign}${details}`)
    expect(result).toEqual({ description: `${details}${chart}`, sizeGuide })
  })

  it("preserves unrelated tables and does not use their internal headings as the garment start", () => {
    const unrelated = "<table><tr><td><p>Care</p></td><td>Price</td></tr><tr><td>Shipping</td><td>$5</td></tr></table>"
    const result = read(`${unrelated}${oldDesign}${details}${unrelated}${chart}${care}`)
    expect(result).toEqual({ description: `${details}${unrelated}${care}${chart}`, sizeGuide })
    expect(readProductDescription(result!.description).description).toContain("Shipping $5")
    expect(result!.description).not.toContain("Somebody else's joke.")
  })

  // Published crop tops, tanks and hoodies title the section after the garment, not "The tee".
  it.each(["The crop top", "The tank", "The hoodie"])("starts a published %s section before its care", (heading) => {
    const garment = `<p><strong>${heading}</strong></p><p>Printed on the Next Level 5080.</p><ul><li><p>Raw hems</p></li></ul>`
    expect(read(`${chart}<p>Somebody else's joke.</p>${garment}${care}`)).toEqual({
      description: `${garment}${care}${chart}`,
      sizeGuide,
    })
  })

  it.each(["<h3>The anorak</h3>", "<p><b>The anorak</b></p>"])(
    "starts at an owner-named garment heading after a bold design section: %s",
    (heading) => {
      const garment = `${heading}<p>Printed on something warm.</p>`
      const design = "<p><strong>The design</strong></p><p>Somebody else's joke.</p>"
      expect(read(`${design}${garment}${care}${markedChart}`)).toEqual({
        description: `${garment}${care}${markedChart}`,
        sizeGuide,
      })
    }
  )

  it("does not start at the donor's own title, a bold list item or emphasis in the old design", () => {
    const garment = "<p><strong>The crop top</strong></p><p>Printed on the Next Level 5080.</p>"
    const design = `<h2>${title}</h2><p>Somebody else's <strong>joke</strong>.</p><ul><li><p><strong>Chalk</strong></p></li></ul>`
    const result = read(`${design}${garment}${care}${chart}`)
    expect(result).toEqual({ description: `${garment}${care}${chart}`, sizeGuide })
    expect(readGarmentDescription(`${design}${garment}${chart}`, "Another Design")?.description).toContain(
      "Somebody else's"
    )
  })

  it.each(["Rest Restores Mana", "Rest Restores Mana — Your Store | Next Level 6210", "rest restores  mana"])(
    "does not start at a heading repeating the donor's saved title: %s",
    (heading) => {
      const saved = "Rest Restores Mana — Your Store | Next Level 6210"
      expect(
        readGarmentDescription(`<h2>${heading}</h2><p>Somebody else's joke.</p>${details}${care}${chart}`, saved)
      ).toEqual({
        description: `${details}${care}${chart}`,
        sizeGuide,
      })
    }
  )

  it("still lends the chart of a donor whose only section is its care", () => {
    expect(read(`${oldDesign}${care}${chart}`)).toEqual({ description: `${care}${chart}`, sizeGuide })
  })

  it("does not replace an invalid explicit chart with a valid unmarked chart", () => {
    expect(read(`${details}<table id="size-guide"></table>${chart}`)).toBeNull()
  })

  it.each([
    ["no garment section", `${oldDesign}${chart}`],
    ["only a bold design section", `<p><strong>The design</strong></p><p>Joke.</p>${chart}`],
    ["only a sizing caption", `<p>Size guide</p>${chart}${oldDesign}`],
    ["a garment section without a chart", details],
    ["an empty marked chart", `${details}<table id="size-guide"></table>`],
    ["an incomplete marked chart beside a valid chart", `${details}${chart}<table id="size-guide"><tr><td>M</td></tr>`],
    ["an incomplete unmarked chart", `${details}${chart.replace("</table>", "")}`],
    ["an incomplete cell", `${details}${chart.replace("</th><th>M</th>", "</th><th>M")}`],
    ["a merged marked chart", `${details}${markedChart.replace("<td>20.50", '<td colspan="2">20.50')}`],
    ["a merged unmarked chart", `${details}${chart.replace("<td>20.50", '<td rowspan="2">20.50')}`],
    ["a nested marked chart", `${details}<table id="size-guide"><tr><td>${chart}</td></tr></table>`],
    ["a nested unmarked chart", `${details}<table><tr><td>${chart}</td></tr></table>`],
  ])("rejects %s without flattening or inventing measurements", (_label, html) => {
    expect(read(html)).toBeNull()
  })
})
