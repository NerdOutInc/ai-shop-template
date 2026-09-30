import { z } from "zod"
import { isStoreTimeZone } from "./is-store-time-zone"

const color = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex color")
const localAsset = z.string().regex(/^\/(?!\/)/, "Use an asset path beginning with one slash")
const text = z.string().trim().min(1)
const fontIdentifier = "(?:--|-?[a-z_])[a-z0-9_-]*"
const fontFamily = `(?:"[a-z0-9 ,_'\\-]+"|'[a-z0-9 ,_"\\-]+'|${fontIdentifier}(?: +${fontIdentifier})*)`
const fontListPattern = new RegExp(`^${fontFamily}(?: *, *${fontFamily})*$`, "i")
const fontFamilyPattern = new RegExp(fontFamily, "gi")
const reservedFontWord = /^(?:inherit|initial|unset|revert|revert-layer|default)$/i
const genericFontWord =
  /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong)$/i
const fontStack = text.max(200).refine((value) => {
  // A broken quote in a root CSS variable can consume all following theme declarations.
  if (!fontListPattern.test(value)) return false
  return [...value.matchAll(fontFamilyPattern)].every(([family]) => {
    if (family.startsWith('"') || family.startsWith("'")) return family.slice(1, -1).trim().length > 0
    const words = family.split(/ +/)
    return words.every((word) => !reservedFontWord.test(word) && (words.length === 1 || !genericFontWord.test(word)))
  })
}, "Use comma-separated font families with balanced quotes; quote names with numeric words or reserved words")

function contrastRatio(first: string, second: string) {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return channels.reduce(
      (sum, channel, index) => sum + channel * (index === 0 ? 0.2126 : index === 1 ? 0.7152 : 0.0722),
      0
    )
  }
  const a = luminance(first)
  const b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
const estimate = z
  .object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() })
  .refine(({ min, max }) => min <= max, "Minimum cannot exceed maximum")
export const storeConfigSchema = z
  .object({
    configured: z.boolean(),
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: text.max(70),
    shortName: text.max(12),
    description: text,
    tagline: text,
    locale: z.literal("en-US", {
      error: "The storefront currently supports en-US. Translation and regional formatting require implementation.",
    }),
    timeZone: text.refine(isStoreTimeZone, "Use UTC or an IANA region/city time zone such as America/New_York"),
    features: z.object({
      designOfTheWeek: z.boolean(),
      dropSignup: z.boolean(),
      about: z.boolean(),
    }),
    privacy: z.object({
      retainedDropSubscribers: z.boolean(),
      // Drop email delivery records outlive a pause in sending; this keeps Privacy describing them.
      retainedDropEmailRecords: z.boolean().default(false),
    }),
    weeklyFeature: z.object({
      weekday: z.number().int().min(0).max(6),
      hour: z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59),
    }),
    supportEmail: z.email(),
    logo: z.object({
      src: localAsset,
      width: z.number().int().positive().max(4096),
      height: z.number().int().positive().max(4096),
      showName: z.boolean(),
    }),
    fonts: z.object({ body: fontStack, heading: fontStack, label: fontStack }),
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
    const textPairs = [
      ["background", "foreground"],
      ["secondary", "foreground"],
      ["background", "mutedForeground"],
      ["secondary", "mutedForeground"],
      ["primary", "primaryForeground"],
      ["accent", "accentForeground"],
    ] as const
    for (const [background, foreground] of textPairs) {
      if (contrastRatio(store.theme[background], store.theme[foreground]) < 4.5) {
        context.addIssue({
          code: "custom",
          path: ["theme", foreground],
          message: `${foreground} on ${background} must have at least 4.5:1 text contrast`,
        })
      }
    }
    if (
      store.configured &&
      (store.id === "your-store" ||
        store.name === "Your Store" ||
        store.shortName === "Your Store" ||
        store.commerce.identity === "your-store" ||
        store.supportEmail.endsWith("@example.com"))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Replace the placeholder store ID, name, short name, commerce identity, and support email before launch",
      })
    }
    if (
      store.policies.published &&
      (!store.policies.shippingText.length || !store.policies.returnsText.length || !store.policies.privacyText.length)
    ) {
      context.addIssue({ code: "custom", message: "All three owner-approved policies are required before publishing" })
    }
  })
