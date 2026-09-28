import { storeConfig } from "@/lib/store-config"
import type { CatalogProduct } from "./catalog-product"

const categoryLabels: Record<string, { categoryName: string; name: string; title: string; titlePattern: RegExp }> = {
  "t-shirts": {
    categoryName: "T-shirts",
    name: "tee",
    title: "T-Shirt",
    titlePattern: /\b(?:t[- ]?shirts?|tees?)\b/i,
  },
  "crop-tops": { categoryName: "Crop tops", name: "crop top", title: "Crop Top", titlePattern: /\bcrop[-\s]+tops?\b/i },
  "tank-tops": {
    categoryName: "Tank tops",
    name: "tank top",
    title: "Tank Top",
    titlePattern: /\btank[-\s]+tops?\b/i,
  },
  sweatshirts: {
    categoryName: "Sweatshirts",
    name: "sweatshirt",
    title: "Sweatshirt",
    titlePattern: /\bsweatshirts?\b/i,
  },
}

/** Display copy comes from the configured garment, never from a design's title or a default model. */
export function getProductGarmentLabels({ garment }: Pick<CatalogProduct, "garment">) {
  const savedCategoryName = garment?.categoryName?.trim() || null
  const seededCategory =
    garment?.categorySlug && Object.hasOwn(categoryLabels, garment.categorySlug)
      ? categoryLabels[garment.categorySlug]
      : undefined
  // Singular wording is known only for the seeded names. Preserve owner-created names and renames verbatim.
  const category =
    seededCategory?.categoryName.toLowerCase() === savedCategoryName?.toLowerCase() ? seededCategory : undefined
  const gender =
    garment?.gender === "female"
      ? "Women's"
      : garment?.gender === "male"
        ? "Men's"
        : garment?.gender === "unisex"
          ? "Unisex"
          : ""
  const typeLabel =
    category || savedCategoryName ? [gender, category?.name ?? savedCategoryName].filter(Boolean).join(" ") : null
  const descriptionType = category
    ? [gender.toLowerCase(), category.title === "T-Shirt" ? "T-shirt" : category.title.toLowerCase()]
        .filter(Boolean)
        .join(" ")
    : null

  return {
    modelLabel: garment ? [garment.manufacturer, garment.model].filter(Boolean).join(" ") : null,
    typeLabel,
    titleLabel: `${category?.title ?? savedCategoryName ?? "Apparel"}`,
    titlePattern:
      category?.titlePattern ??
      (savedCategoryName
        ? new RegExp(
            `(?<![\\p{L}\\p{N}])${savedCategoryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
            "iu"
          )
        : /\bapparel\b/i),
    description: descriptionType
      ? `A ${descriptionType} from ${storeConfig.name}.`
      : typeLabel
        ? `${typeLabel} from ${storeConfig.name}.`
        : `Apparel from ${storeConfig.name}.`,
  }
}
