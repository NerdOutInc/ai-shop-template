import { describe, expect, it } from "vitest"

import { storeConfig } from "../../test/store-config"

import { storeConfigSchema } from "./store-config-schema"

describe("storeConfigSchema", () => {
  it("validates the fixed test brand without granting launch approvals", () => {
    const parsed = storeConfigSchema.parse(storeConfig)

    expect(parsed).toEqual(storeConfig)
    expect(parsed).toMatchObject({
      configured: false,
      commerce: { shippingConfirmed: false },
      policies: { published: false },
    })
  })

  it.each([
    { field: "id", change: { id: "Brand With Spaces" }, path: ["id"] },
    { field: "name", change: { name: "   " }, path: ["name"] },
    { field: "support email", change: { supportEmail: "ask us on social" }, path: ["supportEmail"] },
    { field: "time zone", change: { timeZone: "Not/A_Zone" }, path: ["timeZone"] },
    {
      field: "weekly weekday",
      change: { weeklyFeature: { weekday: 7, hour: 9, minute: 0 } },
      path: ["weeklyFeature", "weekday"],
    },
    {
      field: "weekly hour",
      change: { weeklyFeature: { weekday: 1, hour: 24, minute: 0 } },
      path: ["weeklyFeature", "hour"],
    },
    {
      field: "weekly minute",
      change: { weeklyFeature: { weekday: 1, hour: 9, minute: 60 } },
      path: ["weeklyFeature", "minute"],
    },
    {
      field: "fractional cadence",
      change: { weeklyFeature: { weekday: 1.5, hour: 9, minute: 0 } },
      path: ["weeklyFeature", "weekday"],
    },
    {
      field: "theme color",
      change: { theme: { ...storeConfig.theme, primary: "blue" } },
      path: ["theme", "primary"],
    },
    {
      field: "external logo",
      change: { logo: { ...storeConfig.logo, src: "https://assets.example/logo.svg" } },
      path: ["logo", "src"],
    },
    {
      field: "protocol-relative logo",
      change: { logo: { ...storeConfig.logo, src: "//assets.example/logo.svg" } },
      path: ["logo", "src"],
    },
    {
      field: "logo dimensions",
      change: { logo: { ...storeConfig.logo, width: 0 } },
      path: ["logo", "width"],
    },
    {
      field: "insecure social URL",
      change: { socialLinks: [{ label: "Community", url: "http://social.example/brand" }] },
      path: ["socialLinks", 0, "url"],
    },
    {
      field: "negative shipping",
      change: { commerce: { ...storeConfig.commerce, firstItemShippingCents: -1 } },
      path: ["commerce", "firstItemShippingCents"],
    },
    {
      field: "fractional shipping cents",
      change: { commerce: { ...storeConfig.commerce, additionalItemShippingCents: 99.5 } },
      path: ["commerce", "additionalItemShippingCents"],
    },
  ])("rejects an invalid owner-provided $field", ({ change, path }) => {
    const result = storeConfigSchema.safeParse({ ...storeConfig, ...change })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.map((issue) => issue.path)).toContainEqual(path)
  })

  it.each([
    { min: 6, max: 5 },
    { min: -1, max: 5 },
    { min: 2, max: 2.5 },
  ])("rejects an invalid delivery estimate $min–$max", (transit) => {
    const result = storeConfigSchema.safeParse({
      ...storeConfig,
      commerce: {
        ...storeConfig.commerce,
        deliveryEstimates: { ...storeConfig.commerce.deliveryEstimates, transit },
      },
    })

    expect(result.success).toBe(false)
  })

  it.each([1, 31])("rejects a handling maximum of %s business days", (max) => {
    expect(
      storeConfigSchema.safeParse({
        ...storeConfig,
        commerce: {
          ...storeConfig.commerce,
          deliveryEstimates: { ...storeConfig.commerce.deliveryEstimates, handling: { min: 0, max } },
        },
      }).success
    ).toBe(false)
  })

  it.each([{ id: "your-store" }, { supportEmail: "support@example.com" }])(
    "allows unfinished placeholder %j only while unconfigured",
    (placeholder) => {
      expect(storeConfigSchema.safeParse({ ...storeConfig, ...placeholder, configured: false }).success).toBe(true)
      expect(storeConfigSchema.safeParse({ ...storeConfig, ...placeholder, configured: true }).success).toBe(false)
    }
  )

  it.each(["shippingText", "returnsText", "privacyText"] as const)(
    "requires owner-approved %s before publishing policies",
    (missingPolicy) => {
      const policies = {
        published: true,
        shippingText: ["Orders ship within the confirmed delivery window."],
        returnsText: ["Contact our store for return assistance."],
        privacyText: ["Customer information is used to process orders."],
      }

      expect(storeConfigSchema.safeParse({ ...storeConfig, policies }).success).toBe(true)
      expect(
        storeConfigSchema.safeParse({ ...storeConfig, policies: { ...policies, [missingPolicy]: [] } }).success
      ).toBe(false)
    }
  )
})
