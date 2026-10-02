/** The provider payload shared by transactional confirmation and drop announcements. */
export type SingleRecipientEmailMessage = {
  from: string
  to: [string]
  reply_to: string
  subject: string
  html: string
  text: string
  headers?: Record<string, string>
}
