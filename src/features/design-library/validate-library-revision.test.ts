import { expect, it } from "vitest"

import { validateLibraryRevision } from "./validate-library-revision"

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: "3f1d6a9c-4b2e-4f01-9a77-1c2d5e8b7a40",
    url: "/api/admin/assets/3f1d6a9c-4b2e-4f01-9a77-1c2d5e8b7a40",
    kind: "print",
    status: "pending",
    mimeType: "image/png",
    width: 4200,
    height: 4800,
    bytes: 2_000_000,
    sha256: "a".repeat(64),
    pixelSha256: "b".repeat(64),
    perceptualHash: null,
    hasAlpha: true,
    hasTransparency: true,
    enlarged: true,
    pathname: null,
    sourcePath: null,
    originalFilename: "design-print.png",
    ...overrides,
  }
}

function revision(assets: Record<string, unknown>[] = [asset()]) {
  return {
    id: "8c2a1e55-77b3-4d9e-9f21-0a6b3c4d5e6f",
    assets,
    printReadiness: "unverified",
    printNotes: "Prepared transparent master.",
    widthInches: null,
    heightInches: null,
    nativePpi: null,
  }
}

it("accepts a transparent print master", () => {
  expect(validateLibraryRevision(revision()).assets).toHaveLength(1)
})

it("refuses a revision with no print file", () => {
  expect(() => validateLibraryRevision(revision([asset({ kind: "preview", mimeType: "image/webp" })]))).toThrow(
    "print file"
  )
})

it("refuses a print file that is not verified transparent", () => {
  // Preparation exists to add transparency; the server never will, and the browsing sizes
  // refuse to derive without it, so an opaque master here is a silent dead end.
  for (const overrides of [{ hasTransparency: false }, { hasAlpha: false }, { mimeType: "image/webp" }])
    expect(() => validateLibraryRevision(revision([asset(overrides)]))).toThrow("transparent PNG")
})

it("refuses assets that claim to be stored already", () => {
  expect(() => validateLibraryRevision(revision([asset({ status: "ready" })]))).toThrow("stay pending")
  expect(() => validateLibraryRevision(revision([asset({ pathname: "concepts/x/y.png" })]))).toThrow("stay pending")
})

it("refuses two assets of the same kind", () => {
  expect(() =>
    validateLibraryRevision(revision([asset(), asset({ id: "11111111-1111-4111-8111-111111111111" })]))
  ).toThrow("one asset of each kind")
})

it("reports which field is wrong", () => {
  expect(() => validateLibraryRevision({ ...revision(), id: "not-a-uuid" })).toThrow(/id:/)
})
