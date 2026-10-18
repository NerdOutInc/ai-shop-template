import { z } from "zod"

import { isPublicBlobHost } from "./is-public-blob-host"

const singleLineCredential = z.string().refine((value) => !/[\r\n]/.test(value), "Use a single-line credential")

// Shared by runtime loading and the offline setup report.
export const envSchema = {
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    VERCEL: z.enum(["1"]).optional(),
    VERCEL_URL: z.string().min(1).optional(),
    VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
    PRINTIFY_API_TOKEN: singleLineCredential.optional(),
    PRINTIFY_PUBLISHING_API_TOKEN: singleLineCredential.optional(),
    PRINTIFY_DRAFTS_API_TOKEN: singleLineCredential.optional(),
    PRINTIFY_SHOP_ID: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    DATABASE_SSL_CA: z.string().optional(),
    CHECKOUT_RATE_LIMIT_SECRET: z.string().min(32).max(256).optional(),
    CHECKOUT_CAPACITY_LIMITS: z.string().optional(),
    STRIPE_SECRET_KEY: singleLineCredential.optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_TAX_ENABLED: z.enum(["true", "false"]).optional(),
    PRINTIFY_FULFILLMENT_ENABLED: z.enum(["true", "false"]).optional(),
    PRINTIFY_PUBLISHING_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PRINTIFY_WEBHOOK_SECRET: z.string().min(32).optional(),
    PRINTIFY_MONITOR_SECRET: singleLineCredential.min(32).optional(),
    GOOGLE_MERCHANT_FEED_PASSWORD: z.string().min(32).max(256).optional(),
    META_CATALOG_FEED_PASSWORD: z.string().min(32).max(256).optional(),
    RESEND_API_KEY: singleLineCredential.min(1).optional(),
    ORDER_ALERT_FROM_EMAIL: z.email().optional(),
    ORDER_ALERTS_ENABLED: z.enum(["true", "false"]).default("false"),
    SIGNUP_CONFIRMATIONS_HOURLY_LIMIT: z.coerce.number().int().min(1).max(1000).default(20),
    SIGNUP_CONFIRMATIONS_ENABLED: z.enum(["true", "false"]).default("false"),
    DROP_EMAILS_ENABLED: z.enum(["true", "false"]).default("false"),
    DROP_EMAIL_FROM_EMAIL: z.email().optional(),
    // Commercial email law (CAN-SPAM in the US) requires a physical mailing address in every marketing
    // email, so drop emails refuse to send without one. One line: it is printed in each email's footer.
    STORE_POSTAL_ADDRESS: z
      .string()
      .trim()
      .min(10)
      .max(300)
      .refine((value) => !/[\r\n]/.test(value), "Use a single-line mailing address")
      .optional(),
    CRON_SECRET: singleLineCredential.min(32).optional(),
    GOOGLE_TAG_ENABLED: z.string().optional(),
    GOOGLE_TAG_ID: z.string().optional(),
    META_PIXEL_ENABLED: z.string().optional(),
    META_PIXEL_ID: z.string().optional(),
    ADMIN_LIBRARY_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    ADMIN_OWNER_EMAIL: z.email().optional(),
    ADMIN_SETUP_SECRET: z.string().min(32).max(256).optional(),
    SUPABASE_SECRET_KEY: singleLineCredential.min(1).optional(),
    BLOB_READ_WRITE_TOKEN: singleLineCredential.optional(),
    BLOB_STORE_ID: singleLineCredential.optional(),
    PRIVATE_BLOB_READ_WRITE_TOKEN: singleLineCredential.min(1).optional(),
  },
  client: {
    NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST: z
      .string()
      .refine(isPublicBlobHost, "Use a public Vercel Blob store hostname")
      .optional(),
    NEXT_PUBLIC_SITE_URL: z.url().optional(),
    NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: singleLineCredential.min(1).optional(),
  },
}
