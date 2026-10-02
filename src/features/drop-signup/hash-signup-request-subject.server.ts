import "server-only"
import { createHmac } from "node:crypto"

/** Domain-separated server keys keep a budget-table read from becoming an address lookup. */
export function hashSignupRequestSubject(subject: string, key: string | undefined, window: "hour" | "request") {
  if (!key?.trim()) throw new Error("Signup identity key is missing")
  let identity = subject
  if (window === "hour" && subject.endsWith("::/64")) {
    const prefix = subject.slice(0, -5).split(":")
    if (prefix.length !== 4 || prefix.some((part) => !/^[0-9a-f]{1,4}$/i.test(part)))
      throw new Error("Invalid signup IPv6 identity")
    // A residential /56 contains 256 /64s. Keep the short request bucket at /64,
    // but do not give that customer 256 independent shares of the hourly store budget.
    identity = `${prefix.slice(0, 3).join(":")}:${(parseInt(prefix[3]!, 16) & 0xff00).toString(16)}::/56`
  }
  return createHmac("sha256", key).update(`drop-signup/${window}:${identity}`).digest("hex")
}
