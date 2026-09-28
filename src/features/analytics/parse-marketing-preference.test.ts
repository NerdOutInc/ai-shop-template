import { describe, expect, it } from "vitest"

import { marketingPreferences } from "./marketing-preferences"
import { parseMarketingPreference } from "./parse-marketing-preference"

const now = Date.parse("2026-09-22T12:00:00.000Z")

describe("marketing preference validation", () => {
  it.each(["granted", "denied"])("accepts %s only within the preference lifetime", (consent) => {
    for (const expiresIn of [1, marketingPreferences.lifetimeMs]) {
      const preference = { consent, expiresAt: now + expiresIn }
      expect(parseMarketingPreference(JSON.stringify(preference), now)).toEqual(preference)
    }
    for (const expiresIn of [0, -1, marketingPreferences.lifetimeMs + 1, 0.5]) {
      expect(parseMarketingPreference(JSON.stringify({ consent, expiresAt: now + expiresIn }), now)).toBeNull()
    }
  })

  it.each([null, "invalid", "null", "true", "[]", '"denied"', '{"consent":"denied","expiresAt":"forever"}'])(
    "rejects malformed storage without granting or denying: %s",
    (value) => expect(parseMarketingPreference(value, now)).toBeNull()
  )
})
