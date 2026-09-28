import { z } from "zod"
import { isStoreTimeZone } from "./is-store-time-zone"

const color = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex color")
const localAsset = z.string().regex(/^\/(?!\/)/, "Use an asset path beginning with one slash")
const text = z.string().trim().min(1)
const estimate = z
  .object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() })
  .refine(({ min, max }) => min <= max, "Minimum cannot exceed maximum")
export const storeConfigSchema = z
  .object({
    configured: z.boolean(),
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: text.max(70),
    description: text,
    tagline: text,
    locale: text,
    timeZone: text.refine(isStoreTimeZone, "Use UTC or an IANA region/city time zone such as America/New_York"),
    weeklyFeature: z.object({
      weekday: z.number().int().min(0).max(6),
      hour: z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59),
    }),
    supportEmail: z.email(),
    logo: z.object({ src: localAsset, width: z.number().positive(), height: z.number().positive() }),
    socialLinks: z.array(z.object({ label: text, url: z.url().refine((url) => url.startsWith("https://")) })),
    theme: z.object({
      background: color,
      foreground: color,
      primary: color,
      primaryForeground: color,
      secondary: color,
      mutedForeground: color,
      accent: color,
      accentForeground: color,
      border: color,
    }),
    home: z.object({ headline: text, introduction: text, shopLabel: text }),
    about: z.object({ heading: text, paragraphs: z.array(text).min(1) }),
    commerce: z.object({
      // Permanent payment identity; cosmetic brand IDs can change independently.
      identity: z
        .string()
        .max(80)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      shippingConfirmed: z.boolean(),
      firstItemShippingCents: z.number().int().nonnegative(),
      additionalItemShippingCents: z.number().int().nonnegative(),
      deliveryEstimates: z.object({
        handling: estimate.refine(({ max }) => max >= 2 && max <= 30, "Handling maximum must be 2 to 30 business days"),
        transit: estimate,
        extendedTransit: estimate,
        extendedRegions: z.array(z.string().regex(/^[A-Z]{2}$/)),
      }),
    }),
    policies: z.object({
      published: z.boolean(),
      shippingText: z.array(text),
      returnsText: z.array(text),
      privacyText: z.array(text),
    }),
  })
  .superRefine((store, context) => {
    if (
      store.configured &&
      (store.id === "your-store" ||
        store.commerce.identity === "your-store" ||
        store.supportEmail.endsWith("@example.com"))
    ) {
      context.addIssue({
        code: "custom",
        message: "Replace the placeholder store ID, commerce identity, and support email before launch",
      })
    }
    if (
      store.policies.published &&
      (!store.policies.shippingText.length || !store.policies.returnsText.length || !store.policies.privacyText.length)
    ) {
      context.addIssue({ code: "custom", message: "All three owner-approved policies are required before publishing" })
    }
  })
