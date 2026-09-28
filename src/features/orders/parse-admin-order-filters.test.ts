import { describe, expect, it } from "vitest"

import { adminOrderFixtures } from "../../../test/admin-order-fixtures"

import { adminOrderPageUrl } from "./admin-order-page-url"

import { parseAdminOrderFilters } from "./parse-admin-order-filters"

const { filters: adminOrderFilters } = adminOrderFixtures

describe("admin order filters", () => {
  it("preserves a valid exact order link and rejects malformed IDs", () => {
    const id = "6224014e-39f1-4dfb-9198-824768f4b53f"
    const filters = parseAdminOrderFilters({ order: id })
    expect(filters.orderId).toBe(id)
    expect(adminOrderPageUrl(filters, 2)).toContain(`order=${id}`)
    expect(parseAdminOrderFilters({ order: "not-a-uuid" }).orderId).toBeUndefined()
    expect(parseAdminOrderFilters({ order: [id, id] }).orderId).toBeUndefined()
  })
  it("starts with captured payments and excludes test orders", () => {
    expect(parseAdminOrderFilters({})).toEqual(adminOrderFilters)
  })

  it("rejects repeated, unknown and unbounded filter input", () => {
    expect(
      parseAdminOrderFilters({
        payment: ["all", "paid"],
        fulfillment: "failed",
        mode: "yes",
        channel: "secret",
        page: "Infinity",
      })
    ).toEqual(adminOrderFilters)
    for (const page of ["-1", "0", "1001", "1.5", "NaN"]) expect(parseAdminOrderFilters({ page }).page).toBe(1)
  })

  it("retains valid independent filters and a bounded page", () => {
    expect(
      parseAdminOrderFilters({
        payment: "unverified",
        fulfillment: "attention",
        mode: "test",
        channel: "unknown",
        page: "3",
      })
    ).toEqual({
      page: 3,
      payment: "unverified",
      fulfillment: "attention",
      mode: "test",
      channel: "unknown",
    })
  })
})
