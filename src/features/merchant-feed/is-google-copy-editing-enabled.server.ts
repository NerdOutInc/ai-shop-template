import "server-only"

import { env } from "@/lib/env"

export function isGoogleCopyEditingEnabled() {
  return (
    env.PRINTIFY_PUBLISHING_ENABLED &&
    env.DATABASE_URL &&
    env.PRINTIFY_SHOP_ID &&
    /^[1-9]\d*$/.test(env.PRINTIFY_SHOP_ID)
  )
}
