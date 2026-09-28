import "server-only"

const failures = {
  unconfigured: {
    code: "ADMIN_OWNER_UNCONFIGURED",
    message:
      "Owner provisioning is not configured. Ask the deployment owner to check the authentication settings and server-only provisioning key.",
  },
  "setup-changed": {
    code: "ADMIN_OWNER_SETUP_CHANGED",
    message: "Owner setup changed or is already complete. Request a new setup code, or use sign-in and owner recovery.",
  },
  "account-conflict": {
    code: "ADMIN_OWNER_ACCOUNT_CONFLICT",
    message:
      "An existing account conflicts with owner setup. Stop and ask the Supabase project owner to review Authentication → Users using the setup recovery guide.",
  },
  "account-mismatch": {
    code: "ADMIN_OWNER_ACCOUNT_MISMATCH",
    message:
      "The reserved owner account is unavailable or does not match. Ask the Supabase project owner to review its identity and account status before retrying.",
  },
  "provider-credentials": {
    code: "ADMIN_OWNER_PROVIDER_CREDENTIALS",
    message:
      "Supabase rejected the owner provisioning credential. Ask the deployment owner to check the server-only key and matching project.",
  },
  "provider-unavailable": {
    code: "ADMIN_OWNER_PROVIDER_UNAVAILABLE",
    message:
      "Supabase could not complete owner provisioning. Check provider availability or rate limits, then retry with the same setup details.",
  },
  "migration-required": {
    code: "ADMIN_OWNER_MIGRATION_REQUIRED",
    message:
      "The owner enrollment database migration is missing. Keep setup disabled while the deployment owner applies all migrations and deploys the matching code.",
  },
  "email-delivery": {
    code: "ADMIN_OWNER_EMAIL_DELIVERY",
    message:
      "Could not send the setup code. Check email delivery, provider settings and the magic-link OTP email template, then request a new code.",
  },
} as const

export type OwnerSetupFailureReason = keyof typeof failures

export function ownerSetupFailure(reason: OwnerSetupFailureReason) {
  const failure = failures[reason]
  console.error("Owner setup unavailable", { code: failure.code })
  return { ok: false, message: failure.message }
}
