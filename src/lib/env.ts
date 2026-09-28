import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

import { isPublicBlobHost } from "./is-public-blob-host"

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    VERCEL: z.enum(["1"]).optional(),
    CHECKOUT_RATE_LIMIT_SECRET: z.string().min(32).max(256).optional(),
    CHECKOUT_CAPACITY_LIMITS: z.string().optional(),
    VERCEL_URL: z.string().min(1).optional(),
    VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
    PRINTIFY_API_TOKEN: z.string().optional(),
    PRINTIFY_PUBLISHING_API_TOKEN: z.string().optional(),
    PRINTIFY_DRAFTS_API_TOKEN: z.string().optional(),
    PRINTIFY_SHOP_ID: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    DATABASE_SSL_CA: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_TAX_ENABLED: z.enum(["true", "false"]).optional(),
    PRINTIFY_FULFILLMENT_ENABLED: z.enum(["true", "false"]).optional(),
    PRINTIFY_PUBLISHING_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PRINTIFY_WEBHOOK_SECRET: z.string().min(32).optional(),
    PRINTIFY_MONITOR_SECRET: z.string().min(32).optional(),
    GOOGLE_MERCHANT_FEED_PASSWORD: z.string().min(32).max(256).optional(),
    META_CATALOG_FEED_PASSWORD: z.string().min(32).max(256).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    ORDER_ALERT_FROM_EMAIL: z.email().optional(),
    ORDER_ALERTS_ENABLED: z.enum(["true", "false"]).default("false"),
    CRON_SECRET: z.string().min(32).optional(),
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
    SUPABASE_SECRET_KEY: z.string().min(1).optional(),
    PRIVATE_BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
  },
  client: {
    NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST: z
      .string()
      .refine(isPublicBlobHost, "Use a public Vercel Blob store hostname")
      .optional(),
    NEXT_PUBLIC_SITE_URL: z.url().optional(),
    NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    CHECKOUT_RATE_LIMIT_SECRET: process.env.CHECKOUT_RATE_LIMIT_SECRET,
    CHECKOUT_CAPACITY_LIMITS: process.env.CHECKOUT_CAPACITY_LIMITS,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    PRINTIFY_API_TOKEN: process.env.PRINTIFY_API_TOKEN,
    PRINTIFY_PUBLISHING_API_TOKEN: process.env.PRINTIFY_PUBLISHING_API_TOKEN,
    PRINTIFY_DRAFTS_API_TOKEN: process.env.PRINTIFY_DRAFTS_API_TOKEN,
    PRINTIFY_SHOP_ID: process.env.PRINTIFY_SHOP_ID,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_SSL_CA: process.env.DATABASE_SSL_CA,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_TAX_ENABLED: process.env.STRIPE_TAX_ENABLED,
    PRINTIFY_FULFILLMENT_ENABLED: process.env.PRINTIFY_FULFILLMENT_ENABLED,
    PRINTIFY_PUBLISHING_ENABLED: process.env.PRINTIFY_PUBLISHING_ENABLED,
    PRINTIFY_WEBHOOK_SECRET: process.env.PRINTIFY_WEBHOOK_SECRET,
    PRINTIFY_MONITOR_SECRET: process.env.PRINTIFY_MONITOR_SECRET,
    GOOGLE_MERCHANT_FEED_PASSWORD: process.env.GOOGLE_MERCHANT_FEED_PASSWORD,
    META_CATALOG_FEED_PASSWORD: process.env.META_CATALOG_FEED_PASSWORD,
    NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST: process.env.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    ORDER_ALERT_FROM_EMAIL: process.env.ORDER_ALERT_FROM_EMAIL,
    ORDER_ALERTS_ENABLED: process.env.ORDER_ALERTS_ENABLED,
    CRON_SECRET: process.env.CRON_SECRET,
    GOOGLE_TAG_ENABLED: process.env.GOOGLE_TAG_ENABLED,
    GOOGLE_TAG_ID: process.env.GOOGLE_TAG_ID,
    META_PIXEL_ENABLED: process.env.META_PIXEL_ENABLED,
    META_PIXEL_ID: process.env.META_PIXEL_ID,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    ADMIN_LIBRARY_ENABLED: process.env.ADMIN_LIBRARY_ENABLED,
    ADMIN_OWNER_EMAIL: process.env.ADMIN_OWNER_EMAIL,
    ADMIN_SETUP_SECRET: process.env.ADMIN_SETUP_SECRET,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    PRIVATE_BLOB_READ_WRITE_TOKEN: process.env.PRIVATE_BLOB_READ_WRITE_TOKEN,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  },
  emptyStringAsUndefined: true,
})
