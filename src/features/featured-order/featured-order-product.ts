export type FeaturedOrderProduct = {
  id: string
  title: string
  image: { src: string; alt: string } | null
  /** When the owner hid it. Null means the shop is showing it. */
  hiddenAt: string | null
  /** A scheduled end to the hide, so the page can say when it comes back rather than just "hidden". */
  revealAt: string | null
  /** When shoppers could first see it, so a product that has never been on the wall reads differently. */
  revealedAt: string | null
  /**
   * The stored arrival: the last Show in shop, or a timed reveal settled by a later hide or show.
   * Read it through readAddedToShopAt, which also counts a reveal that has arrived since.
   */
  addedToShopAt: string | null
  /**
   * Present only while the product's garment still needs a category and apparel details, which is
   * when the server refuses to show or schedule it. `label` is the garment's name once it has one
   * ("Next Level 6210"); `blueprintId` is null when the published snapshot names no readable garment.
   *
   * Optional so every existing render site keeps working, and because the Products page reads it
   * separately and fail-soft: absent means "complete, or could not tell", never a promise.
   */
  garmentSetup?: { blueprintId: number | null; label: string | null } | null
}
