import { classifyStoreVisitSource } from "./classify-store-visit-source"

const sources = ["organic_search", "paid", "social", "email", "referral", "direct"] as const
type VisitSource = (typeof sources)[number]
const storageKey = "your-store-visit-source-v1"
const lifetime = 24 * 60 * 60 * 1000
let currentVisit: { source: VisitSource; createdAt: number } | undefined

function readVisit(saved: unknown, now: number) {
  if (
    saved &&
    typeof saved === "object" &&
    "source" in saved &&
    "createdAt" in saved &&
    sources.some((source) => source === saved.source) &&
    typeof saved.createdAt === "number" &&
    Number.isFinite(saved.createdAt) &&
    saved.createdAt <= now &&
    now - saved.createdAt < lifetime
  )
    return { source: saved.source as VisitSource, createdAt: saved.createdAt }
}

export function getStoreVisitSource(): VisitSource {
  const now = Date.now()
  if (currentVisit && currentVisit.createdAt <= now && now - currentVisit.createdAt < lifetime)
    return currentVisit.source
  try {
    const saved = readVisit(JSON.parse(sessionStorage.getItem(storageKey) ?? "null"), now)
    if (saved) {
      currentVisit = saved
      return currentVisit.source
    }
  } catch {
    // Blocked storage still permits in-memory attribution for this page.
  }
  try {
    // A clean checkout return can recover its coarse source even when tab storage is blocked.
    // The history entry carries no raw referrer, campaign, or checkout capability.
    const recovered = readVisit(window.history.state?.kagCheckoutRecovery?.visit, now)
    if (recovered) {
      currentVisit = recovered
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(currentVisit))
      } catch {
        // The history entry and memory remain sufficient for this return.
      }
      return currentVisit.source
    }
  } catch {
    // An unavailable history entry must not interrupt attribution or shopping.
  }
  let source: VisitSource
  try {
    source = classifyStoreVisitSource(new URL(window.location.href), document.referrer)
  } catch {
    source = "direct"
  }
  currentVisit = { source, createdAt: now }
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(currentVisit))
  } catch {
    // Shopping never depends on analytics storage.
  }
  return source
}
