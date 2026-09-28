import { describe, expect, it } from "vitest"

import { getCartImportKey } from "./get-cart-import-key"

const key = "a".repeat(32)
const uuid = "12345678-1234-1234-1234-123456789abc"

describe("getCartImportKey", () => {
  it("recognizes the selection on a persisted import entry", () => {
    expect(getCartImportKey(`${key}:${uuid}`)).toBe(key)
  })

  it.each([uuid, key, `${key}:`, `${key}:later`, `${key}:${"-".repeat(36)}`, `${key}:${uuid}\n`])(
    "does not mistake an ordinary or malformed entry for an import: %s",
    (entryId) => {
      expect(getCartImportKey(entryId)).toBeNull()
    }
  )
})
