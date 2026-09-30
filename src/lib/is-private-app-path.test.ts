import { describe, expect, it } from "vitest"

import { isPrivateAppPath } from "./is-private-app-path"

describe("private application paths", () => {
  it.each([
    "/admin",
    "/admin/concepts/149",
    "/admin/setup",
    "/auth/callback",
    "/api/admin/assets/a",
    "/unsubscribe/5f0b2c4e-8a51-4d8e-9a57-2c1f7f3b9d10",
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
