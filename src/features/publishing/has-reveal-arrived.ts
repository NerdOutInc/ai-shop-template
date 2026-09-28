/**
 * The clock half of the reveal gate, applied to rows that already passed
 * productVisibilitySql.revealable in SQL.
 *
 * It lives outside the cache on purpose. A reveal happens with no write anywhere, so nothing calls
 * revalidateTag when the moment passes; a `reveal_at <= now()` inside unstable_cache would keep
 * serving the pre-reveal answer for the rest of the window.
 *
 * Named after the half it tests rather than isProductVisible, because a function called "is visible"
 * invites deciding visibility from a row that was never filtered in SQL. An unparseable moment
 * withholds the product, so malformed storage data fails closed.
 */
export function hasRevealArrived(row: { revealAt: string | null }, now: number): boolean {
  if (row.revealAt === null) return true
  const revealAt = Date.parse(row.revealAt)
  return Number.isFinite(revealAt) && revealAt <= now
}
