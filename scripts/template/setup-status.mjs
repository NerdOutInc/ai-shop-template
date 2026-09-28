import { z } from "zod"
import { envSchema } from "../../src/lib/env-schema.ts"
import { postgresConnectionConfig } from "../../src/lib/postgres-connection-config.server.ts"

const placeholder =
  /(?:\.{3}|<[^>]+>|\[(?:OWNER|TODO|TBD|INSERT|REPLACE)[^\]]*\]|\b(?:TODO|TBD|CHANGEME|REPLACE[ _-]?ME|YOUR[ _-](?:TOKEN|SECRET|KEY|DOMAIN|STORE|POLICY)|LOREM IPSUM)\b)/i
const reservedHost = /(^|\.)(?:example\.(?:com|net|org)|example|test|invalid|localhost)$/i
const loopback = (host) => ["localhost", "127.0.0.1", "[::1]"].includes(host)
const supplied = (value) => typeof value === "string" && value.trim().length > 0
const concrete = (value) => supplied(value) && !placeholder.test(value)
const realEmail = (value) => z.email().safeParse(value).success && !reservedHost.test(value.split("@")[1])

function validOrigin(value, local = false) {
  try {
    const url = new URL(value)
    return (
      concrete(value) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.hostname.endsWith(".") &&
      ((local && ["localhost", "127.0.0.1"].includes(url.hostname) && ["http:", "https:"].includes(url.protocol)) ||
        (url.protocol === "https:" &&
          !reservedHost.test(url.hostname) &&
          !loopback(url.hostname) &&
          url.hostname.includes(".")))
    )
  } catch {
    return false
  }
}

function validDatabase(environment, local) {
  try {
    postgresConnectionConfig(environment.DATABASE_URL, environment.DATABASE_SSL_CA)
    const url = new URL(environment.DATABASE_URL)
    return (
      concrete(environment.DATABASE_URL) &&
      /^store_app_runtime(?:\.[a-z0-9-]+)?$/.test(decodeURIComponent(url.username)) &&
      concrete(decodeURIComponent(url.password)) &&
      url.pathname.length > 1 &&
      (!url.hostname.endsWith(".pooler.supabase.com") || ["", "5432"].includes(url.port)) &&
      ((local && loopback(url.hostname)) || (!loopback(url.hostname) && !reservedHost.test(url.hostname))) &&
      !/(?:POOLER_HOST|PROJECT|PASSWORD)/.test(environment.DATABASE_URL)
    )
  } catch {
    return false
  }
}

export function setupStatus(config, environment, { mode = "configuration", schedules = [], setupState } = {}) {
  schedules = Array.isArray(schedules) ? schedules : []
  const enabled = (key) => environment[key] === "true"
  const has = (key) => concrete(environment[key])
  const schemas = { ...envSchema.server, ...envSchema.client }
  // Keep the same empty-string semantics and schemas as runtime, without its logging or provider initialization.
  const invalid = Object.entries(schemas)
    .filter(([key, schema]) => {
      const value = environment[key] === "" ? undefined : environment[key]
      return !schema.safeParse(value).success || (supplied(value) && placeholder.test(value))
    })
    .map(([key]) => key)
  const required = (keys) => keys.every((key) => has(key) && !invalid.includes(key))
  const checks = []
  const add = (name, ready, next, active = true) =>
    checks.push({ name, ready: !active || Boolean(ready), next, active })
  add(
    "Environment syntax",
    invalid.length === 0,
    invalid.length
      ? `Correct ${invalid.join(", ")} using .env.example and the runtime schema; values are intentionally hidden.`
      : "Use the runtime environment schema."
  )
  add(
    "Brand and contact details",
    config.configured && config.id !== "your-store" && config.name !== "Your Store" && realEmail(config.supportEmail),
    "Review src/lib/store-config.ts with the owner; replace template identity and support contact."
  )
  add(
    "Initial garment selection",
    setupState?.decisions?.printifyBlueprintId === 1317 && setupState?.decisions?.printifyPrintProviderId === 99,
    "Confirm blueprint 1317/provider 99 for the built-in per-design color workflow; record both in .store-setup.local.json decisions. Other recipes need separate compatibility work."
  )
  add(
    "Immutable commerce identity",
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(config.commerce?.identity ?? "") &&
      config.commerce.identity !== "your-store" &&
      (config.commerce?.identity?.length ?? 0) <= 80,
    "Choose commerce.identity before the first checkout and preserve it across cosmetic rebranding; verify the saved database identity separately."
  )
  add(
    "Checkout admission secret",
    required(["CHECKOUT_RATE_LIMIT_SECRET"]) &&
      schemas.CHECKOUT_RATE_LIMIT_SECRET.safeParse(environment.CHECKOUT_RATE_LIMIT_SECRET).success,
    "Configure one random CHECKOUT_RATE_LIMIT_SECRET (32–256 characters) shared by all replicas of this store; do not rotate it casually."
  )
  add(
    "Shipping and policies",
    config.commerce?.shippingConfirmed &&
      config.policies?.published &&
      ["shippingText", "returnsText", "privacyText"].every(
        (key) =>
          Array.isArray(config.policies[key]) && config.policies[key].length > 0 && config.policies[key].every(concrete)
      ),
    "Implement owner-reviewed shipping rates, estimates and all three policies; remove TODO/TBD placeholder copy. A text check cannot approve legal content."
  )
  add(
    "Canonical domain",
    validOrigin(environment.NEXT_PUBLIC_SITE_URL, mode === "sandbox"),
    "Set NEXT_PUBLIC_SITE_URL to the permanent HTTPS origin (no path/query/credentials or example/test domain); localhost is allowed only with --sandbox."
  )
  add(
    "Database",
    validDatabase(environment, mode !== "launch"),
    "Apply migrations with supabase db push; provision store_app_runtime and set its direct/session URL (not port 6543), verified TLS and CA. Verify grants separately."
  )
  add(
    "Owner sign-in and private artwork",
    required([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
      "PRIVATE_BLOB_READ_WRITE_TOKEN",
      "ADMIN_OWNER_EMAIL",
    ]) &&
      validOrigin(environment.NEXT_PUBLIC_SUPABASE_URL, mode === "sandbox") &&
      !/^https:\/\/PROJECT\./i.test(environment.NEXT_PUBLIC_SUPABASE_URL ?? "") &&
      realEmail(environment.ADMIN_OWNER_EMAIL),
    "Configure Auth, private Blob and owner provisioning. ADMIN_SETUP_SECRET is required for the initial claim; verify email, membership and recovery separately.",
    enabled("ADMIN_LIBRARY_ENABLED")
  )
  add(
    "Initial owner claim configuration",
    required(["ADMIN_SETUP_SECRET"]) ||
      (setupState?.verification?.ownerClaim?.status === "verified" &&
        setupState.verification.ownerClaim.supabaseProjectUrl === environment.NEXT_PUBLIC_SUPABASE_URL &&
        Number.isFinite(Date.parse(setupState.verification.ownerClaim.verifiedAt)) &&
        concrete(setupState.verification.ownerClaim.evidence)),
    "Set ADMIN_SETUP_SECRET (32–256 characters) for first enrollment, or retain dated non-secret verification.ownerClaim evidence after the consumed claim. Verify current membership separately.",
    enabled("ADMIN_LIBRARY_ENABLED")
  )
  add(
    "Printify catalog and publishing",
    enabled("PRINTIFY_PUBLISHING_ENABLED") &&
      required([
        "PRINTIFY_API_TOKEN",
        "PRINTIFY_PUBLISHING_API_TOKEN",
        "PRINTIFY_SHOP_ID",
        "PRINTIFY_WEBHOOK_SECRET",
        "CRON_SECRET",
        "NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST",
      ]) &&
      /^[1-9]\d*$/.test(environment.PRINTIFY_SHOP_ID ?? "") &&
      (has("BLOB_STORE_ID") || required(["BLOB_READ_WRITE_TOKEN"])),
    "Configure the store's shop, read/publishing tokens, public Blob, signed webhook and CRON_SECRET (32+ characters). Publish a reviewed product and initialize stock before testing Checkout."
  )
  add(
    "Library product drafts",
    required(["PRINTIFY_DRAFTS_API_TOKEN"]),
    "Set the separate PRINTIFY_DRAFTS_API_TOKEN for enabled private-library drafts.",
    enabled("ADMIN_LIBRARY_ENABLED")
  )
  add(
    "Stripe payments",
    required(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) &&
      /^(rk|sk)_(test|live)_[A-Za-z0-9]+$/.test(environment.STRIPE_SECRET_KEY ?? "") &&
      /^whsec_[A-Za-z0-9]+$/.test(environment.STRIPE_WEBHOOK_SECRET ?? ""),
    "Set the restricted Stripe key and endpoint-specific signing secret; replace example values and verify the signed sandbox flow separately."
  )
  if (mode === "sandbox")
    add(
      "Sandbox payment isolation",
      /^(rk|sk)_test_/.test(environment.STRIPE_SECRET_KEY ?? "") && !enabled("PRINTIFY_FULFILLMENT_ENABLED"),
      "Use Stripe test/sandbox keys and PRINTIFY_FULFILLMENT_ENABLED=false before the sandbox Checkout journey."
    )
  if (mode === "launch")
    add(
      "Live payment and fulfillment configuration",
      /^(rk|sk)_live_/.test(environment.STRIPE_SECRET_KEY ?? "") && enabled("PRINTIFY_FULFILLMENT_ENABLED"),
      "After sandbox evidence and authorized live activation, configure the live key and real fulfillment; configuration does not authorize a charge."
    )
  const workerSchedules = [
    ["Publishing recovery schedule", "/api/internal/printify-publishing", "* * * * *"],
    ["Stock refresh schedule", "/api/internal/catalog-sync/stock", "*/30 * * * *"],
    ["Popularity refresh schedule", "/api/internal/catalog-sync/popularity", "0 */6 * * *"],
  ]
  if (mode !== "sandbox")
    for (const [name, path, schedule] of workerSchedules)
      add(
        name,
        Array.isArray(schedules) && schedules.some((entry) => entry?.path === path && entry.schedule === schedule),
        `Merge ${path} (${schedule}) from scripts/vercel-crons.example.json into vercel.json. Supported automatic launch check requires these Vercel schedules; verify Pro/Enterprise and actual execution separately.`,
        mode === "launch" || enabled("PRINTIFY_PUBLISHING_ENABLED")
      )
  add(
    "Order shipping reminders",
    required(["RESEND_API_KEY", "ORDER_ALERT_FROM_EMAIL"]) &&
      enabled("ADMIN_LIBRARY_ENABLED") &&
      /^(rk|sk)_live_/.test(environment.STRIPE_SECRET_KEY ?? "") &&
      (mode === "sandbox" ||
        schedules.some((entry) => entry?.path === "/api/internal/order-alerts" && entry.schedule === "0 * * * *")),
    "Configure owner access, live Stripe reads, the verified Resend sender, sending key and hourly /api/internal/order-alerts schedule; verify receipt separately.",
    enabled("ORDER_ALERTS_ENABLED")
  )
  add(
    "Meta measurement",
    /^\d{5,25}$/.test(environment.META_PIXEL_ID ?? ""),
    "Set this store's META_PIXEL_ID and verify consent and authorized production activation.",
    enabled("META_PIXEL_ENABLED")
  )
  add(
    "Google measurement",
    /^GT-[A-Z0-9]{4,20}$/.test(environment.GOOGLE_TAG_ID ?? ""),
    "Set this store's GOOGLE_TAG_ID and verify consent and authorized production activation.",
    enabled("GOOGLE_TAG_ENABLED")
  )
  return checks
}
