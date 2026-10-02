/** Full-precision subscriber revision and owned-row counts, compared again under the locks. */
export type SubscriberErasurePreview = {
  id: string
  updatedAt: string
  deliveries: number
  confirmations: number
}
