import { describe, expect, it } from "vitest"

import { isPrivateAppPath } from "./is-private-app-path"

describe("private application paths", () => {
  it.each([
    "/admin",
    "/admin/concepts/149",
    "/admin/setup",
    "/auth/callback",
    "/api/admin/assets/a",
    "/%61dmin/account",
    "/admin%2Fconcepts",
    "/bad%escape",
  ])("protects %s", (path) => {
    expect(isPrivateAppPath(path)).toBe(true)
  })

  it.each(["/", "/shop", "/checkout/success", "/administration", "/author"])("keeps public route %s", (path) => {
    expect(isPrivateAppPath(path)).toBe(false)
  })
})
