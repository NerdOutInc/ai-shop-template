/**
 * Stands in for the subscriber's id in the frozen email and is swapped for the real one at send time.
 * Lowercase letters and hyphens only, so React's escaping, URL encoding and the plain-text conversion
 * all leave it exactly as written.
 */
export const dropEmailSubscriberPlaceholder = "drop-email-subscriber-placeholder"
