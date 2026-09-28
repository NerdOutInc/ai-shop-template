import { describe, expect, it } from "vitest"

import { readAddedToShopAt } from "./read-added-to-shop-at"

const stamp = "2026-09-10T15:30:00.000Z"
const reveal = "2026-09-14T12:00:00.000Z"

describe("readAddedToShopAt", () => {
  it("reads the stamp when nothing is waiting on a reveal", () => {
    expect(readAddedToShopAt({ addedToShopAt: stamp, revealAt: null })).toBe(stamp)
  })

  // A product the clock revealed on its first visit has no stamp at all until a hide or show settles it.
  it("reads the reveal when there is no stamp yet", () => {
    expect(readAddedToShopAt({ addedToShopAt: null, revealAt: reveal })).toBe(reveal)
  })

  // A timed reveal writes nothing, so the stamp left from the previous visit is older than the return.
  it("takes an arrived reveal over the older stamp it brought the product back from", () => {
    expect(readAddedToShopAt({ addedToShopAt: stamp, revealAt: reveal })).toBe(reveal)
  })

  it("keeps a stamp that is later than the reveal", () => {
    const later = "2026-09-15T09:00:00.000Z"
    expect(readAddedToShopAt({ addedToShopAt: later, revealAt: reveal })).toBe(later)
  })

  it("keeps the stamp when the two are the same moment", () => {
    expect(readAddedToShopAt({ addedToShopAt: reveal, revealAt: reveal })).toBe(reveal)
  })

  it("has no arrival when neither is set", () => {
    expect(readAddedToShopAt({ addedToShopAt: null, revealAt: null })).toBeNull()
  })

  it("ignores an unparseable value in favour of the other", () => {
    expect(readAddedToShopAt({ addedToShopAt: "not-a-date", revealAt: reveal })).toBe(reveal)
    expect(readAddedToShopAt({ addedToShopAt: stamp, revealAt: "not-a-date" })).toBe(stamp)
    expect(readAddedToShopAt({ addedToShopAt: "", revealAt: "not-a-date" })).toBeNull()
  })
})
