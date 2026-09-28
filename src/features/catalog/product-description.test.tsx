import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import printifySizeGuideDescriptions from "../../../test/printify-size-guide-descriptions.json"

import { ProductDescription } from "./product-description"
import { readProductDescription } from "./read-product-description"

describe("ProductDescription", () => {
  it.each(printifySizeGuideDescriptions)(
    "keeps the published $name chart out of the rendered description",
    ({ description, introduction, sizeGuide }) => {
      const result = readProductDescription(description)
      const { container } = render(<ProductDescription blocks={result.descriptionBlocks} />)

      expect(container.textContent).toBe(introduction)
      expect(container.querySelector("table")).toBeNull()
      expect(result.sizeGuide).toEqual(sizeGuide)
    }
  )

  it("renders published paragraphs, bold labels, and semantic lists alongside a separately extracted size guide", () => {
    const result = readProductDescription(
      '<p><strong>The design</strong></p><p>A snack break with ambition.</p><p><strong>The tee</strong></p><ul><li>60% cotton, 40% polyester</li><li>Lightweight fabric</li></ul><ol><li>Wash cold</li><li>Dry low</li></ol><table id="size-guide"><tr><th></th><th>S</th></tr><tr><td>Width, in</td><td>19</td></tr></table>'
    )
    const { container } = render(<ProductDescription blocks={result.descriptionBlocks} />)
    expect(screen.getByText("The design").tagName).toBe("STRONG")
    expect(screen.getByText("A snack break with ambition.").tagName).toBe("P")
    expect(screen.getByText("The tee").tagName).toBe("STRONG")
    expect(screen.getAllByRole("list").map((list) => list.tagName)).toEqual(["UL", "OL"])
    expect(screen.getAllByRole("listitem")).toHaveLength(4)
    expect(container.querySelector("table")).toBeNull()
    expect(screen.queryByText("Width, in")).not.toBeInTheDocument()
    expect(result.sizeGuide).toEqual({ sizes: ["S"], measurements: [{ label: "Width, in", values: ["19"] }] })
  })

  it("never turns provider markup, event handlers, or escaped HTML into active page content", () => {
    const result = readProductDescription(
      '<p onclick="alert(1)"><strong style="position:fixed" id="checkout">Safe label</strong> <a href="javascript:alert(1)">Plain link text</a><img src=x onerror="alert(1)"></p><script>alert(2)</script><style>body{display:none}</style><svg onload="alert(3)">hidden</svg><p>&lt;img src=x onerror=alert(4)&gt;</p>'
    )
    const { container } = render(<ProductDescription blocks={result.descriptionBlocks} />)
    expect(
      container.querySelector("script, style, svg, iframe, img, a, [onclick], [onerror], [style], #checkout")
    ).toBeNull()
    expect(screen.getByText("Safe label")).toBeInTheDocument()
    expect(screen.getByText("<img src=x onerror=alert(4)>")).toBeInTheDocument()
    expect(container.textContent).not.toContain("alert(2)")
    expect(container.textContent).not.toContain("hidden")
  })
})
