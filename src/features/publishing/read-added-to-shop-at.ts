/**
 * When a product most recently entered the shop, for a row already known to be on the wall.
 *
 * The column alone is not the answer. A timed reveal (a Design of the Week) writes nothing when its
 * moment passes, so a product the clock brought back still carries the stamp from its previous
 * visit, and its arrival is the reveal itself until the owner's next hide or show settles it into
 * added_to_shop_at. The later of the two is right either way: a pending reveal only exists while a
 * product is hidden, so any stamp it could outrank is from before that hide.
 *
 * Only meaningful for a product that passed the reveal gate. For one still waiting, the reveal is a
 * promise rather than an arrival, so callers apply the gate first and this never looks at a clock.
 */
export function readAddedToShopAt(row: { addedToShopAt: string | null; revealAt: string | null }): string | null {
  const stamp = row.addedToShopAt === null ? Number.NaN : Date.parse(row.addedToShopAt)
  const reveal = row.revealAt === null ? Number.NaN : Date.parse(row.revealAt)
  if (!Number.isFinite(reveal)) return Number.isFinite(stamp) ? row.addedToShopAt : null
  return Number.isFinite(stamp) && stamp >= reveal ? row.addedToShopAt : row.revealAt
}
