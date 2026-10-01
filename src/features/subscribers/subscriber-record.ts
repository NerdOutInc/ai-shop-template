export type SubscriberRecord = {
  id: string
  email: string
  state: "legacy" | "pending" | "confirmed"
  eligible: boolean
  source: string
  consentVersion: string
  signupIp: string | null
  createdAt: string
  consentedAt: string
  confirmedAt: string | null
  unsubscribedAt: string | null
  lastUnsubscribedAt: string | null
  updatedAt: string
  deliveries: number
  confirmations: number
}
