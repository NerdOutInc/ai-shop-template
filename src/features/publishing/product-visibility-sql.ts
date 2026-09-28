import "server-only"

const hiddenAt = (clock: string) => `hidden_at is not null and (reveal_at is null or reveal_at > ${clock})`
const revealedAt = (clock: string) => `hidden_at is not null and reveal_at is not null and reveal_at <= ${clock}`

/**
 * Every form of "the shop shows this product", split by what makes each go stale rather than by
 * where it is convenient. Interpolated by the publishing, garment, and product-schedule Postgres
 * stores in src/features/publishing and nowhere else.
 *
 * `active` stays Printify's own answer and is ANDed here rather than merged: activate() rewrites it
 * from the provider snapshot on every publish, so the owner's decision has to live beside it.
 */
export const productVisibilitySql = {
  /**
   * The candidate set for a CACHED read: every row the shop will show without another write.
   * Safe inside unstable_cache because it only changes when someone writes, and a write
   * revalidates the tag. The caller must finish the gate with hasRevealArrived().
   */
  revealable: "active and (hidden_at is null or reveal_at is not null)",
  /**
   * The whole gate, for every UNCACHED read. Written out rather than leaning on `reveal_at <= now()`
   * returning NULL for an indefinite hide: a purchasability boundary must not rest on
   * three-valued logic.
   */
  shown: "active and (hidden_at is null or (reveal_at is not null and reveal_at <= now()))",
  /**
   * Off the wall RIGHT NOW, for writers. `hidden_at is not null` alone is not this: a timed reveal
   * writes nothing, so a product the clock revealed keeps its hidden_at for good while it sells.
   */
  hiddenNow: hiddenAt("now()"),
  /** A queued mutation must not undo a reveal that arrived while it waited for a row lock. */
  hiddenAtWrite: hiddenAt("clock_timestamp()"),
  /** On the wall only because its moment passed; the launch record has not been written yet. */
  revealedByClock: revealedAt("now()"),
  revealedAtWrite: revealedAt("clock_timestamp()"),
}
