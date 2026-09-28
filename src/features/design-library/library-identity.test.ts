import { describe, expect, it } from "vitest"

import { libraryIdentity } from "./library-identity"

describe("library identity", () => {
  it("keeps exact identity components distinct and deterministic", () => {
    expect(libraryIdentity("shirt", "001")).toBe(libraryIdentity("shirt", "001"))
    expect(libraryIdentity("shirt", "001")).not.toBe(libraryIdentity("shirt", "1"))
    expect(libraryIdentity("shirt", "001")).not.toBe(libraryIdentity("other", "001"))
    expect(libraryIdentity("ab", "c")).not.toBe(libraryIdentity("a", "bc"))
  })
  it("rejects empty and padded source IDs", () => {
    expect(() => libraryIdentity("shirt", "")).toThrow()
    expect(() => libraryIdentity("shirt", " 001")).toThrow()
  })
})
