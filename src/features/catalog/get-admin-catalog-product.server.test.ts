import { beforeEach, describe, expect, it, vi } from "vitest"

import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { listPublishedProducts } from "@/features/publishing/list-published-products-for-admin.server"

import { getAdminCatalogProduct } from "./get-admin-catalog-product.server"
import { normalizeCatalogProduct } from "./normalize-catalog-product"
import { readPublishedCatalog } from "./read-published-catalog.server"

const fixture = vi.hoisted(() => ({
  env: { PRINTIFY_PUBLISHING_ENABLED: true, PRINTIFY_SHOP_ID: "1234" },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env: fixture.env }))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor: vi.fn() }))
vi.mock("@/features/publishing/list-published-products-for-admin.server", () => ({ listPublishedProducts: vi.fn() }))
vi.mock("./read-published-catalog.server", () => ({ readPublishedCatalog: vi.fn() }))

const hiddenSnapshot = {
  id: "hidden-published-product",
  shop_id: 1234,
  title: "Waiting for a small win",
  variants: [],
  options: [],
  images: [],
}
const product = normalizeCatalogProduct(hiddenSnapshot)

beforeEach(() => {
  fixture.env.PRINTIFY_PUBLISHING_ENABLED = true
  vi.mocked(getAdminActor).mockResolvedValue({ userId: "owner" })
  vi.mocked(listPublishedProducts).mockResolvedValue([hiddenSnapshot])
  vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "ready", products: [product] })
})

describe("admin product preview reads", () => {
  it("denies anonymous and non-admin readers before touching private snapshots or stock", async () => {
    // getAdminActor returns null for both absent identities and identities without an active membership.
    vi.mocked(getAdminActor).mockResolvedValue(null)
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual({ status: "missing" })
    expect(listPublishedProducts).not.toHaveBeenCalled()
    expect(readPublishedCatalog).not.toHaveBeenCalled()
  })

  it("reauthorizes every read, including immediately after membership revocation", async () => {
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual({ status: "ready", product, isNew: false })
    vi.mocked(getAdminActor).mockResolvedValue(null)
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual({ status: "missing" })
    expect(getAdminActor).toHaveBeenCalledTimes(2)
    expect(listPublishedProducts).toHaveBeenCalledOnce()
  })

  it("normalizes hidden published snapshots with the same display and stock reader as the storefront", async () => {
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual({ status: "ready", product, isNew: false })
    expect(readPublishedCatalog).toHaveBeenCalledExactlyOnceWith([hiddenSnapshot])
    expect(getAdminActor).toHaveBeenCalledOnce()
  })

  // New means new in the shop, and a private preview is of a product the shop is not showing.
  it("never marks a preview as new, even when its arrival is recent", async () => {
    const recent = { ...product, addedToShopAt: new Date().toISOString() }
    vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "ready", products: [recent] })
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual({ status: "ready", product: recent, isNew: false })
  })

  it("withholds missing or unpublished products even from admins", async () => {
    expect(await getAdminCatalogProduct("unpublished-draft")).toEqual({ status: "missing" })
    expect(readPublishedCatalog).not.toHaveBeenCalled()
  })

  it("rejects a snapshot whose shop does not match the configured store", async () => {
    vi.mocked(listPublishedProducts).mockResolvedValue([{ ...hiddenSnapshot, shop_id: 5678 }])
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual({ status: "missing" })
    expect(readPublishedCatalog).not.toHaveBeenCalled()
  })

  it("does not read publication data when publishing is disabled", async () => {
    fixture.env.PRINTIFY_PUBLISHING_ENABLED = false
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual({ status: "missing" })
    expect(listPublishedProducts).not.toHaveBeenCalled()
  })

  it("keeps invalid snapshots unavailable instead of inventing a preview", async () => {
    vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "unavailable", products: [] })
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual({ status: "unavailable" })
  })

  it("offers an authenticated retry state during an outage without disclosing storage details", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.mocked(listPublishedProducts).mockRejectedValueOnce(new Error("private database credential"))
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual({ status: "unavailable" })
    expect(warn).toHaveBeenCalledExactlyOnceWith("Admin product preview unavailable", { reason: "storage" })
    expect(readPublishedCatalog).not.toHaveBeenCalled()
  })
})
