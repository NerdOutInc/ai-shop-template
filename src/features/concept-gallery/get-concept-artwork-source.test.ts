import { expect, it } from "vitest"

import { conceptDesignFixture } from "../../../test/concept-design-fixture"

import { getConceptArtworkSource } from "./get-concept-artwork-source"

const revision = conceptDesignFixture().revision!

it("requests a browsing size instead of the transparent print master", () => {
  const source = getConceptArtworkSource(
    {
      ...revision,
      preview: { ...revision.original!, kind: "preview", url: "/opaque-preview.webp" },
      print: { ...revision.print!, url: "/transparent-print.png" },
    },
    "small"
  )
  expect(source).toMatchObject({ src: "/transparent-print.png?size=small", transparent: true })
})

it("keeps the intrinsic ratio of the master so the layout box is reserved before loading", () => {
  const source = getConceptArtworkSource(revision, "large")
  expect(source).toMatchObject({ width: revision.print!.width, height: revision.print!.height })
})

it("falls back to transparent native art when the print file is not ready", () => {
  const source = getConceptArtworkSource(
    {
      ...revision,
      preview: { ...revision.original!, kind: "preview", url: "/opaque-preview.webp" },
      print: { ...revision.print!, status: "pending" },
      original: { ...revision.original!, hasAlpha: true, hasTransparency: true, url: "/transparent-original.png" },
    },
    "medium"
  )
  expect(source).toMatchObject({ src: "/transparent-original.png?size=medium", transparent: true })
})

it("serves unprepared artwork at its own size and reports it as opaque", () => {
  const source = getConceptArtworkSource(
    {
      ...revision,
      preview: { ...revision.original!, kind: "preview", url: "/opaque-preview.webp" },
      print: { ...revision.print!, status: "pending" },
    },
    "small"
  )
  // Asking the route for a size it cannot derive would 404, and the master is the very
  // file a browsing size exists to avoid.
  expect(source).toMatchObject({ src: "/opaque-preview.webp", transparent: false })
})

it("reports nothing when no artwork is ready", () => {
  expect(
    getConceptArtworkSource(
      {
        ...revision,
        original: { ...revision.original!, status: "pending" },
        print: { ...revision.print!, status: "pending" },
        preview: null,
      },
      "small"
    )
  ).toBeNull()
  expect(getConceptArtworkSource(null, "small")).toBeNull()
})
