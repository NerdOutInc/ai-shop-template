import { googleTag } from "./google-tag"
import { marketingPreferences } from "./marketing-preferences"
import { metaPixel } from "./meta-pixel"
import { parseMarketingPreference } from "./parse-marketing-preference"

export function isMarketingDenied(now: number) {
  if (metaPixel.getSnapshot().consent === "denied" || googleTag.getSnapshot().consent === "denied") return true
  for (const key of Object.values(marketingPreferences.keys)) {
    try {
      if (parseMarketingPreference(localStorage.getItem(key), now)?.consent === "denied") return true
    } catch {
      // One unreadable preference must not hide a valid denial for the other provider.
    }
  }
  return false
}
