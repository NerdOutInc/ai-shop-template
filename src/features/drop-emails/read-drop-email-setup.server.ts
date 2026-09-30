import "server-only"

import { env } from "@/lib/env"
import { storeConfig } from "@/lib/store-config"

import { formatDropEmailSender } from "./format-drop-email-sender"

/**
 * What the drop sender still needs, by setting name, so the admin page can say exactly what is missing
 * without ever handling a value.
 */
export function readDropEmailSetup() {
  const required: Record<string, unknown> = {
    DATABASE_URL: env.DATABASE_URL,
    PRINTIFY_SHOP_ID: env.PRINTIFY_SHOP_ID,
    PRINTIFY_PUBLISHING_ENABLED: env.PRINTIFY_PUBLISHING_ENABLED,
    RESEND_API_KEY: env.RESEND_API_KEY,
    DROP_EMAIL_FROM_EMAIL: env.DROP_EMAIL_FROM_EMAIL,
    STORE_POSTAL_ADDRESS: env.STORE_POSTAL_ADDRESS,
    CRON_SECRET: env.CRON_SECRET,
  }
  const missing = Object.keys(required).filter((name) => !required[name])
  // Drops come from the weekly feature, and the Privacy page describes these emails only while it
  // describes the list, so sending waits for both.
  const storeSettings = [
    !storeConfig.configured && "configured",
    !storeConfig.policies.published && "policies.published",
    !storeConfig.features.designOfTheWeek && "features.designOfTheWeek",
    !storeConfig.features.dropSignup && !storeConfig.privacy.retainedDropSubscribers && "features.dropSignup",
  ].filter((setting) => typeof setting === "string")
  return {
    missing,
    storeSettings,
    // Production only, like the owner alerts, so no preview deployment can ever mail a subscriber.
    sending:
      env.DROP_EMAILS_ENABLED === "true" &&
      env.VERCEL_ENV === "production" &&
      missing.length === 0 &&
      storeSettings.length === 0,
    from: env.DROP_EMAIL_FROM_EMAIL ? formatDropEmailSender(storeConfig.name, env.DROP_EMAIL_FROM_EMAIL) : null,
    postalAddress: env.STORE_POSTAL_ADDRESS ?? null,
  }
}
