import { GARMENT_COLORS, type GarmentColor } from "@/features/design-library/garment-colors"
import type { LibraryDesign } from "@/features/design-library/library-types"

/**
 * The garment colours offered for a design, in their saved order.
 *
 * A saved name the palette no longer lists is kept and rendered from its position in the
 * design rather than dropped, so a retired Printify colour stays visible as a decision to
 * revisit instead of quietly disappearing from the card.
 */
export function getDesignGarmentColors(design: Pick<LibraryDesign, "colors">): GarmentColor[] {
  return design.colors
    .toSorted((first, second) => first.position - second.position)
    .map(
      (color) => GARMENT_COLORS.find((garment) => garment.name === color.name) ?? { name: color.name, hex: "#ffffff" }
    )
}
