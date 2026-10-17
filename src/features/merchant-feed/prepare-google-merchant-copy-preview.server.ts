import "server-only"

import { isDeepStrictEqual } from "node:util"
import { feedDescription } from "./feed-description"

import { catalogProductSchema } from "@/features/catalog/catalog-product-schema"
import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import { garmentFeedProfileSchema } from "@/features/garment-catalog/garment-feed-profile-schema"
import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"

import { googleMerchantCopySchema, type GoogleMerchantCopy } from "./google-merchant-copy-schema"
import type { GoogleCopyEditorState, GoogleCopyPreview } from "./google-merchant-copy-editor-state"
import type { GoogleCopyPreviewInput } from "./google-merchant-copy-preview-request"
import type { GoogleCopyEditorRead } from "./read-google-merchant-copy-editor.server"
import { googleCopySharedFactsHash } from "./google-copy-shared-facts-hash"
import { googleMerchantCopyReviewDigest } from "./google-merchant-copy-review-digest"
import { prepareMerchantProduct } from "./prepare-merchant-product.server"
import { resolveGoogleMerchantCopy } from "./resolve-google-merchant-copy"
import { validateGoogleCopyApproval } from "./validate-google-copy-approval"

export function prepareGoogleMerchantCopyPreview(
  read: GoogleCopyEditorRead,
  input?: GoogleCopyPreviewInput | { expectedRevision: string; copy: GoogleMerchantCopy }
): { state: GoogleCopyEditorState; preview: GoogleCopyPreview | null } {
  const { snapshot, revision, profiles, shopId, productId, provenance } = read
  const raw = snapshot?.google_merchant_copy
  const parsed = googleMerchantCopySchema.safeParse(raw)
  const savedCopy = parsed.success ? parsed.data : null
  const metadata: GoogleCopyEditorState["metadata"] = {
    ...(savedCopy && Object.hasOwn(savedCopy, "pattern") ? { pattern: savedCopy.pattern } : {}),
    ...(savedCopy && Object.hasOwn(savedCopy, "materials") ? { materials: savedCopy.materials } : {}),
  }
  const originLocked =
    provenance === "generated" ||
    (raw !== null && typeof raw === "object" && "origin" in raw && raw.origin === "generated")
  const state: GoogleCopyEditorState = {
    expectedRevision: revision,
    blocked:
      !read.active || !snapshot ? "GOOGLE_COPY_INVALID_TARGET" : read.blocked ? "GOOGLE_COPY_WRITE_BLOCKED" : null,
    content: savedCopy?.content ?? "",
    origin: originLocked ? "generated" : provenance === "incomplete" ? null : (savedCopy?.origin ?? null),
    originLocked,
    metadata,
    variants: [],
    issues: provenance === "incomplete" ? [{ code: "GOOGLE_COPY_PROVENANCE_INCOMPLETE" }] : [],
    savedCopy,
  }
  if (raw !== undefined && !parsed.success) state.blocked = "GOOGLE_COPY_INVALID_RECORD"
  const display = catalogProductSchema.safeParse(snapshot)
  const product = display.success ? normalizeCatalogProduct(display.data) : null
  const production = product && snapshot ? parsePrintifyProduct(snapshot, { productId, shopId }) : null
  const profile =
    snapshot && typeof snapshot.blueprint_id === "number" ? profiles.get(snapshot.blueprint_id) : undefined
  if (!product || !production) state.blocked ??= "GOOGLE_COPY_INVALID_SNAPSHOT"
  if (!profile || !garmentFeedProfileSchema.safeParse(profile).success)
    state.blocked ??= "GOOGLE_COPY_UNSUPPORTED_BLUEPRINT"
  if (state.blocked || !product || !production || !snapshot || !profile) {
    if (input) throw new Error(state.blocked ?? "GOOGLE_COPY_INVALID_SNAPSHOT")
    return { state, preview: null }
  }
  const previous = resolveGoogleMerchantCopy(raw, product, production, profile)
  state.issues.push(...previous.issues)
  const ids = new Set<number>()
  state.variants = display.data!.variants.map((variant) => {
    ids.add(variant.id)
    const current = product.variants.find((v) => v.id === variant.id)
    const identity = production.variants.find((v) => v.id === variant.id)
    const selectable = Boolean(current?.color && current.size && identity)
    const selected = selectable && previous.variants.has(variant.id)
    const issue =
      previous.issues.find((v) => v.variantId === variant.id) ?? previous.issues.find((v) => v.variantId === undefined)
    return {
      id: variant.id,
      label: identity?.label ?? variant.title ?? `Variant ${variant.id}`,
      selectable,
      selected,
      reason: !variant.is_enabled
        ? "DISABLED_VARIANT"
        : !selectable
          ? "MISSING_COLOR_OR_SIZE"
          : selected
            ? null
            : (issue?.code ?? "UNCOVERED_VARIANT"),
    }
  })
  for (const variant of savedCopy?.reviewed_variants ?? []) {
    if (!ids.has(variant.id))
      state.variants.push({
        id: variant.id,
        label: variant.label,
        selectable: false,
        selected: false,
        reason: "REMOVED_VARIANT",
      })
  }
  if (!input) return { state, preview: null }
  if (input.expectedRevision !== revision) throw new Error("GOOGLE_COPY_REVISION_CHANGED")
  if ("copy" in input) {
    // An unkeyed digest cannot authorize replacement of saved, noneditable metadata.
    for (const key of ["pattern", "materials"] as const) {
      if (
        Object.hasOwn(metadata, key) !== Object.hasOwn(input.copy, key) ||
        !isDeepStrictEqual(metadata[key], input.copy[key])
      )
        throw new Error("GOOGLE_COPY_METADATA_CONFLICT")
    }
    validateGoogleCopyApproval(input.copy, snapshot, shopId, profile, provenance)
    return { state, preview: null }
  }
  const reviewed = input.variantIds.map((id) => {
    const variant = product.variants.find((v) => v.id === id)
    const identity = production.variants.find((v) => v.id === id)
    if (!variant?.color || !variant.size || !identity) throw new Error("GOOGLE_COPY_INVALID_SELECTION")
    return { id, fingerprint: identity.fingerprint, label: identity.label, color: variant.color, size: variant.size }
  })
  // Direct non-HTTP callers also need the coverage guard; TypeScript cannot express it.
  if (!reviewed.length || new Set(input.variantIds).size !== reviewed.length)
    throw new Error("GOOGLE_COPY_INVALID_SELECTION")
  if (Object.keys(metadata.materials ?? {}).some((color) => !reviewed.some((v) => v.color === color)))
    throw new Error("GOOGLE_COPY_METADATA_CONFLICT")
  const { copy, resolved } = validateGoogleCopyApproval(
    {
      version: 1,
      content: input.content,
      origin: input.origin,
      shared_facts_hash: googleCopySharedFactsHash(product, profile),
      reviewed_variants: reviewed,
      ...metadata,
    },
    snapshot,
    shopId,
    profile,
    provenance
  )
  // Validate the whole saved group with the emitter's exact constraints; no provider or stock read.
  try {
    prepareMerchantProduct(
      { ...snapshot, google_merchant_copy: copy },
      shopId,
      new URL("https://preview.invalid"),
      profiles
    )
  } catch {
    throw new Error("GOOGLE_COPY_INVALID_SNAPSHOT")
  }
  const fallback = feedDescription(product)
  const preview: GoogleCopyPreview = {
    expectedRevision: revision,
    copy,
    digest: googleMerchantCopyReviewDigest(shopId, productId, revision, copy),
    descriptions: product.variants.map((v) => {
      const next = resolved.variants.get(v.id)
      const before = previous.variants.get(v.id)
      return {
        id: v.id,
        label: production.variants.find((p) => p.id === v.id)!.label,
        content: next?.content ?? fallback,
        origin: next?.origin ?? "fallback",
        previousContent: before?.content ?? fallback,
        effect: next ? (before ? "retained" : "added") : before ? "removed" : "fallback",
        ...(next?.pattern !== undefined ? { pattern: next.pattern } : {}),
        ...(next?.material !== undefined ? { material: next.material } : {}),
      }
    }),
  }
  return { state, preview }
}
