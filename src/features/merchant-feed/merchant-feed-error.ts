const messages = {
  CONFIGURATION_INVALID: "Merchant catalog unavailable",
  STOCK_UNAVAILABLE: "Merchant catalog unavailable",
  DATABASE_UNAVAILABLE: "Merchant catalog unavailable",
  SNAPSHOT_DISPLAY_INVALID: "Merchant catalog unavailable",
  SNAPSHOT_PRODUCTION_INVALID: "Merchant catalog unavailable",
  SNAPSHOT_HIDDEN: "Merchant catalog unavailable",
  UNSUPPORTED_BLUEPRINT: "Merchant catalog unavailable",
  PROVIDER_HTTP_ERROR: "Merchant catalog unavailable",
  PROVIDER_UNAVAILABLE: "Merchant catalog unavailable",
  PROVIDER_RESPONSE_INVALID: "Merchant catalog unavailable",
  PROVIDER_TIMEOUT: "Merchant catalog unavailable",
  INVALID_PRODUCT_ID: "Merchant feed has invalid product identity or product URL",
  INVALID_VARIANT_ID: "Merchant feed has invalid variant identity or availability",
  INCOMPLETE_VARIANTS: "Merchant feed has incomplete variant data",
  INVALID_PRICE: "Merchant feed apparel requires a positive price",
  INVALID_TITLE: "Merchant feed has invalid item_group_title or title",
  INVALID_DESCRIPTION: "Merchant feed has invalid description",
  INVALID_FIELD: "Merchant feed has invalid field",
  INVALID_XML_TEXT: "Merchant feed contains invalid XML text",
  INVALID_IMAGE_FORMAT: "Merchant feed has unsupported image format",
  UNSUPPORTED_APPAREL: "Merchant feed has unsupported apparel profile",
  INVALID_ORIGIN: "Merchant feed requires a public HTTPS origin",
  UNKNOWN_ERROR: "Merchant catalog unavailable",
} as const

export type MerchantFeedErrorCode = keyof typeof messages

export class MerchantFeedError extends Error {
  readonly code: MerchantFeedErrorCode
  readonly productId?: string

  constructor(code: MerchantFeedErrorCode, productId?: unknown) {
    super(messages[code])
    this.code = code
    // Provider IDs are useful for repair; arbitrary source strings are never diagnostic context.
    if (typeof productId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(productId)) this.productId = productId
  }
}
