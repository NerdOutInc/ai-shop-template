import { marketingPreferences } from "./marketing-preferences"

export type MarketingPreference = { consent: "granted" | "denied"; expiresAt: number }

export function parseMarketingPreference(value: string | null, now = Date.now()): MarketingPreference | null {
  try {
    const parsed: unknown = JSON.parse(value ?? "null")
    if (
      parsed &&
      typeof parsed === "object" &&
      "consent" in parsed &&
      (parsed.consent === "granted" || parsed.consent === "denied") &&
      "expiresAt" in parsed &&
      typeof parsed.expiresAt === "number" &&
      Number.isSafeInteger(parsed.expiresAt) &&
      parsed.expiresAt > now &&
      parsed.expiresAt <= now + marketingPreferences.lifetimeMs
    )
      return { consent: parsed.consent, expiresAt: parsed.expiresAt }
  } catch {
    // Malformed storage cannot grant consent or create an indefinite denial.
  }
  return null
}
