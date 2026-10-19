import { displayColorName } from "@/lib/display-color-name"
import type { CatalogProduct } from "@/features/catalog/catalog-product"
import type { GarmentFeedProfile } from "@/features/garment-catalog/garment-feed-profile-schema"
import type { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"

import { googleMerchantCopySchema } from "./google-merchant-copy-schema"
import { googleCopySharedFactsHash } from "./google-copy-shared-facts-hash"
import { merchantField } from "./merchant-field"

export type ResolvedGoogleCopy = {
  content: string
  origin: "generated" | "human"
  pattern?: string
  material?: string
}
export type GoogleCopyReason =
  "MISSING" | "INVALID_RECORD" | "SHARED_FACTS_CHANGED" | "UNCOVERED_VARIANT" | "VARIANT_CHANGED" | "INVALID_FIELDS"
export type GoogleCopyResolution = {
  variants: ReadonlyMap<number, ResolvedGoogleCopy>
  issues: { code: GoogleCopyReason; variantId?: number }[]
}

export function resolveGoogleMerchantCopy(
  raw: unknown,
  product: CatalogProduct,
  production: NonNullable<ReturnType<typeof parsePrintifyProduct>>,
  apparel: GarmentFeedProfile
): GoogleCopyResolution {
  const variants = new Map<number, ResolvedGoogleCopy>()
  const issues: GoogleCopyResolution["issues"] = []
  try {
    if (raw === undefined) return { variants, issues: [{ code: "MISSING" }] }
    const parsed = googleMerchantCopySchema.safeParse(raw)
    if (!parsed.success) return { variants, issues: [{ code: "INVALID_RECORD" }] }
    const copy = parsed.data
    if (copy.shared_facts_hash !== googleCopySharedFactsHash(product, apparel))
      return { variants, issues: [{ code: "SHARED_FACTS_CHANGED" }] }
    // Use the emitter's validators, including XML legality, for optional fields too.
    merchantField("description", copy.content, 5000)
    if (copy.pattern !== undefined) merchantField("pattern", copy.pattern, 100)
    for (const [color, material] of Object.entries(copy.materials ?? {})) {
      if (!copy.reviewed_variants.some((v) => v.color === color))
        return { variants, issues: [{ code: "INVALID_FIELDS" }] }
      merchantField("material", material, 200)
    }
    for (const variant of product.variants) {
      const reviewed = copy.reviewed_variants.find((v) => v.id === variant.id)
      if (!reviewed) {
        issues.push({ code: "UNCOVERED_VARIANT", variantId: variant.id })
        continue
      }
      const saved = production.variants.find((v) => v.id === variant.id)
      if (
        !saved ||
        reviewed.fingerprint !== saved.fingerprint ||
        reviewed.label !== saved.label ||
        reviewed.color !== variant.color ||
        reviewed.size !== variant.size
      ) {
        issues.push({ code: "VARIANT_CHANGED", variantId: variant.id })
        continue
      }
      try {
        const content = `${copy.content} Color: ${displayColorName(variant.color)}. Size: ${variant.size}.`
        merchantField("description", content, 5000)
        variants.set(variant.id, {
          content,
          origin: copy.origin,
          ...(copy.pattern !== undefined ? { pattern: copy.pattern } : {}),
          ...(copy.materials && Object.hasOwn(copy.materials, reviewed.color)
            ? { material: copy.materials[reviewed.color] }
            : {}),
        })
      } catch {
        issues.push({ code: "INVALID_FIELDS", variantId: variant.id })
      }
    }
    return { variants, issues }
  } catch {
    return { variants: new Map(), issues: [{ code: "INVALID_FIELDS" }] }
  }
}
