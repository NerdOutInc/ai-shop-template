/**
 * The public JSON catalog contract for AI shopping agents; see docs/agent-commerce.md.
 * Prices are decimal strings in the store currency. Variant ids are the provider variant ids the
 * cart and checkout already use, so an agent can hand them straight to a future WebMCP client.
 */
export type AgentCatalogVariant = {
  id: number
  sku: string
  color: string
  size: string
  price: string
  currency: "USD"
  available: boolean
  url: string
  images: string[]
}

export type AgentCatalogProduct = {
  id: string
  url: string
  title: string
  description: string
  brand: string
  category: string | null
  images: string[]
  /** Across the variants currently in stock; null when every variant is sold out. */
  priceRange: { min: string; max: string; currency: "USD" } | null
  colors: string[]
  sizes: string[]
  variants: AgentCatalogVariant[]
}

export type AgentCatalogStore = {
  name: string
  description: string
  url: string
  currency: "USD"
  shippingPolicyUrl: string
  returnPolicyUrl: string
  privacyUrl: string
}

export type AgentCatalog = {
  store: AgentCatalogStore
  products: AgentCatalogProduct[]
}
