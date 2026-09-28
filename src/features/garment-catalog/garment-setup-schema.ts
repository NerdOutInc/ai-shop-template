import { z } from "zod"

import type { GarmentSetup } from "./garment-catalog"

import { garmentProfileOptions } from "./garment-profile-options"

/**
 * The body of a garment save, and nothing looser than commerce.garment_models will store.
 *
 * Every key is required and null is how a field says "not chosen yet". An optional key would let a
 * client that forgot a field clear it, and a garment that silently loses its category stops being
 * complete. Whether the result IS complete is never decided here: that is the table's generated
 * `complete` column, and this schema only says what may be written.
 *
 * Strict, so a body carrying `complete` or `blueprintId` is refused rather than quietly ignored.
 */
// No control characters, as in categoryNameSchema: Postgres cannot store U+0000 in text, no table
// check says so, and trim() does not remove it, so without this the refusal is a 503.
const garmentNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^\P{Cc}*$/u)

export const garmentSetupSchema = z
  .object({
    manufacturer: garmentNameSchema,
    model: garmentNameSchema,
    // Same pattern and length as the check on commerce.shop_categories.slug.
    categorySlug: z
      .string()
      .max(64)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      .nullable(),
    // Google's taxonomy ids run to six digits today. The cap keeps a typo from becoming a 503 at
    // the integer column; whether the id exists in the taxonomy is not something this slice checks.
    googleProductCategory: z.number().int().min(1).max(999_999).nullable(),
    gender: z.enum(garmentProfileOptions.genders).nullable(),
    ageGroup: z.enum(garmentProfileOptions.ageGroups).nullable(),
    sizeSystem: z.enum(garmentProfileOptions.sizeSystems).nullable(),
  })
  .strict() satisfies z.ZodType<GarmentSetup>
