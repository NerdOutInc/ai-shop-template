import { z } from "zod"
import { parseCheckoutCapacityLimits } from "../../src/features/checkout/parse-checkout-capacity-limits.ts"
import { envSchema } from "../../src/lib/env-schema.ts"
import { postgresConnectionConfig } from "../../src/lib/postgres-connection-config.server.ts"

const placeholder =
  /(?:^\[SENSITIVE\]$|\.{3}|<[^>]+>|\[(?:OWNER|TODO|TBD|INSERT|REPLACE)[^\]]*\]|\b(?:TODO|TBD|CHANGEME|REPLACE[ _-]?ME|YOUR[ _-](?:TOKEN|SECRET|KEY|DOMAIN|STORE|POLICY)|LOREM IPSUM)\b)/i
const prosePlaceholder = /(?:\[(?:OWNER|TODO|TBD|INSERT|REPLACE)[^\]]*\]|\b(?:TODO|TBD|CHANGEME|LOREM IPSUM)\b)/i
// Keep these original values independent of the merchant's editable store configuration.
const templateCopy = Object.freeze({
  description: "A new home for original apparel. Our first collection is on its way.",
  tagline: "Make room for your next favorite.",
  "home.headline": "Your next favorite starts here.",
  "home.introduction": "Something new is taking shape. Explore the store as we prepare our first collection.",
  "about.heading": "A brand in the making.",
  "about.paragraphs":
    "We’re getting ready to share our first collection. Come back soon to discover our story and designs.",
})
const reservedHost = /(^|\.)(?:example\.(?:com|net|org)|example|test|invalid|localhost)$/i
const loopback = (host) => ["localhost", "127.0.0.1", "[::1]"].includes(host)
const supplied = (value) => typeof value === "string" && value.trim().length > 0
const concrete = (value) => supplied(value) && !placeholder.test(value)
const concreteProse = (value) => supplied(value) && !prosePlaceholder.test(value)
const realEmail = (value) => z.email().safeParse(value).success && !reservedHost.test(value.split("@")[1])
const validCertificate = (value) =>
  typeof value === "string" &&
  /-----BEGIN CERTIFICATE-----\s*[A-Za-z0-9+/=]+(?:\s+[A-Za-z0-9+/=]+)*\s*-----END CERTIFICATE-----/.test(value)

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

function validDatabase(environment, local, certificateUnreadable = false) {
  try {
    postgresConnectionConfig(environment.DATABASE_URL, certificateUnreadable ? undefined : environment.DATABASE_SSL_CA)
    const url = new URL(environment.DATABASE_URL)
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "")
    const supabase = /(^|\.)supabase\.(?:com|co)$/.test(hostname)
    const certificate = environment.DATABASE_SSL_CA
    const hasCertificate = validCertificate(certificate)
    const hasCertificateFile =
      url.searchParams.getAll("sslrootcert").length === 1 && concrete(url.searchParams.get("sslrootcert"))
    return (
      concrete(environment.DATABASE_URL) &&
      /^store_app_runtime(?:\.[a-z0-9-]+)?$/.test(decodeURIComponent(url.username)) &&
      concrete(decodeURIComponent(url.password)) &&
      url.pathname.length > 1 &&
      (!hostname.endsWith(".pooler.supabase.com") || ["", "5432"].includes(url.port)) &&
      (!supabase || certificateUnreadable || hasCertificate || hasCertificateFile) &&
      ((local && loopback(hostname)) || (!loopback(hostname) && !reservedHost.test(hostname))) &&
      !/(?:POOLER_HOST|PROJECT|PASSWORD)/.test(environment.DATABASE_URL)
    )
  } catch {
    return false
  }
}

export function setupStatus(
  config,
  environment,
  { mode = "configuration", schedules = [], setupState, now = Date.now(), unreadableKeys = [] } = {}
) {
  schedules = Array.isArray(schedules) ? schedules : []
  const unreadable = new Set(unreadableKeys)
  let pendingUnreadable = new Set()
  const hidden = (key) => {
    if (!unreadable.has(key)) return false
    pendingUnreadable.add(key)
    return true
  }
  const matches = (key, predicate) => hidden(key) || predicate(environment[key])
  const flag = (key, expected) => (hidden(key) ? "unreadable" : (environment[key] === "true") === expected)
  const enabled = (key) => flag(key, true)
  const has = (key) => matches(key, concrete)
  const schemas = { ...envSchema.server, ...envSchema.client }
  // Keep the same empty-string semantics and schemas as runtime, without its logging or provider initialization.
  const invalid = Object.entries(schemas)
    .filter(([key, schema]) => {
      if (unreadable.has(key)) return false
      const value = environment[key] === "" ? undefined : environment[key]
      return !schema.safeParse(value).success || (supplied(value) && placeholder.test(value))
    })
    .map(([key]) => key)
  const required = (keys) => keys.every((key) => has(key) && !invalid.includes(key))
  const checks = []
  const add = (name, ready, next, active = true) => {
    const unknown = active && pendingUnreadable.size > 0
    checks.push({
      name,
      ready: !active || active === "unreadable" || Boolean(ready),
      next,
      active: Boolean(active),
      unreadable: Boolean(unknown),
      unreadableKeys: [...pendingUnreadable],
    })
    pendingUnreadable = new Set()
  }
  add(
    unreadable.size ? "Readable environment syntax" : "Environment syntax",
    invalid.length === 0,
    invalid.length
      ? `Correct ${invalid.join(", ")} using .env.example and the runtime schema; values are intentionally hidden.`
      : "Use the runtime environment schema."
  )
  add(
    "Checkout capacity overrides",
    matches("CHECKOUT_CAPACITY_LIMITS", (value) => {
      try {
        parseCheckoutCapacityLimits(value)
        return true
      } catch {
        return false
      }
    }),
    "Use valid CHECKOUT_CAPACITY_LIMITS JSON with documented budget names and ranges, or omit it for defaults."
  )
  add(
    "Brand and contact details",
    config.configured &&
      config.id !== "your-store" &&
      config.name !== "Your Store" &&
      config.shortName !== "Your Store" &&
      realEmail(config.supportEmail),
    "Review src/lib/store-config-values.ts with the owner; replace template identity and support contact."
  )
  if (mode === "launch") {
    const unchangedCopy = Object.entries(templateCopy)
      .filter(([field, original]) => {
        if (field.startsWith("about.") && !config.features?.about) return false
        const value = field.split(".").reduce((value, key) => value?.[key], config)
        return Array.isArray(value) ? value.includes(original) : value === original
      })
      .map(([field]) => field)
    add(
      "Storefront copy",
      unchangedCopy.length === 0,
      `Replace the neutral template copy in ${unchangedCopy.join(", ")} with the owner's reviewed brand copy before launch.`
    )
  }
  add(
    "Initial garment selection",
    setupState?.decisions?.printifyBlueprintId === 1317 && setupState?.decisions?.printifyPrintProviderId === 99,
    "Confirm blueprint 1317/provider 99 for the built-in per-design color workflow; record both in .store-setup.local.json decisions. Other recipes need separate compatibility work."
  )
  add(
    "Immutable commerce identity",
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(config.commerce?.identity ?? "") &&
      config.commerce.identity !== "your-store" &&
      (config.commerce?.identity?.length ?? 0) <= 80 &&
      (setupState?.decisions?.commerceIdentity == null ||
        setupState.decisions.commerceIdentity === config.commerce.identity),
    "Choose commerce.identity before the first checkout and preserve it across cosmetic rebranding. Reconcile any mismatch with decisions.commerceIdentity; verify the saved database identity before changing either value."
  )
  add(
    "Checkout admission secret",
    required(["CHECKOUT_RATE_LIMIT_SECRET"]) &&
      matches("CHECKOUT_RATE_LIMIT_SECRET", (value) => schemas.CHECKOUT_RATE_LIMIT_SECRET.safeParse(value).success),
    "Configure one random CHECKOUT_RATE_LIMIT_SECRET (32–256 characters) shared by all replicas of this store; do not rotate it casually."
  )
  add(
    "Shipping and policies",
    config.commerce?.shippingConfirmed &&
      config.policies?.published &&
      ["shippingText", "returnsText", "privacyText"].every(
        (key) =>
          Array.isArray(config.policies[key]) &&
          config.policies[key].length > 0 &&
          config.policies[key].every(concreteProse)
      ),
    "Implement owner-reviewed shipping rates, estimates and all three policies; remove TODO/TBD placeholder copy. A text check cannot approve legal content."
  )
  add(
    "Canonical domain",
    matches("NEXT_PUBLIC_SITE_URL", (value) => validOrigin(value, mode === "sandbox")),
    "Set NEXT_PUBLIC_SITE_URL to the permanent HTTPS origin (no path/query/credentials or example/test domain); localhost is allowed only with --sandbox."
  )
  add(
    "Database",
    matches("DATABASE_SSL_CA", (value) => value === undefined || value === "" || validCertificate(value)) &&
      matches("DATABASE_URL", () => validDatabase(environment, mode !== "launch", hidden("DATABASE_SSL_CA"))),
    "Apply migrations with supabase db push; provision store_app_runtime and set its direct/session URL (not port 6543). Supabase requires the Database Settings PEM certificate in DATABASE_SSL_CA or a nonempty sslrootcert path, with verify-full. Verify grants and certificate trust separately."
  )
  add(
    "Owner sign-in and private artwork",
    required([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "PRIVATE_BLOB_READ_WRITE_TOKEN",
      "ADMIN_OWNER_EMAIL",
    ]) &&
      matches(
        "NEXT_PUBLIC_SUPABASE_URL",
        (value) => validOrigin(value, mode === "sandbox") && !/^https:\/\/PROJECT\./i.test(value ?? "")
      ) &&
      matches("ADMIN_OWNER_EMAIL", realEmail),
    "Configure Auth and private Blob; verify email, membership and recovery separately. Initial enrollment credentials are checked below.",
    enabled("ADMIN_LIBRARY_ENABLED")
  )
  add(
    "Initial owner claim configuration",
    required(["ADMIN_SETUP_SECRET", "SUPABASE_SECRET_KEY"]) ||
      (setupState?.verification?.ownerClaim?.status === "verified" &&
        matches(
          "NEXT_PUBLIC_SUPABASE_URL",
          (value) => setupState.verification.ownerClaim.supabaseProjectUrl === value
        ) &&
        Number.isFinite(Date.parse(setupState.verification.ownerClaim.verifiedAt)) &&
        concrete(setupState.verification.ownerClaim.evidence)),
    "Set ADMIN_SETUP_SECRET (32–256 characters) and SUPABASE_SECRET_KEY for first enrollment. After readback of the consumed claim, retain dated matching verification.ownerClaim evidence and remove both enrollment secrets. Verify current membership separately.",
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
      matches("PRINTIFY_SHOP_ID", (value) => /^[1-9]\d*$/.test(value ?? "")) &&
      (has("BLOB_STORE_ID") || required(["BLOB_READ_WRITE_TOKEN"])),
    "Configure the store's shop, read/publishing tokens, public Blob, signed webhook and CRON_SECRET (32+ characters). Publish a reviewed product and initialize stock before testing Checkout."
  )
  add(
    "Library product drafts",
    required(["PRINTIFY_DRAFTS_API_TOKEN"]),
    "Set the separate PRINTIFY_DRAFTS_API_TOKEN for enabled private-library drafts.",
    enabled("ADMIN_LIBRARY_ENABLED")
  )
  const rotationDueAt = setupState?.providers?.printify?.credentialRotationDueAt
  const rotationTime = typeof rotationDueAt === "string" ? Date.parse(rotationDueAt) : NaN
  add(
    "Printify credential rotation",
    Number.isFinite(rotationTime) && rotationTime > now + 30 * 86_400_000,
    "Review the recorded Printify credentialRotationDueAt. Rotate credentials that are expired or due within 30 days, verify the replacements and record the next rotation date; correct invalid dates.",
    rotationDueAt != null
  )
  add(
    "Stripe payments",
    required(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) &&
      matches("STRIPE_SECRET_KEY", (value) => /^(rk|sk)_(test|live)_[A-Za-z0-9]+$/.test(value ?? "")) &&
      matches("STRIPE_WEBHOOK_SECRET", (value) => /^whsec_[A-Za-z0-9]+$/.test(value ?? "")),
    "Set the restricted Stripe key and endpoint-specific signing secret; replace example values and verify the signed sandbox flow separately."
  )
  if (mode === "sandbox")
    add(
      "Sandbox payment isolation",
      matches("STRIPE_SECRET_KEY", (value) => /^(rk|sk)_test_/.test(value ?? "")) &&
        flag("PRINTIFY_FULFILLMENT_ENABLED", false),
      "Use Stripe test/sandbox keys and PRINTIFY_FULFILLMENT_ENABLED=false before the sandbox Checkout journey."
    )
  if (mode === "launch")
    add(
      "Live payment and fulfillment configuration",
      matches("STRIPE_SECRET_KEY", (value) => /^(rk|sk)_live_/.test(value ?? "")) &&
        enabled("PRINTIFY_FULFILLMENT_ENABLED"),
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
      matches("STRIPE_SECRET_KEY", (value) => /^(rk|sk)_live_/.test(value ?? "")) &&
      schedules.some((entry) => entry?.path === "/api/internal/order-alerts" && entry.schedule === "0 * * * *"),
    "Configure owner access, live Stripe reads, the verified Resend sender, sending key and hourly /api/internal/order-alerts schedule; verify receipt separately.",
    mode !== "sandbox" && enabled("ORDER_ALERTS_ENABLED")
  )
  add(
    "Weekly drop emails",
    required(["RESEND_API_KEY", "DROP_EMAIL_FROM_EMAIL", "STORE_POSTAL_ADDRESS"]) &&
      matches("DROP_EMAIL_FROM_EMAIL", realEmail) &&
      config.features?.designOfTheWeek === true &&
      (config.features?.dropSignup === true || config.privacy?.retainedDropSubscribers === true) &&
      config.privacy?.retainedDropEmailRecords === true &&
      schedules.some((entry) => entry?.path === "/api/internal/drop-emails" && entry.schedule === "5,20,35,50 * * * *"),
    "Turn on the weekly feature, a drop list and privacy.retainedDropEmailRecords, then configure the verified Resend sender, sending key, one-line STORE_POSTAL_ADDRESS and the /api/internal/drop-emails schedule (5,20,35,50 * * * *). Send a test from Products → Drop emails and verify receipt separately.",
    mode !== "sandbox" && enabled("DROP_EMAILS_ENABLED")
  )
  add(
    "Meta measurement",
    matches("META_PIXEL_ID", (value) => /^\d{5,25}$/.test(value ?? "")),
    "Set this store's META_PIXEL_ID and verify consent and authorized production activation.",
    enabled("META_PIXEL_ENABLED")
  )
  add(
    "Google measurement",
    matches("GOOGLE_TAG_ID", (value) => /^GT-[A-Z0-9]{4,20}$/.test(value ?? "")),
    "Set this store's GOOGLE_TAG_ID and verify consent and authorized production activation.",
    enabled("GOOGLE_TAG_ENABLED")
  )
  return checks
}
