import "server-only"

import { createHash } from "node:crypto"

import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)])
    )
  return value
}

export function publishingSourceFingerprint(
  raw: Record<string, unknown>,
  expected: { productId: string; shopId: string },
  visibilityOnly = false
): string {
  if (raw.visible !== undefined && typeof raw.visible !== "boolean") throw new Error("INVALID_VISIBILITY")
  if (visibilityOnly) {
    if (raw.id !== expected.productId || String(raw.shop_id) !== expected.shopId || typeof raw.visible !== "boolean")
      throw new Error("INVALID_PRODUCT")
    // Visibility can be changed while the saved design is invalid or has unsupported provider fields.
    return (
      "visibility-v1:" +
      createHash("sha256")
        .update(
          JSON.stringify(
            canonical({
              productId: expected.productId,
              shopId: expected.shopId,
              visible: raw.visible ?? true,
              updated_at: raw.updated_at,
            })
          )
        )
        .digest("hex")
    )
  }
  const parsed = parsePrintifyProduct(raw, expected)
  if (!parsed) throw new Error("INVALID_PRODUCT")
  // Ignore stock and response metadata. A changed draft must not receive an older job's callback.
  const fields = Object.fromEntries(
    ["title", "description", "images", "options", "tags", "key_features", "shipping_template", "updated_at"].map(
      (field) => [field, raw[field]]
    )
  )
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          ...fields,
          id: parsed.id,
          visible: raw.visible ?? true,
          variants: parsed.variants.map((variant) => ({
            id: variant.id,
            price: variant.unitAmount,
            enabled: variant.enabled,
            label: variant.label,
            fingerprint: variant.fingerprint,
          })),
        })
      )
    )
    .digest("hex")
}
