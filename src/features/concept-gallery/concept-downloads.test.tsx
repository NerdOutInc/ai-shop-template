import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { conceptDesignFixture } from "../../../test/concept-design-fixture"

import { ConceptDownloads } from "./concept-downloads"

describe("ConceptDownloads", () => {
  it("offers the print file and each browsing size by authenticated asset ID", () => {
    const revision = conceptDesignFixture().revision!
    render(<ConceptDownloads revision={revision} />)
    expect(screen.getByRole("link", { name: "Download print file" })).toHaveAttribute(
      "href",
      `/api/admin/assets/${revision.print!.id}?download=1`
    )
    for (const [label, size] of [
      ["Large · 1440 px", "large"],
      ["Medium · 800 px", "medium"],
      ["Small · 480 px", "small"],
    ])
      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "href",
        `/api/admin/assets/${revision.print!.id}?size=${size}&download=1`
      )
    expect(screen.getByText(/2,668 × 3,812 px/)).toBeVisible()
  })

  it("keeps the preserved original reachable alongside the print file", () => {
    const revision = conceptDesignFixture().revision!
    render(<ConceptDownloads revision={revision} />)
    expect(screen.getByRole("link", { name: /preserved original source/ })).toHaveAttribute(
      "href",
      `/api/admin/assets/${revision.original!.id}?download=1`
    )
  })

  it("withholds browsing sizes until the print file is verified transparent", () => {
    const revision = conceptDesignFixture().revision!
    revision.print = { ...revision.print!, hasTransparency: null }
    render(<ConceptDownloads revision={revision} />)
    // The route derives sizes only from prepared transparent artwork, so advertising them
    // here would hand the owner links that cannot resolve.
    expect(screen.queryByRole("link", { name: /Large · / })).not.toBeInTheDocument()
    expect(screen.getByText(/transparency not verified/)).toBeVisible()
    expect(screen.getByText(/Browsing sizes appear once a transparent print file/)).toBeVisible()
  })

  it("falls back to the original when no print file exists", () => {
    const revision = conceptDesignFixture().revision!
    revision.print = null
    render(<ConceptDownloads revision={revision} />)
    expect(screen.getByRole("link", { name: "Download print file" })).toHaveAttribute(
      "href",
      `/api/admin/assets/${revision.original!.id}?download=1`
    )
    expect(screen.queryByRole("link", { name: /preserved original source/ })).not.toBeInTheDocument()
  })
})
