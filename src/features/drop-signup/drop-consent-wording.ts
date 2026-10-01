/** Keep published promises immutable: a saved version names exactly what was shown. */
export const dropConsentWording: Readonly<Record<string, string>> = {
  v1: "We'll email you when a new design drops. Nothing else, and you can stop any time.",
  v2: "We'll email you about new design drops. To request removal from the list, email our support team.",
  v3: "We'll send a confirmation email first. Once you confirm, we'll email you about new design drops. You can unsubscribe in every drop email or contact our support team.",
}
