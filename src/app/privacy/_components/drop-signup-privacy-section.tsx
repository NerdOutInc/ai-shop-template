import { dropConsentCopy } from "@/features/drop-signup/drop-consent-copy"
import { DropRemovalLink } from "@/features/drop-signup/drop-removal-link"
import { storeConfig } from "@/lib/store-config"

export function DropSignupPrivacySection() {
  const signupOpen = storeConfig.features.dropSignup && storeConfig.policies.published
  if (!storeConfig.configured || (!signupOpen && !storeConfig.privacy.retainedDropSubscribers)) return null

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
      {signupOpen && <p>Signing up again renews consent and can reactivate a previously unsubscribed address.</p>}
      <p>
        <DropRemovalLink />. Send your request from the address that receives the emails. Requests are handled by the
        store’s support team; opening the email link does not remove an address automatically. This request concerns
        design-drop emails, not order receipts or support messages.
      </p>
    </>
  )
}
