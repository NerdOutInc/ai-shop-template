/** One drop's email, as the admin history shows it. Counts only, never an address. */
export type DropEmailHistoryEntry = {
  liveAt: string
  subject: string
  productCount: number
  recipients: number
  sent: number
  /** Queued or unconfirmed: still being worked on. */
  pending: number
  /** Refused by Resend, or never confirmed before its chance passed. */
  failed: number
  unsubscribed: number
  firstSentAt: string | null
  lastSentAt: string | null
}
