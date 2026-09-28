const detailSection =
  /^(?:(?:the )?(?:tee|t-shirt|shirt|garment)|product (?:details|features)|care(?: instructions)?|size guide|sizing|materials?)[\s:]*$/i

/** Whether a line of a product description titles a garment, care or sizing section. */
export function isGarmentDetailHeading(text: string) {
  return detailSection.test(text)
}
