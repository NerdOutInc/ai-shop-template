import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { LibraryProductUse } from "@/features/design-library/library-types"

import { ConceptProductUses } from "./concept-product-uses"

const product: LibraryProductUse = {
  id: "binding",
  shopId: "shop",
  productId: "printify-product",
  productModelId: "next-level-6210",
  productModelLabel: "Next Level 6210",
  revisionId: "old-revision",
  status: "published",
  verifiedAt: "2026-09-13T12:00:00Z",
  storefrontUrl: "/shop/printify-product",
}

describe("ConceptProductUses", () => {
  it("shows a verified product link and explicitly identifies a bound revision mismatch", () => {
    render(<ConceptProductUses products={[product]} revisionId="new-revision" />)
    expect(screen.getByText("In store")).toBeVisible()
    expect(screen.getByText(/Uses a different artwork revision/)).toHaveTextContent("old-revision")
    expect(screen.getByRole("link", { name: "View in store" })).toHaveAttribute("href", "/shop/printify-product")
    expect(screen.getByRole("link", { name: /Open Printify record/ })).toHaveAttribute(
      "href",
      "https://printify.com/app/product-details/printify-product"
    )
  })

  it("does not treat an unverified published record as a verified store listing", () => {
    render(<ConceptProductUses products={[{ ...product, verifiedAt: null }]} revisionId="old-revision" />)
    expect(screen.getByText("Not yet verified")).toBeVisible()
    expect(screen.queryByRole("link", { name: "View in store" })).not.toBeInTheDocument()
  })

  it("keeps uncertain creation visibly blocked without presenting a duplicate create action", () => {
    render(
      <ConceptProductUses
        products={[
          { ...product, status: "needs-reconciliation", productId: null, verifiedAt: null, storefrontUrl: null },
        ]}
        revisionId="old-revision"
      />
    )
    expect(screen.getByText("Needs reconciliation")).toBeVisible()
    expect(screen.getByText(/Resolve this record before creating another/)).toBeVisible()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})
