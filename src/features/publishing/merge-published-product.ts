import "server-only"

import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"

import type { PublishingEvent } from "./publishing-event"
import { isVisibilityOnlyEvent } from "./is-visibility-only-event"

export function mergePublishedProduct(
  event: PublishingEvent,
  live: Record<string, unknown>,
  previous: Record<string, unknown> | null
): Record<string, unknown> {
  const expected = { productId: event.productId, shopId: event.shopId }
  if (live.visible !== undefined && typeof live.visible !== "boolean") throw new Error("INVALID_VISIBILITY")
  if (isVisibilityOnlyEvent(event)) {
    if (live.id !== expected.productId || String(live.shop_id) !== expected.shopId || typeof live.visible !== "boolean")
      throw new Error("INVALID_PRODUCT")
    if (!previous) throw new Error("FIRST_PUBLISH_FIELDS_REQUIRED")
    // Hide/Show must not import or validate an unpublished design draft.
    return { ...previous, visible: live.visible }
  }
  const source = parsePrintifyProduct(live, expected)
  if (!source) throw new Error("INVALID_PRODUCT")
  if (!previous && (!event.publishDetails.title || !event.publishDetails.images || !event.publishDetails.variants)) {
    throw new Error("FIRST_PUBLISH_FIELDS_REQUIRED")
  }
  const snapshot: Record<string, unknown> = {
    ...(previous ?? { description: "", tags: [] }),
    id: live.id,
    shop_id: live.shop_id,
    created_at: previous?.created_at ?? live.created_at,
    blueprint_id: live.blueprint_id,
    print_provider_id: live.print_provider_id,
    print_areas: live.print_areas,
    print_details: live.print_details,
    visible: live.visible ?? true,
    storefront_artwork_enabled: previous?.storefront_artwork_enabled ?? false,
  }
  for (const field of [
    "title",
    "description",
    "images",
    "variants",
    "tags",
    "key_features",
    "shipping_template",
  ] as const) {
    if (event.publishDetails[field]) snapshot[field] = live[field]
  }
  if (event.publishDetails.variants) snapshot.options = live.options
  if (event.publishDetails.images && Array.isArray(snapshot.images)) {
    snapshot.images = snapshot.images.filter(
      (image) =>
        !image ||
        typeof image !== "object" ||
        !("is_selected_for_publishing" in image) ||
        image.is_selected_for_publishing !== false
    )
  }
  const candidate = parsePrintifyProduct(snapshot, expected)
  if (!candidate || !candidate.variants.some((variant) => variant.enabled)) throw new Error("NO_ENABLED_VARIANTS")
  const before = previous ? parsePrintifyProduct(previous, expected) : null
  for (const variant of candidate.variants.filter((variant) => variant.enabled)) {
    const current = source.variants.find((value) => value.id === variant.id)
    if (!current || current.fingerprint !== variant.fingerprint) throw new Error("PUBLISH_VARIANTS_REQUIRED")
    const old = before?.variants.find((value) => value.id === variant.id)
    const designChanged = old?.enabled
      ? old.designFingerprint !== variant.designFingerprint
      : before !== null &&
        !before.variants.some(
          (previous) => previous.enabled && previous.designFingerprint === variant.designFingerprint
        )
    if (designChanged) {
      snapshot.storefront_artwork_enabled = false
      delete snapshot.storefront_artwork
    }
    if (designChanged && !event.publishDetails.images) {
      throw new Error("DESIGN_CHANGE_REQUIRES_IMAGES")
    }
  }
  const catalog = normalizeCatalogProduct(snapshot)
  if (!catalog.image || !catalog.variants.length) throw new Error("NO_USABLE_MOCKUP")
  return snapshot
}
