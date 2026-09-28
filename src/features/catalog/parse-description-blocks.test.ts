import { describe, expect, it } from "vitest"

import { parseDescriptionBlocks } from "./parse-description-blocks"

describe("parseDescriptionBlocks", () => {
  it("retains separate lines from descriptions written as plain text", () => {
    expect(parseDescriptionBlocks("Soft fabric.\n\nGood company.")).toEqual([
      { type: "paragraph", content: [{ text: "Soft fabric.", bold: false, italic: false }] },
      { type: "paragraph", content: [{ text: "Good company.", bold: false, italic: false }] },
    ])
  })

  it("preserves paragraph breaks, inline emphasis, and a line break without splitting words around inline tags", () => {
    expect(
      parseDescriptionBlocks(
        "<p>Soft <strong>cotton</strong>, good <em>company</em>.<br>Carry on.</p><p>Rest, too.</p>"
      )
    ).toEqual([
      {
        type: "paragraph",
        content: [
          { text: "Soft ", bold: false, italic: false },
          { text: "cotton", bold: true, italic: false },
          { text: ", good ", bold: false, italic: false },
          { text: "company", bold: false, italic: true },
          { text: ".\nCarry on.", bold: false, italic: false },
        ],
      },
      { type: "paragraph", content: [{ text: "Rest, too.", bold: false, italic: false }] },
    ])
  })

  it("retains ordered and unordered lists, including nested lists and missing li closing tags", () => {
    expect(
      parseDescriptionBlocks("<ul><li>Soft fabric<ol><li>Wash cold<li>Tumble dry low</ol><li>Tear-away label</ul>")
    ).toEqual([
      {
        type: "list",
        ordered: false,
        items: [
          [
            { type: "paragraph", content: [{ text: "Soft fabric", bold: false, italic: false }] },
            {
              type: "list",
              ordered: true,
              items: [
                [{ type: "paragraph", content: [{ text: "Wash cold", bold: false, italic: false }] }],
                [{ type: "paragraph", content: [{ text: "Tumble dry low", bold: false, italic: false }] }],
              ],
            },
          ],
          [{ type: "paragraph", content: [{ text: "Tear-away label", bold: false, italic: false }] }],
        ],
      },
    ])
  })

  it("keeps heading text and nested emphasis while discarding provider attributes and link targets", () => {
    expect(
      parseDescriptionBlocks(
        '<h4 id="other-page" style="position:fixed">The tee</h4><p><b onclick="bad()"><i>Soft</i></b> <a href="javascript:bad()">fabric</a></p>'
      )
    ).toEqual([
      { type: "heading", content: [{ text: "The tee", bold: false, italic: false }] },
      {
        type: "paragraph",
        content: [
          { text: "Soft", bold: true, italic: true },
          { text: " fabric", bold: false, italic: false },
        ],
      },
    ])
  })

  it("treats escaped markup as literal text and removes invalid Unicode values", () => {
    expect(parseDescriptionBlocks("<p>&lt;img src=x onerror=bad()&gt; &#x1F9D7; &#xD800; &#1114112;</p>")).toEqual([
      { type: "paragraph", content: [{ text: "<img src=x onerror=bad()> 🧗", bold: false, italic: false }] },
    ])
  })
})
