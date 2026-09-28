// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createCatalogFixture } from "../../../test/create-catalog-fixture"

import { listFeaturedOrder } from "./list-featured-order.server"

const { listAdminProducts } = vi.hoisted(() => ({ listAdminProducts: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/features/publishing/get-publishing-store.server", () => ({
  getPublishingStore: () => ({ listAdminProducts }),
}))

// First on the wall Sep 1 and last put back Sep 12, so the arrival cannot be mistaken for the launch.
const shown = {
  hiddenAt: null,
  revealAt: null,
  revealedAt: "2026-09-01T00:00:00.000Z",
  addedToShopAt: "2026-09-12T08:00:00.000Z",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("listFeaturedOrder", () => {
  it("lists every active product in its saved order with a display title and image", async () => {
    listAdminProducts.mockResolvedValue([
      { snapshot: { ...createCatalogFixture("second-tee"), title: "Second Tee — Your Store" }, ...shown },
      { snapshot: createCatalogFixture("first-tee"), ...shown },
    ])
    expect(await listFeaturedOrder()).toEqual({
      status: "ready",
      now: expect.any(Number),
      products: [
        {
          id: "second-tee",
          title: "Second Tee",
          image: { src: "https://images.printify.com/green.jpg", alt: expect.any(String) },
          ...shown,
        },
        {
          id: "first-tee",
          title: "Published tee",
          image: { src: "https://images.printify.com/green.jpg", alt: expect.any(String) },
          ...shown,
        },
      ],
    })
  })

  // The page draws both lists from this one read, so the owner's decision has to survive it, and the
  // last arrival with it: hiding keeps the stamp, and a tee never shown has none.
  it("carries the hidden, scheduled and never-shown states through to the page", async () => {
    const hidden = {
      hiddenAt: "2026-09-19T10:00:00.000Z",
      revealAt: null,
      revealedAt: "2026-09-01T00:00:00.000Z",
      addedToShopAt: "2026-09-12T08:00:00.000Z",
    }
    const scheduled = {
      hiddenAt: "2026-09-19T10:00:00.000Z",
      revealAt: "2026-09-25T09:00:00.000Z",
      revealedAt: null,
      addedToShopAt: null,
    }
    listAdminProducts.mockResolvedValue([
      { snapshot: createCatalogFixture("hidden-tee"), ...hidden },
      { snapshot: createCatalogFixture("scheduled-tee"), ...scheduled },
    ])
    const result = await listFeaturedOrder()
    expect(result.status === "ready" && result.products).toMatchObject([
      { id: "hidden-tee", ...hidden },
      { id: "scheduled-tee", ...scheduled },
    ])
  })

  it("keeps a product the storefront cannot display so a save still names it", async () => {
    listAdminProducts.mockResolvedValue([
      { snapshot: { id: "broken-tee", title: "Broken Tee — Your Store" }, ...shown },
      { snapshot: { id: "untitled" }, ...shown },
    ])
    expect(await listFeaturedOrder()).toEqual({
      status: "ready",
      now: expect.any(Number),
      products: [
        { id: "broken-tee", title: "Broken Tee", image: null, ...shown },
        { id: "untitled", title: "untitled", image: null, ...shown },
      ],
    })
  })

  it("reports storage failures as unavailable without exposing details", async () => {
    listAdminProducts.mockRejectedValue(new Error("private database host"))
    expect(await listFeaturedOrder()).toEqual({ status: "unavailable" })
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private database host")
  })
})
