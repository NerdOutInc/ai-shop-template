import "server-only"

import { env } from "./env"
import { storeConfig } from "./store-config"

export function isIndexableSite(): boolean {
  return (
    storeConfig.configured &&
    storeConfig.policies.published &&
    storeConfig.commerce.shippingConfirmed &&
    !!env.NEXT_PUBLIC_SITE_URL &&
    env.NODE_ENV === "production" &&
    (!env.VERCEL_ENV || env.VERCEL_ENV === "production")
  )
}
