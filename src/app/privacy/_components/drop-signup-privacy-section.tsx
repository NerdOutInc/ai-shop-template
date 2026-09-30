import "server-only"

import { dropConsentCopy } from "@/features/drop-signup/drop-consent-copy"
import { DropRemovalLink } from "@/features/drop-signup/drop-removal-link"
import { env } from "@/lib/env"
import { storeConfig } from "@/lib/store-config"

export function DropSignupPrivacySection() {
  const signupOpen = storeConfig.features.dropSignup && storeConfig.policies.published
  if (!storeConfig.configured || (!signupOpen && !storeConfig.privacy.retainedDropSubscribers)) return null
  // Delivery records outlive a pause in sending, so they are described while the owner keeps them, not
  // only while emails go out. The sender waits for this same switch (read-drop-email-setup.server.ts).
  const dropEmailRecords = storeConfig.privacy.retainedDropEmailRecords
  const sending =
    dropEmailRecords &&
    env.DROP_EMAILS_ENABLED === "true" &&
    storeConfig.features.designOfTheWeek &&
    storeConfig.policies.published

  return (
    <>
      <h2>Design-drop emails</h2>
      {signupOpen ? (
        <p>The signup form’s current consent wording is: “{dropConsentCopy.text}”</p>
      ) : (
        <p>New signups are currently closed. Existing subscribers can still request removal from the list.</p>
      )}
      <p>
        If you signed up, the store keeps your email address, where you signed up, the consent wording version and time,
        and the signup IP address when supplied by the hosting platform. It also keeps signup update times and
        unsubscribe history. The IP address and a separate rate-limit record help limit abusive submissions.
      </p>
      {dropEmailRecords && (
        <p>
          {sending
            ? "When a new Design of the Week goes live, the store emails subscribers about it once. That is the only email this list sends."
            : "The store is not sending drop emails right now."}{" "}
          Drop emails go through Resend, the store’s email provider, which receives each recipient’s address and the
          message in order to deliver it. Every drop email has an unsubscribe link, and a mail app’s own unsubscribe
          button works too. The store keeps a record of which drop emails it has sent to each subscriber and when. Links
          in them carry a label naming the drop, so an order that started from one can be recognized; the label
          identifies the email, not you.
        </p>
      )}
      {signupOpen && <p>Signing up again renews consent and can reactivate a previously unsubscribed address.</p>}
      <p>
        <DropRemovalLink />. Send your request from the address that receives the emails. Requests are handled by the
        store’s support team; opening the email link does not remove an address automatically. This request concerns
        design-drop emails, not order receipts or support messages.
      </p>
    </>
  )
}
