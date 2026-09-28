import { storeConfigSchema } from "@/lib/store-config-schema"

// A complete test brand, independent of the merchant-editable store configuration.
export const storeConfig = storeConfigSchema.parse({
  configured: false,
  id: "fixture-store",
  name: "Fixture Store",
  description: "Original shirts for good company and the weekend ahead.",
  tagline: "Wear your Friday feeling.",
  locale: "en-US",
  timeZone: "America/Chicago",
  weeklyFeature: { weekday: 5, hour: 17, minute: 30 },
  supportEmail: "support@fixture.example",
  logo: { src: "/images/store-mark.svg", width: 48, height: 48 },
  socialLinks: [],
  theme: {
    background: "#fafbfc",
    foreground: "#18202b",
    primary: "#25364d",
    primaryForeground: "#ffffff",
    secondary: "#edf1f6",
    mutedForeground: "#536174",
    accent: "#dbe8fa",
    accentForeground: "#18202b",
    border: "#cad2dd",
  },
  home: {
    headline: "Fresh shirts. Friday energy.",
    introduction: "Made for the plans that start when the workweek ends. Discover a collection worth staying out for.",
    shopLabel: "Find your Friday shirt",
  },
  about: {
    heading: "Built for good company.",
    paragraphs: ["Our Chicago studio turns everyday moments into apparel with a little extra personality."],
  },
  commerce: {
    shippingConfirmed: false,
    firstItemShippingCents: 0,
    additionalItemShippingCents: 0,
    deliveryEstimates: {
      handling: { min: 2, max: 10 },
      transit: { min: 2, max: 5 },
      extendedTransit: { min: 9, max: 17 },
      extendedRegions: ["AK", "HI"],
    },
  },
  policies: {
    published: false,
    shippingText: [],
    returnsText: [],
    privacyText: [],
  },
})
