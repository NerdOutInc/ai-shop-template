import { expect, it } from "vitest"
import { adminSignInDestination } from "./admin-sign-in-destination"
it("allows only an exact local order link", () => {
  const path = "/admin/orders?order=6224014e-39f1-4dfb-9198-824768f4b53f"
  expect(adminSignInDestination(path)).toBe(path)
  for (const input of [
    undefined,
    [path],
    "https://evil.test",
    "//evil.test",
    "javascript:alert(1)",
    path + "&next=https://evil.test",
    "/admin/orders?order=invalid",
  ])
    expect(adminSignInDestination(input)).toBe("/admin/concepts")
})
