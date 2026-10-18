import { beforeEach, describe, expect, it, vi } from "vitest"

import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { readAdminDisplayProduct } from "@/features/publishing/read-admin-display-product.server"

import { getAdminCatalogProduct } from "./get-admin-catalog-product.server"
import { normalizeCatalogProduct } from "./normalize-catalog-product"
import { readPublishedCatalog } from "./read-published-catalog.server"

const fixture = vi.hoisted(() => ({
  env: { PRINTIFY_PUBLISHING_ENABLED: true, PRINTIFY_SHOP_ID: "1234" },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env: fixture.env }))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor: vi.fn() }))
vi.mock("@/features/publishing/read-admin-display-product.server", () => ({ readAdminDisplayProduct: vi.fn() }))
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
function display(
  snapshot: Record<string, unknown> = hiddenSnapshot,
  gallery: { diagnostic?: string; staleColors?: string[] } = {}
) {
  return {
    snapshot,
    withheldVariantIds: [],
    diagnostic: gallery.diagnostic ?? null,
    staleColors: gallery.staleColors ?? [],
    invalidColors: [],
  }
}
const ready = { status: "ready", product, isNew: false, photoWarning: null }

beforeEach(() => {
  fixture.env.PRINTIFY_PUBLISHING_ENABLED = true
  vi.mocked(getAdminActor).mockResolvedValue({ userId: "owner" })
  vi.mocked(readAdminDisplayProduct).mockResolvedValue(display())
  vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "ready", products: [product] })
})

describe("admin product preview reads", () => {
  it("denies anonymous and non-admin readers before touching private snapshots or stock", async () => {
    // getAdminActor returns null for both absent identities and identities without an active membership.
    vi.mocked(getAdminActor).mockResolvedValue(null)
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual({ status: "missing" })
    expect(readAdminDisplayProduct).not.toHaveBeenCalled()
    expect(readPublishedCatalog).not.toHaveBeenCalled()
  })

  it("reauthorizes every read, including immediately after membership revocation", async () => {
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual(ready)
    vi.mocked(getAdminActor).mockResolvedValue(null)
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual({ status: "missing" })
    expect(getAdminActor).toHaveBeenCalledTimes(2)
    expect(readAdminDisplayProduct).toHaveBeenCalledExactlyOnceWith(hiddenSnapshot.id)
  })

  it("normalizes hidden published snapshots with the same display and stock reader as the storefront", async () => {
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual(ready)
    expect(readPublishedCatalog).toHaveBeenCalledExactlyOnceWith([hiddenSnapshot])
    expect(getAdminActor).toHaveBeenCalledOnce()
  })

  // New means new in the shop, and a private preview is of a product the shop is not showing.
  it("never marks a preview as new, even when its arrival is recent", async () => {
    const recent = { ...product, addedToShopAt: new Date().toISOString() }
    vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "ready", products: [recent] })
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual({ ...ready, product: recent })
  })

  it("withholds missing or unpublished products even from admins", async () => {
    vi.mocked(readAdminDisplayProduct).mockResolvedValueOnce(null)
    expect(await getAdminCatalogProduct("unpublished-draft")).toEqual({ status: "missing" })
    expect(readAdminDisplayProduct).toHaveBeenCalledExactlyOnceWith("unpublished-draft")
    expect(readPublishedCatalog).not.toHaveBeenCalled()
  })

  it("rejects a display read whose snapshot belongs to another product", async () => {
    expect(await getAdminCatalogProduct("unpublished-draft")).toEqual({ status: "missing" })
    expect(readPublishedCatalog).not.toHaveBeenCalled()
  })

  it("rejects a snapshot whose shop does not match the configured store", async () => {
    vi.mocked(readAdminDisplayProduct).mockResolvedValue(display({ ...hiddenSnapshot, shop_id: 5678 }))
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual({ status: "missing" })
    expect(readPublishedCatalog).not.toHaveBeenCalled()
  })

  it("does not read publication data when publishing is disabled", async () => {
    fixture.env.PRINTIFY_PUBLISHING_ENABLED = false
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual({ status: "missing" })
    expect(readAdminDisplayProduct).not.toHaveBeenCalled()
  })

  it("keeps invalid snapshots unavailable instead of inventing a preview", async () => {
    vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "unavailable", products: [] })
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual({ status: "unavailable" })
  })

  it("offers an authenticated retry state during an outage without disclosing storage details", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.mocked(readAdminDisplayProduct).mockRejectedValueOnce(new Error("private database credential"))
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual({ status: "unavailable" })
    expect(warn).toHaveBeenCalledExactlyOnceWith("Admin product preview unavailable", { reason: "storage" })
    expect(readPublishedCatalog).not.toHaveBeenCalled()
  })

  it("passes an unreadable active gallery diagnostic to the preview", async () => {
    const diagnostic = "The active gallery cannot be read. Restore a saved revision or use Printify photos."
    vi.mocked(readAdminDisplayProduct).mockResolvedValue(display(hiddenSnapshot, { diagnostic, staleColors: ["10"] }))
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual({ ...ready, photoWarning: diagnostic })
  })

  it("asks for photo review when a curated color's production settings changed", async () => {
    vi.mocked(readAdminDisplayProduct).mockResolvedValue(display(hiddenSnapshot, { staleColors: ["10"] }))
    expect(await getAdminCatalogProduct(hiddenSnapshot.id)).toEqual({
      ...ready,
      photoWarning:
        "Some product photos need review because their production settings changed. Open Manage product photos to review them.",
    })
  })
})
