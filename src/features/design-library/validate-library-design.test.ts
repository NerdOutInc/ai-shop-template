import { describe, expect, it } from "vitest"

import type { LibraryDesignInput } from "./library-types"

import { libraryIdentity } from "./library-identity"
import { validateLibraryDesign } from "./validate-library-design"

function design(): LibraryDesignInput {
  const id = libraryIdentity("test", "design"),
    revisionId = libraryIdentity("test", "revision"),
    assetId = libraryIdentity("test", "asset")
  return {
    id,
    title: "A design",
    family: "Funny",
    summary: "",
    mechanism: "",
    prompt: "",
    background: null,
    state: "active",
    collectionIds: ["test"],
    revision: {
      id: revisionId,
      printReadiness: "needs-preparation",
      printNotes: null,
      widthInches: null,
      heightInches: null,
      nativePpi: null,
      assets: [
        {
          id: assetId,
          url: `/api/admin/assets/${assetId}`,
          kind: "original",
          status: "pending",
          pathname: null,
          sourcePath: "concepts/a.png",
          originalFilename: "a.png",
          mimeType: "image/png",
          width: 2,
          height: 2,
          bytes: 80,
          sha256: "a".repeat(64),
          pixelSha256: "b".repeat(64),
          perceptualHash: "0".repeat(16),
          hasAlpha: true,
          hasTransparency: false,
          enlarged: false,
        },
      ],
    },
  }
}
describe("library design contract", () => {
  it("requires original and strict design identities", () => {
    expect(validateLibraryDesign(design())).toEqual(design())
    expect(() => validateLibraryDesign({ ...design(), displayNumber: "149" })).toThrow()
    expect(() => validateLibraryDesign({ ...design(), unexpectedIdentity: "other" })).toThrow()
    const missing = design()
    missing.revision.assets[0]!.kind = "preview"
    expect(() => validateLibraryDesign(missing)).toThrow("original")
  })
  it("does not label opaque or unstored art ready", () => {
    const input = design()
    input.revision.printReadiness = "ready"
    expect(() => validateLibraryDesign(input)).toThrow("Print readiness")
    const invalid = design()
    invalid.revision.assets[0]!.status = "ready"
    expect(() => validateLibraryDesign(invalid)).toThrow("pathname")
  })
  it("rejects invalid hashes, filename headers and public asset URLs", () => {
    for (const mutation of [
      { sha256: "bad" },
      { url: "https://example.com/original.png" },
      { originalFilename: "a.png\r\nheader:x" },
      { pathname: "https://public.blob.vercel-storage.com/master.png" },
    ]) {
      const input = design()
      Object.assign(input.revision.assets[0]!, mutation)
      expect(() => validateLibraryDesign(input)).toThrow()
    }
  })
})
