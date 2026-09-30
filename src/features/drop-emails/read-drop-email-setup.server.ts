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
    // Every link and the one-click unsubscribe header are built from it; without it they point at localhost.
    NEXT_PUBLIC_SITE_URL: env.NEXT_PUBLIC_SITE_URL?.startsWith("https://") ? env.NEXT_PUBLIC_SITE_URL : undefined,
    PRINTIFY_SHOP_ID: env.PRINTIFY_SHOP_ID,
    PRINTIFY_PUBLISHING_ENABLED: env.PRINTIFY_PUBLISHING_ENABLED,
    RESEND_API_KEY: env.RESEND_API_KEY,
    DROP_EMAIL_FROM_EMAIL: env.DROP_EMAIL_FROM_EMAIL,
    STORE_POSTAL_ADDRESS: env.STORE_POSTAL_ADDRESS,
    CRON_SECRET: env.CRON_SECRET,
  }
  const missing = Object.keys(required).filter((name) => !required[name])
  // Drops come from the weekly feature. Privacy describes these emails and their delivery records
  // beside the list while retainedDropEmailRecords is on, and that switch outlives a pause in sending.
  const storeSettings = [
    !storeConfig.configured && "configured",
    !storeConfig.policies.published && "policies.published",
    !storeConfig.features.designOfTheWeek && "features.designOfTheWeek",
    !storeConfig.features.dropSignup && !storeConfig.privacy.retainedDropSubscribers && "features.dropSignup",
    !storeConfig.privacy.retainedDropEmailRecords && "privacy.retainedDropEmailRecords",
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
