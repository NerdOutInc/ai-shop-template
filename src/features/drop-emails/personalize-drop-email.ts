import type { DropEmailMessage, FrozenDropEmail } from "./drop-email-message"
import { dropEmailSubscriberPlaceholder } from "./drop-email-subscriber-placeholder"
import { dropUnsubscribeUrls } from "./drop-unsubscribe-urls"

/** The one email this subscriber gets: the frozen copy with their own unsubscribe links filled in. */
export function personalizeDropEmail(
  frozen: FrozenDropEmail,
  subscriber: { id: string; email: string },
  siteUrl: string
): DropEmailMessage {
  const fill = (value: string) => value.replaceAll(dropEmailSubscriberPlaceholder, subscriber.id)
  return {
    from: frozen.fromAddress,
    to: [subscriber.email],
    reply_to: frozen.replyTo,
    subject: frozen.subject,
    html: fill(frozen.html),
    text: fill(frozen.textBody),
    headers: {
      "List-Unsubscribe": `<${dropUnsubscribeUrls(siteUrl, subscriber.id).oneClick}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  }
}
