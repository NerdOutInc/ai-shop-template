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
    { field: "launcher name", change: { shortName: "A much longer launcher label" }, path: ["shortName"] },
    { field: "locale syntax", change: { locale: "en_US" }, path: ["locale"] },
    { field: "unsupported language", change: { locale: "fr-CA" }, path: ["locale"] },
    { field: "unsupported regional formatting", change: { locale: "en-GB" }, path: ["locale"] },
    { field: "support email", change: { supportEmail: "ask us on social" }, path: ["supportEmail"] },
    {
      field: "font declaration",
      change: { fonts: { ...storeConfig.fonts, body: "Arial; color: red" } },
      path: ["fonts", "body"],
    },
    {
      field: "font function",
      change: { fonts: { ...storeConfig.fonts, heading: "url(https://font.example)" } },
      path: ["fonts", "heading"],
    },
    { field: "offset time zone", change: { timeZone: "-05:00" }, path: ["timeZone"] },
    { field: "abbreviated time zone", change: { timeZone: "CST" }, path: ["timeZone"] },
    { field: "reversed offset time zone", change: { timeZone: "Etc/GMT+5" }, path: ["timeZone"] },
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
    '\"Arial, sans-serif',
    "'Arial, sans-serif",
    'Arial\", sans-serif',
    "Arial', sans-serif",
    "\"Arial', sans-serif",
    'Arial, \"Helvetica Neue',
    "Arial,, sans-serif",
    "Arial, , sans-serif",
    ",Arial",
    "Arial,",
    "123, sans-serif",
    "123Brand, sans-serif",
    "-123Brand, sans-serif",
    "Font 2, sans-serif",
    "inherit, sans-serif",
    "initial",
    "unset, Arial",
    "revert-layer, Arial",
    "default, Arial",
    "InHeRiT, Arial",
    "serif Display, sans-serif",
    "system-ui Display, sans-serif",
    "math Display, sans-serif",
    'Arial \"Helvetica Neue\", sans-serif',
    '\"\", serif',
    "'  ', serif",
    '\"Arial\"\"Helvetica Neue\", sans-serif',
    "Arial\n, sans-serif",
  ])("rejects malformed font-family list %j for every font role", (font) => {
    for (const role of ["body", "heading", "label"] as const) {
      const result = storeConfigSchema.safeParse({ ...storeConfig, fonts: { ...storeConfig.fonts, [role]: font } })
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.issues.map((issue) => issue.path)).toContainEqual(["fonts", role])
    }
  })

  it.each([
    '\"Helvetica Neue\", Arial, sans-serif',
    "'Times New Roman', Georgia, serif",
    "Helvetica Neue, Arial, sans-serif",
    'system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif',
    "ui-monospace, SFMono-Regular, Menlo, monospace",
    '\"Font 2\", Arial, sans-serif',
    "'Brand, Display', cursive",
    `"Founder's Font", serif`,
    `'Brand "Display"', fantasy`,
    "--brand-font, _Brand2, sans-serif",
    '"serif Display", sans-serif',
    '"default", Arial2, sans-serif',
    '\"inherit\", sans-serif',
  ])("preserves valid font-family list %j", (font) => {
    const result = storeConfigSchema.parse({ ...storeConfig, fonts: { body: font, heading: font, label: font } })
    expect(result.fonts).toEqual({ body: font, heading: font, label: font })
  })

  it("accepts a dark accent with readable light text", () => {
    expect(
      storeConfigSchema.safeParse({
        ...storeConfig,
        shortName: "Fixture",
        theme: { ...storeConfig.theme, accent: "#1e3a8a", accentForeground: "#ffffff" },
      }).success
    ).toBe(true)
  })

  it.each([
    ["background", "foreground"],
    ["secondary", "foreground"],
    ["background", "mutedForeground"],
    ["secondary", "mutedForeground"],
    ["primary", "primaryForeground"],
    ["accent", "accentForeground"],
  ] as const)("rejects unreadable %s/%s text colors", (background, foreground) => {
    const result = storeConfigSchema.safeParse({
      ...storeConfig,
      theme: { ...storeConfig.theme, [foreground]: storeConfig.theme[background] },
    })
    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["theme", foreground],
          message: expect.stringContaining("4.5:1"),
        })
      )
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

  it("accepts a completed brand when configured", () => {
    expect(storeConfigSchema.safeParse({ ...storeConfig, configured: true }).success).toBe(true)
  })

  it.each([
    { id: "your-store" },
    { name: "Your Store" },
    { shortName: "Your Store" },
    { commerce: { ...storeConfig.commerce, identity: "your-store" } },
    { supportEmail: "support@example.com" },
  ])("allows unfinished placeholder %j only while unconfigured", (placeholder) => {
    expect(storeConfigSchema.safeParse({ ...storeConfig, ...placeholder, configured: false }).success).toBe(true)
    expect(storeConfigSchema.safeParse({ ...storeConfig, ...placeholder, configured: true }).success).toBe(false)
  })

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
