export function isStoreTimeZone(timeZone: string) {
  // Require a named region or UTC; reversed-sign Etc/GMT offsets are easy to misread.
  if ((timeZone !== "UTC" && !timeZone.includes("/")) || /^Etc\/GMT[+-]\d+$/.test(timeZone)) return false
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format()
    return true
  } catch {
    return false
  }
}
