import { createEnv } from "@t3-oss/env-nextjs"
import { describe, expect, it } from "vitest"

import { envSchema } from "./env-schema"

const headerCredentials = {
  PRINTIFY_API_TOKEN: envSchema.server.PRINTIFY_API_TOKEN,
  PRINTIFY_PUBLISHING_API_TOKEN: envSchema.server.PRINTIFY_PUBLISHING_API_TOKEN,
  PRINTIFY_DRAFTS_API_TOKEN: envSchema.server.PRINTIFY_DRAFTS_API_TOKEN,
  STRIPE_SECRET_KEY: envSchema.server.STRIPE_SECRET_KEY,
  PRINTIFY_MONITOR_SECRET: envSchema.server.PRINTIFY_MONITOR_SECRET,
  RESEND_API_KEY: envSchema.server.RESEND_API_KEY,
  CRON_SECRET: envSchema.server.CRON_SECRET,
  SUPABASE_SECRET_KEY: envSchema.server.SUPABASE_SECRET_KEY,
  BLOB_READ_WRITE_TOKEN: envSchema.server.BLOB_READ_WRITE_TOKEN,
  PRIVATE_BLOB_READ_WRITE_TOKEN: envSchema.server.PRIVATE_BLOB_READ_WRITE_TOKEN,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: envSchema.client.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
}

describe("header-bound environment credentials", () => {
  it.each(Object.entries(headerCredentials))("rejects CR/LF in %s without exposing the credential", (_, schema) => {
    const prefix = "synthetic-credential-".repeat(2)
    for (const value of [`${prefix}\rtail`, `${prefix}\ntail`, `${prefix}\r\ntail`, `\n${prefix}`, `${prefix}\n`]) {
      const result = schema.safeParse(value)
      expect(result.success).toBe(false)
      if (!result.success) expect(JSON.stringify(result.error.issues)).not.toContain(prefix)
    }
  })

  it.each(Object.entries(headerCredentials))("preserves optional and literal credential values for %s", (_, schema) => {
    const value = "synthetic-credential-$literal-".repeat(2)
    expect(schema.parse(value)).toBe(value)
    expect(schema.parse(undefined)).toBeUndefined()
    const environment = createEnv({
      server: { CREDENTIAL: schema },
      runtimeEnv: { CREDENTIAL: "" },
      isServer: true,
      emptyStringAsUndefined: true,
    })
    expect(environment.CREDENTIAL).toBeUndefined()
  })

  it("retains existing minimum lengths without imposing provider token lengths", () => {
    for (const schema of [envSchema.server.CRON_SECRET, envSchema.server.PRINTIFY_MONITOR_SECRET]) {
      expect(schema.safeParse("x".repeat(31)).success).toBe(false)
      expect(schema.safeParse("x".repeat(32)).success).toBe(true)
    }
    for (const [name, schema] of Object.entries(headerCredentials)) {
      if (!["CRON_SECRET", "PRINTIFY_MONITOR_SECRET"].includes(name)) {
        expect(schema.safeParse("x").success).toBe(true)
      }
    }
  })

  it("preserves multiline database certificates", () => {
    const certificate = "-----BEGIN CERTIFICATE-----\nsynthetic-fixture\r\n-----END CERTIFICATE-----\n"
    expect(envSchema.server.DATABASE_SSL_CA.parse(certificate)).toBe(certificate)
  })
})

describe("drop email settings", () => {
  // Printed in every email's footer, so it has to be one line of real text.
  it("keeps the postal address to one line", () => {
    const schema = envSchema.server.STORE_POSTAL_ADDRESS
    expect(schema.parse("  PO Box 123, Austin, TX 78701  ")).toBe("PO Box 123, Austin, TX 78701")
    expect(schema.parse(undefined)).toBeUndefined()
    for (const value of ["PO Box 123\nAustin, TX 78701", "PO Box 123\r\nAustin, TX", "too short", "x".repeat(301)])
      expect(schema.safeParse(value).success).toBe(false)
  })

  it("sends only after an explicit switch", () => {
    expect(envSchema.server.DROP_EMAILS_ENABLED.parse(undefined)).toBe("false")
    expect(envSchema.server.DROP_EMAILS_ENABLED.safeParse("yes").success).toBe(false)
  })
})
