import type { AdminGarment } from "./garment-catalog"

/**
 * What a garment is called on the page: "Next Level 6210" once the owner has named it, and its
 * blueprint number until then, which is all a blueprint found on published products has.
 */
export function garmentDisplayName({
  blueprintId,
  manufacturer,
  model,
}: Pick<AdminGarment, "blueprintId" | "manufacturer" | "model">) {
  return (
    [manufacturer, model]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ") || `Blueprint ${blueprintId}`
  )
}
