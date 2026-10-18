import { expect, it } from "vitest"
import { matchesEntityTag } from "./matches-entity-tag"

const etag = `"${"a".repeat(64)}"`

it("matches exact, weak, listed and wildcard entity tags", () => {
  for (const header of [etag, `W/${etag}`, `"other", ${etag}`, ` W/"other" ,W/${etag} `, "*"])
    expect(matchesEntityTag(header, etag)).toBe(true)
})

it("refuses absent, unquoted and different entity tags", () => {
  for (const header of [null, "", "a".repeat(64), `"${"b".repeat(64)}"`, `W/"other"`])
    expect(matchesEntityTag(header, etag)).toBe(false)
})
