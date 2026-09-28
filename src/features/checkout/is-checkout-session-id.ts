export function isCheckoutSessionId(value: unknown): value is string {
  return typeof value === "string" && /^cs_(test_|live_)?[A-Za-z0-9]{10,250}$/.exec(value)?.[0] === value
}
