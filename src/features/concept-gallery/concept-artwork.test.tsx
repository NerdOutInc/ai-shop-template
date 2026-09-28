import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"

import { conceptDesignFixture } from "../../../test/concept-design-fixture"

import { ConceptArtwork } from "./concept-artwork"

const revision = conceptDesignFixture().revision!

it("loads the browsing size of the transparent print rather than the master", () => {
  render(
    <ConceptArtwork
      revision={{
        ...revision,
        preview: { ...revision.original!, kind: "preview", url: "/opaque-preview.webp" },
        print: { ...revision.print!, url: "/transparent-print.png" },
      }}
      title="Design"
      background="#202020"
      size="small"
    />
  )
  expect(screen.getByRole("img")).toHaveAttribute("src", "/transparent-print.png?size=small")
})

it("paints the chosen garment behind transparent artwork", () => {
  const { container } = render(<ConceptArtwork revision={revision} title="Design" background="#283244" size="medium" />)
  expect(container.firstElementChild).toHaveStyle({ backgroundColor: "#283244" })
})

it("keeps an unavailable saved revision missing", () => {
  render(<ConceptArtwork revision={null} title="Design" background="#202020" size="small" />)
  expect(screen.queryByRole("img")).not.toBeInTheDocument()
  expect(screen.getByText("Artwork is awaiting private upload.")).toBeInTheDocument()
})
