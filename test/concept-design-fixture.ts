import type { LibraryDesign } from "@/features/design-library/library-types"

// A trailing `#` turns the browsing-size query the gallery appends into a fragment, which
// the data URL parser drops, so fixtures still render instead of becoming malformed SVG.
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><path d="M320 220C200 260 200 450 310 500L280 620L450 590L440 490C610 380 560 200 420 210" fill="#f36a50" stroke="#17262d" stroke-width="14"/><circle cx="365" cy="320" r="16" fill="#17262d"/><path d="M370 400L470 340M260 620L450 600" stroke="#17262d" stroke-width="16" fill="none"/><text x="400" y="720" text-anchor="middle" font-size="32" fill="#17262d">Illustrative test artwork</text></svg>')}#`

export function conceptDesignFixture(overrides: Partial<LibraryDesign> = {}): LibraryDesign {
  const revisionId = "11111111-1111-4111-8111-111111111111"
  const designId = "22222222-2222-4222-8222-222222222222"
  const revision: LibraryDesign["revisions"][number] = {
    id: revisionId,
    designId,
    original: {
      id: "33333333-3333-4333-8333-333333333333",
      url: image,
      kind: "original",
      status: "ready",
      mimeType: "image/png",
      width: 1254,
      height: 1254,
      bytes: 200000,
      sha256: "a".repeat(64),
      pixelSha256: null,
      perceptualHash: null,
      hasAlpha: false,
      hasTransparency: false,
      enlarged: false,
    },
    print: {
      id: "44444444-4444-4444-8444-444444444444",
      url: image,
      kind: "print",
      status: "ready",
      mimeType: "image/png",
      width: 2668,
      height: 3812,
      bytes: 300000,
      sha256: "b".repeat(64),
      pixelSha256: null,
      perceptualHash: null,
      hasAlpha: true,
      hasTransparency: true,
      enlarged: true,
    },
    preview: null,
    printReadiness: "ready",
    printNotes: "Enlarged production derivative. Review at the intended garment size.",
    widthInches: 8,
    heightInches: 11.4,
    nativePpi: 110,
    createdAt: "2026-09-13T12:00:00Z",
  }
  return {
    id: designId,
    canonicalDesignId: designId,
    displayNumber: 149,
    title: "Sample Character",
    family: "Illustrated characters",
    summary: "A cheerful abstract character with a playful shape.",
    mechanism: "Simple shapes form a cheerful character.",
    prompt: "Illustrative fixture only. This is not an approved store design.",
    background: null,
    state: "active",
    collectionIds: ["sample-shirts"],
    revision,
    revisions: [revision],
    favoriteRevisionId: null,
    favoriteColorName: null,
    colors: [
      { name: "CVC Midnight Navy", position: 1, source: "assigned" },
      { name: "CVC Cream", position: 2, source: "assigned" },
      { name: "CVC Black", position: 3, source: "assigned" },
      { name: "Heather Forest Green", position: 4, source: "assigned" },
      { name: "CVC Sand", position: 5, source: "assigned" },
    ],
    products: [],
    ...overrides,
  }
}
