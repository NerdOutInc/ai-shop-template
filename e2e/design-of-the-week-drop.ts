const sha = "d0".repeat(32)
const revisionId = "00000000-0000-4000-8000-00000000d0d0"

/** Explicit weekly membership is independent of the product artwork used by catalog previews. */
export const designOfTheWeekDrop = {
  revisionId,
  /** Selected products, deliberately outside 0-2 which other specs pin. */
  productIndexes: [3, 4, 5],
  /** Product 6 shares artwork but was not picked; product 5 was picked without this artwork. */
  artworkProductIndexes: [3, 4, 6],
  artwork: {
    src: `https://fixture.public.blob.vercel-storage.com/published-artwork/v1/${sha}.webp`,
    revisionId,
    productionFingerprint: `artwork-v1:${sha}`,
    width: 940,
    height: 1200,
  },
}
