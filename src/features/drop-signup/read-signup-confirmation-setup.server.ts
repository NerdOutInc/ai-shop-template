import "server-only"
import { env } from "@/lib/env"
import { storeConfig } from "@/lib/store-config"
import { formatDropEmailSender } from "@/features/drop-emails/format-drop-email-sender"

export function readSignupConfirmationSetup() {
  // A loopback HTTP origin supports offline provider fixtures; public origins require HTTPS.
  const origin = env.NEXT_PUBLIC_SITE_URL ? new URL(env.NEXT_PUBLIC_SITE_URL) : null
  const secureOrigin =
    origin?.protocol === "https:" ||
    (origin?.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
  const from = env.DROP_EMAIL_FROM_EMAIL ?? env.ORDER_ALERT_FROM_EMAIL
  return {
    hourlyLimit: env.SIGNUP_CONFIRMATIONS_HOURLY_LIMIT,
    sending:
      env.SIGNUP_CONFIRMATIONS_ENABLED === "true" &&
      env.VERCEL_ENV === "production" &&
      storeConfig.configured &&
      storeConfig.policies.published &&
      (storeConfig.features.dropSignup || storeConfig.privacy.retainedDropSubscribers) &&
      Boolean(secureOrigin && env.DATABASE_URL && env.RESEND_API_KEY && from),
    from: from ? formatDropEmailSender(storeConfig.name, from) : null,
    apiKey: env.RESEND_API_KEY,
  }
}
