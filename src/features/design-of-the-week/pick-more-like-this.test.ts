import { describe, expect, it } from "vitest"

import { pickMoreLikeThis } from "./pick-more-like-this"

const pool = Array.from({ length: 24 }, (_, index) => ({ id: `tee-${index}` }))

describe("pickMoreLikeThis", () => {
  it("picks the asked-for number without repeating one", () => {
    const picked = pickMoreLikeThis("drop-1", pool, 4)
    expect(picked).toHaveLength(4)
    expect(new Set(picked.map((entry) => entry.id)).size).toBe(4)
    expect(picked.every((entry) => pool.includes(entry))).toBe(true)
  })

  // The whole point: the same four tees for every shopper, every request and every crawler, so the
  // page can be cached and a browser test can assert WHICH four rather than merely "four".
  it("returns the same selection every time for one drop", () => {
    expect(pickMoreLikeThis("drop-1", pool, 4)).toEqual(pickMoreLikeThis("drop-1", pool, 4))
  })

  // "Fixed" has to survive the shop changing around the pick. A shuffle over positions does not:
  // it depends on the pool's length and order, both of which the owner changes from the Products page.
  it("keeps the same four when a tee that was not picked leaves the shop", () => {
    const picked = pickMoreLikeThis("drop-1", pool, 4)
    const unpicked = pool.find((entry) => !picked.includes(entry))!
    expect(
      pickMoreLikeThis(
        "drop-1",
        pool.filter((entry) => entry !== unpicked),
        4
      )
    ).toEqual(picked)
  })

  it("keeps the same four however the owner orders the Featured lineup", () => {
    const picked = pickMoreLikeThis("drop-1", pool, 4)
    expect(pickMoreLikeThis("drop-1", pool.toReversed(), 4)).toEqual(picked)
    expect(pickMoreLikeThis("drop-1", [picked[3]!, ...pool.filter((entry) => entry !== picked[3])], 4)).toEqual(picked)
  })

  it("replaces only the pick that left, and keeps the other three", () => {
    const picked = pickMoreLikeThis("drop-1", pool, 4)
    const after = pickMoreLikeThis(
      "drop-1",
      pool.filter((entry) => entry !== picked[0]),
      4
    )
    expect(after.slice(0, 3)).toEqual(picked.slice(1))
  })

  it("returns a different selection for a different drop", () => {
    const first = pickMoreLikeThis("drop-1", pool, 4).map((entry) => entry.id)
    const second = pickMoreLikeThis("drop-2", pool, 4).map((entry) => entry.id)
    expect(first).not.toEqual(second)
  })

  // Unrelated to the shop's own order is the property that makes it read as a pick rather than a list.
  it("does not simply return the front of the pool", () => {
    expect(pickMoreLikeThis("drop-1", pool, 4).map((entry) => entry.id)).not.toEqual([
      "tee-0",
      "tee-1",
      "tee-2",
      "tee-3",
    ])
  })

  it.each([
    ["a pool smaller than asked for", 2, 2],
    ["an exactly-sized pool", 4, 4],
    ["an empty pool", 0, 0],
  ])("gives everything it has for %s", (_label, size, expected) => {
    expect(pickMoreLikeThis("drop-1", pool.slice(0, size), 4)).toHaveLength(expected)
  })

  it("never mutates the pool it was handed", () => {
    const original = pool.map((entry) => entry.id)
    pickMoreLikeThis("drop-1", pool, 4)
    expect(pool.map((entry) => entry.id)).toEqual(original)
  })

  it("asks for nothing gracefully", () => {
    expect(pickMoreLikeThis("drop-1", pool, 0)).toEqual([])
  })
})
