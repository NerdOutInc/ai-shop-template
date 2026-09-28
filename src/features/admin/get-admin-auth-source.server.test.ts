import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getAdminAuthSource } from "./get-admin-auth-source.server"

const state = vi.hoisted(() => ({ headers: new Headers(), siteUrl: undefined as string | undefined }))
vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ headers: async () => state.headers }))
vi.mock("@/lib/env", () => ({
  env: {
    get NEXT_PUBLIC_SITE_URL() {
      return state.siteUrl
    },
  },
}))

beforeEach(() => {
  state.headers = new Headers()
  state.siteUrl = "https://store.example.test"
  vi.stubEnv("NODE_ENV", "production")
  vi.stubEnv("VERCEL", "1")
})
afterEach(() => vi.unstubAllEnvs())

describe("trusted admin authentication source", () => {
  it("uses the Vercel platform address, ignoring caller forwarding and host headers", async () => {
    state.headers = new Headers({
      "x-vercel-forwarded-for": "192.0.2.1",
      "x-forwarded-for": "192.0.2.2",
      "x-real-ip": "192.0.2.3",
      host: "localhost",
    })
    expect(await getAdminAuthSource()).toBe("192.0.2.1")
  })

  it("normalizes equivalent IPv6 sources into the same bucket", async () => {
    state.headers.set("x-vercel-forwarded-for", "2001:0DB8:0000:0000:0000:0000:0000:0001")
    const source = await getAdminAuthSource()
    state.headers.set("x-vercel-forwarded-for", "2001:db8::1")
    expect(await getAdminAuthSource()).toBe(source)
  })

  it.each([null, "not-an-address", "192.0.2.1, 192.0.2.2", "192.0.2.1:3000"])(
    "fails closed on an invalid platform source: %s",
    async (source) => {
      if (source) state.headers.set("x-vercel-forwarded-for", source)
      state.headers.set("x-forwarded-for", "192.0.2.1")
      expect(await getAdminAuthSource()).toBeNull()
    }
  )

  it("does not trust a forged platform header outside Vercel or caller loopback Host", async () => {
    vi.stubEnv("VERCEL", "")
    state.headers = new Headers({ "x-vercel-forwarded-for": "192.0.2.1", host: "localhost:3100" })
    expect(await getAdminAuthSource()).toBeNull()
  })

  it("supports explicit HTTP loopback in production-mode local tests with one fixed source", async () => {
    vi.stubEnv("VERCEL", "")
    state.siteUrl = "http://localhost:3100"
    state.headers.set("x-forwarded-for", "192.0.2.1")
    expect(await getAdminAuthSource()).toBe("local-development")
    state.headers.set("x-forwarded-for", "192.0.2.2")
    expect(await getAdminAuthSource()).toBe("local-development")
  })

  it("allows unconfigured local development but never an unconfigured production deployment", async () => {
    vi.stubEnv("VERCEL", "")
    state.siteUrl = undefined
    expect(await getAdminAuthSource()).toBeNull()
    vi.stubEnv("NODE_ENV", "development")
    expect(await getAdminAuthSource()).toBe("local-development")
  })
})
