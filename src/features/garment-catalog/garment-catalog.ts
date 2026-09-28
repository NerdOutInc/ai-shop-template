import type { garmentProfileOptions } from "./garment-profile-options"

export type GarmentGender = (typeof garmentProfileOptions.genders)[number]
export type GarmentAgeGroup = (typeof garmentProfileOptions.ageGroups)[number]
export type GarmentSizeSystem = (typeof garmentProfileOptions.sizeSystems)[number]

/** Saved garment identity for public product copy, independent of merchant-feed readiness. */
export type GarmentDisplayProfile = {
  manufacturer: string
  model: string
  categoryName: string | null
  categorySlug: string | null
  categorySortPosition: number | null
  gender: GarmentGender | null
}

/**
 * A shop category. The slug is the identity: it is fixed when the category is created because it
 * becomes URL state, so renaming changes `name` and nothing else.
 */
export type ShopCategory = {
  slug: string
  name: string
  /** Garments assigned to it. A category in use cannot be deleted. */
  garmentCount: number
}

/** Everything the owner sets on a garment. Null means "not chosen yet", which keeps it incomplete. */
export type GarmentSetup = {
  manufacturer: string
  model: string
  categorySlug: string | null
  /** Google's product taxonomy id, shared with Meta. */
  googleProductCategory: number | null
  gender: GarmentGender | null
  ageGroup: GarmentAgeGroup | null
  sizeSystem: GarmentSizeSystem | null
}

/**
 * One Printify blueprint as the Garment models page lists it.
 *
 * `known: false` is a blueprint found on published products that nobody has set up. It has no row,
 * so it has no name yet; no row means incomplete.
 */
export type AdminGarment = {
  blueprintId: number
  known: boolean
  /** The database's own answer (commerce.garment_models.complete), never recomputed here. */
  complete: boolean
  manufacturer: string | null
  model: string | null
  categorySlug: string | null
  googleProductCategory: number | null
  gender: GarmentGender | null
  ageGroup: GarmentAgeGroup | null
  sizeSystem: GarmentSizeSystem | null
  /** Active published products on this blueprint, hidden ones included. */
  productCount: number
  /** Of those, the ones shoppers can see right now. */
  shownCount: number
  /** Of those, the hidden ones with a reveal still to come. */
  scheduledCount: number
}

/** What the Products page needs to say "fix this garment" on a row. */
export type ProductGarmentStatus = {
  productId: string
  /** Null when the published snapshot carries no readable blueprint. */
  blueprintId: number | null
  complete: boolean
  /** "Next Level 6210" when the garment has a row, otherwise null. */
  label: string | null
}
