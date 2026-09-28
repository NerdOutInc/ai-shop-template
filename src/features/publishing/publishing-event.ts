export type PublishingEvent = {
  id: string
  productId: string
  shopId: string
  createdAt: string
  action: "create" | "update" | "delete"
  publishDetails: Partial<
    Record<"title" | "description" | "images" | "variants" | "tags" | "key_features" | "shipping_template", boolean>
  >
}
