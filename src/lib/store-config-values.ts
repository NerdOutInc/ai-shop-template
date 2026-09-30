import type { StoreConfigInput } from "./store-config-schema"

// Public brand content only. Account IDs, API keys, and personal owner details belong in local environment settings.
export const storeConfigValues = {
  configured: false,
  id: "your-store",
  name: "Your Store",
  shortName: "Your Store",
  description: "A new home for original apparel. Our first collection is on its way.",
  tagline: "Make room for your next favorite.",
  locale: "en-US",
  timeZone: "UTC",
  features: { designOfTheWeek: false, dropSignup: false, about: false },
  privacy: { retainedDropSubscribers: false, retainedDropEmailRecords: false },
  weeklyFeature: { weekday: 1, hour: 9, minute: 0 },
  supportEmail: "support@example.com",
  logo: { src: "/images/store-mark.svg", width: 48, height: 48, showName: true },
  fonts: {
    body: '"Helvetica Neue", Arial, sans-serif',
    heading: '"Helvetica Neue", Arial, sans-serif',
    label: '"Helvetica Neue", Arial, sans-serif',
  },
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
    headline: "Your next favorite starts here.",
    introduction: "Something new is taking shape. Explore the store as we prepare our first collection.",
    shopLabel: "Explore the shop",
  },
  about: {
    heading: "A brand in the making.",
    paragraphs: [
      "We’re getting ready to share our first collection. Come back soon to discover our story and designs.",
    ],
  },
  commerce: {
    // Permanent payment identity: the first new checkout attempt (even a test) pins it in the database.
    // Keep this value through rebrands.
    identity: "your-store",
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
} satisfies StoreConfigInput
