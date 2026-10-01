import { storeConfig } from "@/lib/store-config"
import type { SingleRecipientEmailMessage } from "@/lib/single-recipient-email-message"

/** This message asks for inbox ownership; it contains no products, tracking or campaign links. */
export function renderSignupConfirmation(input: {
  token: string
  from: string
  siteUrl: string
  replyTo: string
}): SingleRecipientEmailMessage {
  const url = new URL("/confirm-signup", input.siteUrl)
  url.hash = input.token
  const text = `Confirm your ${storeConfig.name} design-drop signup\n\nUse this link, then choose Confirm signup: ${url.href}\n\nThe link expires in 24 hours. After you confirm, we'll email you when a new design drops. You can unsubscribe in every drop email or contact our support team.\n\nIf you didn't ask for this, ignore this email. You won't be added by opening the link.`
  return {
    from: input.from,
    to: ["placeholder@example.com"],
    reply_to: input.replyTo,
    subject: `Confirm your ${storeConfig.name} signup`,
    text,
    html: `<h1>Confirm your design-drop signup</h1><p>One last move: confirm this inbox is yours.</p><p><a href="${url.href}">Confirm signup</a></p><p>The link expires in 24 hours. After you confirm, we'll email you when a new design drops. You can unsubscribe in every drop email or contact our support team.</p><p>If you didn't ask for this, ignore this email. Opening the link won't add you.</p>`,
  }
}
