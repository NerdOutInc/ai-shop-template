/**
 * One spelling per address, so a second signup updates a row rather than creating a twin.
 *
 * Lowercasing the whole address is a deliberate, conservative choice. The local part is technically
 * case-sensitive, but no mail provider anyone uses treats it that way, and the alternative — storing
 * two rows for Shopper@ and shopper@ — means mailing the same person twice.
 *
 * Plus-addressing is NOT stripped. `shopper+gear@` is a real, separate inbox the person chose, and
 * collapsing it would silently merge two people who deliberately kept themselves apart.
 */
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}
