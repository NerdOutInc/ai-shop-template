import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import type { LibraryProductUse } from "@/features/design-library/library-types"

const statusLabels: Record<LibraryProductUse["status"], string> = {
  unverified: "Not yet verified",
  reserved: "Draft reserved",
  creating: "Draft creation in progress",
  draft: "Draft exists",
  published: "In store",
  "needs-reconciliation": "Needs reconciliation",
  removed: "Removed product",
}

export function ConceptProductUses({
  products,
  revisionId,
}: {
  products: LibraryProductUse[]
  revisionId: string | null
}) {
  return (
    <section aria-labelledby="product-uses-heading" className="flex flex-col gap-4">
      <h2 id="product-uses-heading" className="font-condensed text-2xl font-semibold">
        Products using this design
      </h2>
      {products.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No product is linked yet. Artwork preparation and inventory checks come before a new draft.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {products.map((product) => {
            const verified = product.verifiedAt !== null
            const status =
              (product.status === "draft" || product.status === "published") && !verified
                ? "Not yet verified"
                : statusLabels[product.status]
            return (
              <li key={product.id} className="flex flex-col gap-2 border-b border-border pb-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{product.productModelLabel}</h3>
                  <Badge variant={product.status === "published" && verified ? "default" : "outline"}>{status}</Badge>
                </div>
                {product.revisionId && product.revisionId !== revisionId && (
                  <p className="text-sm text-muted-foreground">
                    Uses a different artwork revision: <span className="break-all">{product.revisionId}</span>.
                  </p>
                )}
                {!product.revisionId && (
                  <p className="text-sm text-muted-foreground">The artwork revision still needs to be matched.</p>
                )}
                <div className="flex flex-wrap gap-4 text-sm">
                  {product.status === "published" && verified && product.productId && product.storefrontUrl && (
                    <Link
                      href={`/shop/${encodeURIComponent(product.productId)}`}
                      className="inline-flex min-h-11 items-center underline underline-offset-4"
                    >
                      View in store
                    </Link>
                  )}
                  {product.productId && (
                    <a
                      href={`https://printify.com/app/product-details/${encodeURIComponent(product.productId)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center underline underline-offset-4"
                    >
                      Open Printify record <span className="sr-only">(new tab)</span>
                    </a>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {product.status === "draft" || product.status === "published"
                    ? "This model already has a product. Reuse its existing listing."
                    : "Resolve this record before creating another product for this model."}
                </p>
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">
        The same artwork can be used on another supported product model. A favorite does not create or publish a
        product.
      </p>
    </section>
  )
}
