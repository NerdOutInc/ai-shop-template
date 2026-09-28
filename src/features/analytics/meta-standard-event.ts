export type MetaCommerceItem = {
  productId: string
  variantId: number
  quantity: number
  unitAmount: number
}

export type MetaPurchaseConversion = {
  receipt: string
  totalUsd: number
  items: readonly MetaCommerceItem[]
}

export type MetaStandardEventInput =
  | { name: "ViewContent"; productId: string; variant?: { variantId: number; unitAmount: number } }
  | { name: "AddToCart" | "InitiateCheckout"; items: readonly MetaCommerceItem[] }
  | { name: "Purchase"; purchase: MetaPurchaseConversion }

type MetaProductGroupParameters = { content_type: "product_group"; content_ids: string[] }

type MetaProductParameters = {
  content_type: "product"
  content_ids: string[]
  contents: { id: string; quantity: number; item_price: number }[]
  currency: "USD"
  value: number
  num_items: number
}

export type MetaStandardEvent =
  | { name: "ViewContent"; parameters: MetaProductGroupParameters | MetaProductParameters }
  | { name: "AddToCart"; parameters: MetaProductParameters }
  | { name: "InitiateCheckout"; parameters: MetaProductParameters }
  | { name: "Purchase"; parameters: MetaProductParameters }
