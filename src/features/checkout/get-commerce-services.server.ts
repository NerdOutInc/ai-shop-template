import "server-only"

import Stripe from "stripe"

import { getSharedPostgresPool } from "@/lib/get-shared-postgres-pool.server"
import { env } from "@/lib/env"

import { CheckoutError } from "./checkout-error"
import { PostgresCheckoutCapacity } from "./postgres-checkout-capacity.server"
import { PostgresOrderStore } from "./postgres-order-store.server"
import { PrintifyClient } from "./printify-client.server"

let services: ReturnType<typeof createServices> | undefined

function createServices() {
  if (
    !env.STRIPE_SECRET_KEY ||
    !/^(rk|sk)_(test|live)_\S+$/.test(env.STRIPE_SECRET_KEY) ||
    !env.STRIPE_WEBHOOK_SECRET ||
    !env.DATABASE_URL
  ) {
    throw new CheckoutError("NOT_CONFIGURED", "Checkout is not available yet. Please try again later.")
  }
  const rawUrl = env.NEXT_PUBLIC_SITE_URL ?? (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "http://localhost:3000")
  const url = new URL(rawUrl)
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
  ) {
    throw new CheckoutError("NOT_CONFIGURED", "Checkout is unavailable while we finish connecting the shop.")
  }
  let store: PostgresOrderStore
  let capacity: PostgresCheckoutCapacity
  try {
    store = new PostgresOrderStore(env.DATABASE_URL, getSharedPostgresPool(env.DATABASE_URL, "checkout"))
    capacity = new PostgresCheckoutCapacity(
      env.DATABASE_URL,
      {
        secret: env.CHECKOUT_RATE_LIMIT_SECRET,
        vercel: env.VERCEL === "1",
        certificate: env.DATABASE_SSL_CA,
        limits: env.CHECKOUT_CAPACITY_LIMITS,
      },
      getSharedPostgresPool(env.DATABASE_URL, "admission")
    )
  } catch {
    throw new CheckoutError("NOT_CONFIGURED", "Checkout is unavailable while we finish connecting the shop.")
  }
  return {
    stripe: new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2026-09-30.endive",
      maxNetworkRetries: 2,
      timeout: 15_000,
    }),
    store,
    capacity,
    printify: new PrintifyClient({ apiToken: env.PRINTIFY_API_TOKEN, shopId: env.PRINTIFY_SHOP_ID }),
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    siteUrl: url.origin,
    automaticTax: env.STRIPE_TAX_ENABLED === "true",
    liveFulfillment: env.PRINTIFY_FULFILLMENT_ENABLED === "true",
    expectedLivemode: /^(rk|sk)_live_/.test(env.STRIPE_SECRET_KEY),
  }
}

export function getCommerceServices() {
  services ??= createServices()
  return services
}
