/**
 * An arbitrary but fixed selection from the rest of the shop.
 *
 * "Random" here means unrelated to the shop's own order, not different every time. The selection is
 * seeded from the week's scheduled instant, so it changes when a new week arrives and
 * holds in between: the same four tees for every shopper, every request and every crawler, unless
 * one of those four itself leaves the shop.
 *
 * Literal randomness is wrong three ways here. Math.random() during render is impure and the linter
 * refuses it; per-request output fights the 300s read caches and makes a stable indexed page
 * impossible; and a browser test could then only assert "four cards" rather than which four.
 *
 * Pure on purpose - no clock, no global state - so it is legal directly in a server component body.
 */
export function pickMoreLikeThis<Product extends { id: string }>(
  seed: string,
  pool: readonly Product[],
  count: number
): Product[] {
  if (count <= 0) return []
  // Each tee gets its own rank from the drop and its own id, and the lowest ranks win. Ranking
  // rather than shuffling positions is what makes "fixed" true: a shuffle depends on the pool's
  // length and order, so hiding one unrelated tee, or the owner dragging the Featured lineup, would
  // deal a different four. Here a tee leaving the pool changes the pick only if it was in it.
  return pool
    .map((product) => ({ product, rank: hashText(`${seed}:${product.id}`) }))
    .toSorted((a, b) => a.rank - b.rank || (a.product.id < b.product.id ? -1 : 1))
    .slice(0, count)
    .map((entry) => entry.product)
}

/** FNV-1a, 32-bit. Any stable string-to-integer hash works; this one is fixed so tests can pin ids. */
function hashText(text: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}
