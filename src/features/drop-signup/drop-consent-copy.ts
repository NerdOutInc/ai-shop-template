/**
 * The exact promise shown beside the signup field, and the token stored with every subscriber.
 *
 * Signup IS the opt-in here, so the form's words ARE the consent. A timestamp proves somebody
 * submitted; it does not prove what they were told. Bump the version whenever the wording changes,
 * so an old row keeps pointing at what that person actually agreed to, and quote the same wording on
 * the privacy page.
 */
export const dropConsentCopy = {
  version: "v2",
  text: "We'll email you about new design drops. To request removal from the list, email our support team.",
}
