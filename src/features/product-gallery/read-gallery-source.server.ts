import "server-only"
import { createHash } from "node:crypto"
import { catalogProductSchema } from "@/features/catalog/catalog-product-schema"
import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"
import { productionFingerprintVersion } from "@/lib/printify/production-fingerprint-version"
import type { GalleryBinding } from "./gallery-manifest-schema"

export function readGallerySource(snapshot: Record<string, unknown>, revision: string) {
  const display = catalogProductSchema.parse(snapshot)
  const production = parsePrintifyProduct(snapshot, { productId: display.id, shopId: String(display.shop_id) })
  const options = display.options.filter((o) => o.type === "color" || /^colou?rs?$/i.test(o.name))
  const color = options[0]
  const enabled = display.variants.filter((v) => v.is_enabled)
  const values = color?.values ?? [{ id: "none", title: "All colors" }]
  const colors = values.map((value) => {
    const variants = enabled.filter((v) => value.id === "none" || v.options.includes(Number(value.id)))
    const fingerprints = variants.map((v) => production?.variants.find((p) => p.id === v.id)?.designFingerprint)
    const valid =
      options.length <= 1 &&
      variants.length > 0 &&
      fingerprints.every(Boolean) &&
      variants.every((v) => !color || color.values.filter((c) => v.options.includes(c.id)).length === 1)
    const binding: GalleryBinding | null = valid
      ? {
          version: `gallery-v1/${productionFingerprintVersion}`,
          sourceRevision: revision,
          digest: createHash("sha256")
            .update(JSON.stringify([String(value.id), [...new Set(fingerprints)].sort()]))
            .digest("hex"),
        }
      : null
    return { key: String(value.id), title: value.title, variantIds: variants.map((v) => v.id), binding }
  })
  if (new Set(colors.map((c) => c.key)).size !== colors.length) throw new Error("Ambiguous gallery color")
  return { title: display.title, colors, images: display.images, enabledIds: enabled.map((v) => v.id) }
}
