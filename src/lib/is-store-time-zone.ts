export function isStoreTimeZone(timeZone: string) {
  // Intl accepts numeric offsets and bare aliases that PostgreSQL interprets differently.
  if (timeZone !== "UTC" && !timeZone.includes("/")) return false
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format()
    return true
  } catch {
    return false
  }
}
