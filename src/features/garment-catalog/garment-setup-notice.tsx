import Link from "next/link"

type GarmentSetupNoticeProps = {
  /** Null when the published snapshot names no readable blueprint, so there is no card to land on. */
  blueprintId: number | null
  /** "Next Level 6210" once the garment has a name; null for a blueprint nobody has set up. */
  label: string | null
  productTitle: string
  /** Lets a disabled Show button point at this sentence as its reason. */
  id?: string
}

/**
 * Says why a product cannot be shown or scheduled, and links to the one place that fixes it.
 *
 * The garment is assigned once per blueprint, so the link targets that blueprint's card rather than
 * anything about this product. It lives in this feature, not in the Products route, because the
 * lineup rows that render it are a feature and features may not import from src/app.
 */
export function GarmentSetupNotice({ blueprintId, label, productTitle, id }: GarmentSetupNoticeProps) {
  const href = blueprintId === null ? "/admin/products/garments" : `/admin/products/garments#garment-${blueprintId}`
  const action =
    blueprintId === null ? "Open Garment models" : `Set up ${label?.trim() ? label : `blueprint ${blueprintId}`}`
  return (
    <p id={id} className="text-sm text-destructive">
      Garment setup missing.{" "}
      {/* Every row repeats this link, so the product is named for anyone reading a list of links. */}
      <Link href={href} className="inline-flex min-h-11 items-center underline underline-offset-4">
        {action} <span className="sr-only">for {productTitle}</span>
      </Link>
    </p>
  )
}
