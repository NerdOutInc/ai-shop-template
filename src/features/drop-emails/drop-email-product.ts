/** What a drop email shows of one product: public shop data only, never design-library records. */
export type DropEmailProduct = {
  id: string
  title: string
  /** Absolute https, because an email has no page to resolve a relative path against. */
  image: { src: string; alt: string } | null
  /** Cents, as the catalog keeps them. */
  price: { min: number; max: number } | null
}
