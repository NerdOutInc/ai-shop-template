export function setupStatus(config, environment) {
  const has = (key) => Boolean(environment[key]?.trim())
  const enabled = (key) => environment[key] === "true"
  const realUrl = (key) => {
    try {
      const value = new URL(environment[key])
      return (
        value.protocol === "https:" &&
        !value.username &&
        !value.password &&
        !/(^|\.)(example\.(com|org|net)|localhost)$/.test(value.hostname)
      )
    } catch {
      return false
    }
  }
  const checks = [
    {
      name: "Brand and contact details",
      ready:
        config.configured &&
        config.id !== "your-store" &&
        config.name !== "Your Store" &&
        !config.supportEmail.endsWith("@example.com"),
      next: "Review src/lib/store-config.ts with the owner; choose the permanent store ID before payments.",
    },
    {
      name: "Shipping and policies",
      ready: config.commerce.shippingConfirmed && config.policies.published,
      next: "Confirm rates, delivery estimates, shipping/returns/privacy text, and tax decisions with the owner.",
    },
    {
      name: "Canonical domain",
      ready: realUrl("NEXT_PUBLIC_SITE_URL"),
      next: "Configure this store's HTTPS domain and NEXT_PUBLIC_SITE_URL.",
    },
    {
      name: "Database",
      ready: has("DATABASE_URL"),
      next: "Create a separate database, apply all migrations, then set its verified runtime connection (and CA when required).",
    },
    {
      name: "Owner sign-in and private artwork",
      ready:
        enabled("ADMIN_LIBRARY_ENABLED") &&
        realUrl("NEXT_PUBLIC_SUPABASE_URL") &&
        has("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") &&
        has("SUPABASE_SECRET_KEY") &&
        has("PRIVATE_BLOB_READ_WRITE_TOKEN") &&
        has("ADMIN_OWNER_EMAIL"),
      next: "Configure Supabase Auth, private Blob, owner bootstrap, and verify owner sign-in.",
    },
    {
      name: "Printify catalog and publishing",
      ready:
        enabled("PRINTIFY_PUBLISHING_ENABLED") &&
        [
          "PRINTIFY_API_TOKEN",
          "PRINTIFY_PUBLISHING_API_TOKEN",
          "PRINTIFY_DRAFTS_API_TOKEN",
          "PRINTIFY_SHOP_ID",
          "PRINTIFY_WEBHOOK_SECRET",
          "CRON_SECRET",
          "PRINTIFY_MONITOR_SECRET",
          "NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST",
        ].every(has) &&
        (has("BLOB_STORE_ID") || has("BLOB_READ_WRITE_TOKEN")),
      next: "Connect a new shop and public Blob, signed webhook, scheduled worker, and complete garment/category setup.",
    },
    {
      name: "Stripe payments",
      ready: /^(rk|sk)_(test|live)_\S+$/.test(environment.STRIPE_SECRET_KEY ?? "") && has("STRIPE_WEBHOOK_SECRET"),
      next: "Connect restricted Stripe keys and the required signed webhook; verify a sandbox checkout.",
    },
  ]
  return checks.map((check) => ({ ...check, ready: Boolean(check.ready) }))
}
