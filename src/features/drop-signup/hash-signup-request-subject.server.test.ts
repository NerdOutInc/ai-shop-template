import { createHash } from "node:crypto"
import { expect, it, vi } from "vitest"
import { hashSignupRequestSubject } from "./hash-signup-request-subject.server"
vi.mock("server-only", () => ({}))

it("does not expose an enumerable address digest and separates keys and limiter windows", () => {
  const subject = "203.0.113.7"
  const digest = hashSignupRequestSubject(subject, "private-fixture-key", "hour")
  expect(digest).not.toBe(createHash("sha256").update(`signup-hour:${subject}`).digest("hex"))
  expect(digest).not.toBe(hashSignupRequestSubject(subject, "different-fixture-key", "hour"))
  expect(digest).not.toBe(hashSignupRequestSubject(subject, "private-fixture-key", "request"))
  expect(digest).toBe(hashSignupRequestSubject(subject, "private-fixture-key", "hour"))
  expect(() => hashSignupRequestSubject(subject, undefined, "hour")).toThrow("key is missing")
})

it("shares the hourly quota across a residential /56 while retaining distinct /64 request buckets", () => {
  const one = "2001:db8:1:ab00::/64"
  const two = "2001:db8:1:abff::/64"
  const neighbour = "2001:db8:1:ac00::/64"
  const key = "private-fixture-key"
  expect(hashSignupRequestSubject(one, key, "hour")).toBe(hashSignupRequestSubject(two, key, "hour"))
  expect(hashSignupRequestSubject(one, key, "request")).not.toBe(hashSignupRequestSubject(two, key, "request"))
  expect(hashSignupRequestSubject(one, key, "hour")).not.toBe(hashSignupRequestSubject(neighbour, key, "hour"))
  expect(hashSignupRequestSubject("::ffff:cb00:7107", key, "hour")).not.toBe(
    hashSignupRequestSubject("::ffff:cb00:7108", key, "hour")
  )
})
