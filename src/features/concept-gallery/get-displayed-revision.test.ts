import { describe, expect, it } from "vitest"

import { conceptDesignFixture } from "../../../test/concept-design-fixture"

import { getDisplayedRevision } from "./get-displayed-revision"

describe("getDisplayedRevision", () => {
  it("keeps a favorite on its saved revision when a newer revision exists", () => {
    const design = conceptDesignFixture()
    const original = design.revision!
    const latest = { ...original, id: "new-revision" }
    design.revision = latest
    design.revisions = [latest, original]
    design.favoriteRevisionId = original.id
    expect(getDisplayedRevision(design)).toBe(original)
    expect(getDisplayedRevision(design, latest.id)).toBe(latest)
  })

  it("does not substitute current artwork for a missing saved or requested revision", () => {
    const design = conceptDesignFixture({ favoriteRevisionId: "missing" })
    expect(getDisplayedRevision(design)).toBeNull()
    expect(getDisplayedRevision(design, "also-missing")).toBeNull()
  })
})
