import { z } from "zod"

import { garmentSetupSchema } from "./garment-setup-schema"

/** The feed uses the same apparel values as setup, with no unset fields. */
export const garmentFeedProfileSchema = z.object({
  googleProductCategory: garmentSetupSchema.shape.googleProductCategory.unwrap(),
  gender: garmentSetupSchema.shape.gender.unwrap(),
  ageGroup: garmentSetupSchema.shape.ageGroup.unwrap(),
  sizeSystem: garmentSetupSchema.shape.sizeSystem.unwrap(),
})

export type GarmentFeedProfile = z.infer<typeof garmentFeedProfileSchema>
