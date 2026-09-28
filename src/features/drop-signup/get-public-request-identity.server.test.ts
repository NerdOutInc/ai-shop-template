import { isIP } from "node:net"

import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { getPublicRequestIdentity } from "./get-public-request-identity.server"

const state = vi.hoisted(() => ({ headers: new Headers() }))
vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ headers: async () => state.headers }))

beforeEach(() => {
  state.headers = new Headers()
  vi.stubEnv("VERCEL", "1")
})
afterEach(() => vi.unstubAllEnvs())

it("counts and records the platform's own address, never the caller's forwarding header", async () => {
  state.headers = new Headers({
    "x-vercel-forwarded-for": "203.0.113.7",
    "x-forwarded-for": "198.51.100.1",
  })
  await expect(getPublicRequestIdentity()).resolves.toEqual({
    subject: "203.0.113.7",
    limit: 5,
    address: "203.0.113.7",
  })
})

// `inet` stores either form, but the recorded proof should be one spelling per address, and the
// bucket one spelling per /64: a customer is handed the whole prefix, so counting by address would
// let one flooder hop between 2^64 buckets.
it("records a canonical IPv6 address in full, and counts it by its /64", async () => {
  state.headers = new Headers({ "x-vercel-forwarded-for": "2001:0db8:0000:0000:0000:0000:0000:0001" })
  const identity = await getPublicRequestIdentity()
  expect(identity).toEqual({ subject: "2001:db8:0:0::/64", limit: 5, address: "2001:db8::1" })
})

it("puts two addresses from one /64 in one bucket while keeping each as its own proof", async () => {
  state.headers = new Headers({ "x-vercel-forwarded-for": "2001:db8:1:2::7" })
  const one = await getPublicRequestIdentity()
  state.headers = new Headers({ "x-vercel-forwarded-for": "2001:DB8:1:2:ffff:ffff:ffff:ffff" })
  const two = await getPublicRequestIdentity()
  state.headers = new Headers({ "x-vercel-forwarded-for": "2001:db8:1:3::7" })
  const neighbour = await getPublicRequestIdentity()

  expect(one).toEqual({ subject: "2001:db8:1:2::/64", limit: 5, address: "2001:db8:1:2::7" })
  expect(two).toEqual({ subject: "2001:db8:1:2::/64", limit: 5, address: "2001:db8:1:2:ffff:ffff:ffff:ffff" })
  expect(neighbour?.subject).toBe("2001:db8:1:3::/64")
})

// `::` can stand for any run of zeros, anywhere, so the prefix has to come from the expanded address.
it.each([
  ["2001:db8:1::5", "2001:db8:1:0::/64"],
  ["2001:db8:0:0:1::", "2001:db8:0:0::/64"],
  ["2001:db8::1:0:0:1", "2001:db8:0:0::/64"],
  ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64"],
  ["1::", "1:0:0:0::/64"],
  ["::1", "0:0:0:0::/64"],
  ["::", "0:0:0:0::/64"],
])("counts %s against %s", async (forwarded, subject) => {
  state.headers = new Headers({ "x-vercel-forwarded-for": forwarded })
  expect((await getPublicRequestIdentity())?.subject).toBe(subject)
})

// Every IPv4-mapped address sits in ::/64, so counting those by prefix would be one bucket for all
// of IPv4. The recorded form is plain hex, which `inet` accepts.
it("keeps an IPv4-mapped address storable, and in a bucket of its own", async () => {
  state.headers = new Headers({ "x-vercel-forwarded-for": "::ffff:203.0.113.7" })
  const identity = await getPublicRequestIdentity()
  expect(identity).toEqual({ subject: "::ffff:cb00:7107", limit: 5, address: "::ffff:cb00:7107" })
  expect(isIP(identity!.address!)).toBe(6)

  state.headers = new Headers({ "x-vercel-forwarded-for": "::ffff:203.0.113.8" })
  expect((await getPublicRequestIdentity())?.subject).not.toBe(identity?.subject)
})

// `isIP` accepts a zone id and URL does not; the refusal has to be a null, not a thrown 500.
it("refuses a scoped address rather than throwing", async () => {
  state.headers = new Headers({ "x-vercel-forwarded-for": "fe80::1%eth0" })
  await expect(getPublicRequestIdentity()).resolves.toBeNull()
})

it("refuses the request when the platform address is missing or malformed", async () => {
  await expect(getPublicRequestIdentity()).resolves.toBeNull()
  state.headers = new Headers({ "x-vercel-forwarded-for": "not-an-address" })
  await expect(getPublicRequestIdentity()).resolves.toBeNull()
})

// Off the platform there is no trustworthy address; recording the submitted one, or a loopback
// stand-in, would be evidence of nothing.
it("shares one generous bucket and records no address off the platform", async () => {
  vi.stubEnv("VERCEL", "")
  state.headers = new Headers({ "x-forwarded-for": "198.51.100.1" })
  await expect(getPublicRequestIdentity()).resolves.toEqual({
    subject: "unidentified-host",
    limit: 60,
    address: null,
  })
})
