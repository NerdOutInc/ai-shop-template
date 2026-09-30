/** The body of one Resend send, in its field names. Exactly one recipient, always. */
export type DropEmailMessage = {
  from: string
  to: [string]
  reply_to: string
  subject: string
  html: string
  text: string
  headers: { "List-Unsubscribe": string; "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
}

/** A drop email as frozen in commerce.drop_emails, before any one subscriber's link is filled in. */
export type FrozenDropEmail = {
  fromAddress: string
  replyTo: string
  subject: string
  html: string
  textBody: string
  /** Where its links point, frozen with it so a retry never changes the payload under its key. */
  siteOrigin: string
}
