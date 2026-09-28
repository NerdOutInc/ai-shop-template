import type { LibraryStoredAsset } from "@/features/design-library/library-types"

export type DesignDraftRecipe = {
  blueprintId: number
  productModelLabel: string
  printProviderId: number
  variants: { id: number; price: number; color: string; size: string }[]
  placement: { position: "front"; x: number; y: number; scale: number; angle: number }
  description: string
  titleTemplate: string
}
export type DesignDraftInput = {
  requestId: string
  selection:
    | { kind: "numbers"; numbers: number[] }
    | { kind: "favorites" }
    | { kind: "revisions"; items: { designId: string; revisionId: string }[] }
  recipe: DesignDraftRecipe
}
export type DesignDraftResult = {
  designId: string
  requestedRevisionId: string
  boundRevisionId: string | null
  productId: string | null
  status:
    "draft" | "published" | "revision-mismatch" | "needs-reconciliation" | "needs-input" | "busy" | "reserved-elsewhere"
  message: string
  storefrontUrl: string | null
  blockingProductIds: string[]
  owningRequestId: string | null
}
/** One garment the provider makes for a model, as its own catalogue names it. */
export type DesignCatalogVariant = {
  id: number
  color: string
  size: string
  /** False when the provider cannot make it right now, or cannot print the front by DTG. */
  available: boolean
}
export type DesignProductPayload = {
  title: string
  description: string
  blueprint_id: number
  print_provider_id: number
  variants: { id: number; price: number; is_enabled: true }[]
  print_areas: {
    variant_ids: number[]
    placeholders: { position: "front"; images: { id: string; x: number; y: number; scale: number; angle: number }[] }[]
  }[]
}
export type DesignDraftClient = {
  shopId: string
  listProducts: () => Promise<Record<string, unknown>[]>
  getProduct: (productId: string) => Promise<Record<string, unknown> | null>
  validateRecipe: (recipe: DesignDraftRecipe) => Promise<void>
  uploadImage: (input: {
    fileName: string
    url: string
  }) => Promise<{ id: string; width: number; height: number; mimeType: string }>
  createProduct: (payload: DesignProductPayload) => Promise<{ id: string }>
}
export type FrozenDesignSelection = {
  designId: string
  canonicalDesignId: string
  displayNumber: number
  title: string
  revisionId: string
  asset: LibraryStoredAsset
}
