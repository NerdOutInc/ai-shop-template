import { beforeEach, expect, it, vi } from "vitest"

import AdminPage from "./page"

const config = vi.hoisted(() => ({ ADMIN_LIBRARY_ENABLED: false }))
vi.mock("@/lib/env", () => ({ env: config }))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND")
  },
  redirect: (href: string) => {
    throw new Error(`REDIRECT:${href}`)
  },
}))
beforeEach(() => {
  config.ADMIN_LIBRARY_ENABLED = false
})

it("keeps the admin entry unavailable when the library is disabled", () => {
  expect(() => AdminPage()).toThrow("NOT_FOUND")
})

it("sends an enabled admin entry through the existing authenticated library route", () => {
  config.ADMIN_LIBRARY_ENABLED = true
  expect(() => AdminPage()).toThrow("REDIRECT:/admin/concepts")
})
