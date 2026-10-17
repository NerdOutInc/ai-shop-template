import { MerchantFeedError } from "./merchant-feed-error"

export function escapeMerchantXml(value: string) {
  const hasInvalidCharacter = [...value].some((character) => {
    const point = character.codePointAt(0)!
    return !(
      point === 9 ||
      point === 10 ||
      point === 13 ||
      (point >= 32 && point <= 0xd7ff) ||
      (point >= 0xe000 && point <= 0xfffd) ||
      point >= 0x10000
    )
  })
  if (hasInvalidCharacter) throw new MerchantFeedError("INVALID_XML_TEXT")
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}
