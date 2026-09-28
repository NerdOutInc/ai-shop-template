export type LibraryAsset = {
  id: string
  url: string
  kind: "original" | "print" | "preview"
  status: "pending" | "ready" | "unavailable"
  mimeType: string
  width: number | null
  height: number | null
  bytes: number | null
  sha256: string | null
  pixelSha256: string | null
  perceptualHash: string | null
  hasAlpha: boolean | null
  hasTransparency: boolean | null
  enlarged: boolean | null
}

/** Server-only location fields must never be serialized into gallery props. */
export type LibraryStoredAsset = LibraryAsset & {
  pathname: string | null
  sourcePath: string | null
  originalFilename: string
}

export type LibraryArtworkRevision = {
  id: string
  designId: string
  original: LibraryAsset | null
  print: LibraryAsset | null
  preview: LibraryAsset | null
  printReadiness: "unverified" | "needs-preparation" | "ready"
  printNotes: string | null
  widthInches: number | null
  heightInches: number | null
  nativePpi: number | null
  createdAt: string
}

export type LibraryProductStatus =
  "unverified" | "reserved" | "creating" | "draft" | "published" | "needs-reconciliation" | "removed"

export type LibraryProductUse = {
  id: string
  shopId: string
  productId: string | null
  productModelId: string
  productModelLabel: string
  revisionId: string | null
  status: LibraryProductStatus
  verifiedAt: string | null
  storefrontUrl: string | null
}

/** A garment colour offered for a design. `name` joins GARMENT_COLORS, which owns the swatch. */
export type LibraryDesignColor = {
  name: string
  position: number
  source: "assigned" | "printify" | "promoted"
}

export type LibraryDesign = {
  id: string
  canonicalDesignId: string
  displayNumber: number
  title: string
  family: string
  summary: string
  mechanism: string
  prompt: string
  background: { name: string; hex: string } | null
  state: "active" | "archived" | "rejected"
  collectionIds: string[]
  revision: LibraryArtworkRevision | null
  revisions: LibraryArtworkRevision[]
  favoriteRevisionId: string | null
  favoriteColorName: string | null
  colors: LibraryDesignColor[]
  products: LibraryProductUse[]
}

export type LibraryCollection = {
  id: string
  title: string
  description: string | null
  designCount: number
}

export type LibraryDesignFilter = {
  includePending?: boolean
  /**
   * Omitted shows only active designs, so archived and rejected work stays out of the
   * library. "all" is for callers that must see every retained design, such as the agent's
   * duplicate check, which cannot avoid repeating an idea it is not allowed to look at.
   */
  designState?: LibraryDesign["state"] | "all"
  search?: string
  collectionId?: string
  family?: string
  productModelId?: string
  status?: "no-product" | "draft" | "published" | "needs-artwork" | "unverified"
  favoritesOnly?: boolean
  limit?: number
  offset?: number
}

export type LibraryRevisionInput = {
  id: string
  assets: LibraryStoredAsset[]
  printReadiness: LibraryArtworkRevision["printReadiness"]
  printNotes: string | null
  widthInches: number | null
  heightInches: number | null
  nativePpi: number | null
}

export type LibraryDesignInput = {
  id: string
  displayNumber?: number
  title: string
  family: string
  summary: string
  mechanism: string
  prompt: string
  background: LibraryDesign["background"]
  state: LibraryDesign["state"]
  collectionIds: string[]
  revision: LibraryRevisionInput
}
