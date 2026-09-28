/**
 * The closed sets Google and Meta accept for apparel, mirrored by the checks on
 * commerce.garment_models. One object rather than three files because they are one fact: what a
 * garment's feed profile may say.
 */
export const garmentProfileOptions = {
  genders: ["male", "female", "unisex"],
  ageGroups: ["newborn", "infant", "toddler", "kids", "adult"],
  sizeSystems: ["US", "UK", "EU", "DE", "FR", "IT", "JP", "CN", "BR", "MEX", "AU"],
} as const
