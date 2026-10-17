import { MerchantFeedError } from "./merchant-feed-error"
import { escapeMerchantXml } from "./escape-merchant-xml"

export function merchantField(name: string, value: string, limit: number) {
  if (!value.trim() || [...value].length > limit) {
    throw new MerchantFeedError(
      name === "description"
        ? "INVALID_DESCRIPTION"
        : ["title", "item_group_title"].includes(name)
          ? "INVALID_TITLE"
          : "INVALID_FIELD"
    )
  }
  return `<g:${name}>${escapeMerchantXml(value)}</g:${name}>`
}
