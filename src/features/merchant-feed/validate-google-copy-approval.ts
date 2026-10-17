import { catalogProductSchema } from "@/features/catalog/catalog-product-schema"
import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import type { GarmentFeedProfile } from "@/features/garment-catalog/garment-feed-profile-schema"
import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"
import { googleMerchantCopySchema } from "./google-merchant-copy-schema"
import type { GoogleCopyProvenance } from "./read-google-copy-provenance.server"
import { resolveGoogleMerchantCopy } from "./resolve-google-merchant-copy"

export function validateGoogleCopyApproval(
  raw: unknown,
  snapshot: Record<string, unknown>,
  shopId: string,
  apparel: GarmentFeedProfile,
  provenance: GoogleCopyProvenance = "unknown"
) {
  const parsed = googleMerchantCopySchema.safeParse(raw)
  const display = catalogProductSchema.safeParse(snapshot)
  if (!parsed.success || !display.success) throw new Error("GOOGLE_COPY_INVALID_APPROVAL")
  const product = normalizeCatalogProduct(display.data)
  const production = parsePrintifyProduct(snapshot, { productId: product.id, shopId })
  if (!production) throw new Error("GOOGLE_COPY_INVALID_SNAPSHOT")
  const previous = snapshot.google_merchant_copy
  // An edit or human approval does not erase known generative origin.
  if (
    parsed.data.origin !== "generated" &&
    (provenance === "generated" ||
      (previous !== null && typeof previous === "object" && "origin" in previous && previous.origin === "generated"))
  )
    throw new Error("GOOGLE_COPY_ORIGIN_DOWNGRADE")
  if (parsed.data.origin === "human" && provenance === "incomplete")
    throw new Error("GOOGLE_COPY_PROVENANCE_INCOMPLETE")
  const resolved = resolveGoogleMerchantCopy(parsed.data, product, production, apparel)
  if (!parsed.data.reviewed_variants.every((v) => resolved.variants.has(v.id)))
    throw new Error("GOOGLE_COPY_INVALID_APPROVAL")
  return { copy: parsed.data, resolved }
}
