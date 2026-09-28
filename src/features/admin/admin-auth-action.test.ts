import { beforeEach, describe, expect, it, vi } from "vitest"
import { adminAuthAction } from "./admin-auth-action"

const mocks = vi.hoisted(() => ({
  configured: true,
  getUser: vi.fn(),
  signOut: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  inviteUserByEmail: vi.fn(),
  setupStatus: vi.fn(),
  allowAuthAttempt: vi.fn(),
  claimOwner: vi.fn(),
  isActiveMember: vi.fn(),
  getActor: vi.fn(),
  getSource: vi.fn(),
  secret: "a-separate-random-setup-secret-for-testing-only",
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({
  env: {
    ADMIN_OWNER_EMAIL: "owner@example.test",
    get ADMIN_SETUP_SECRET() {
      return mocks.secret
    },
    SUPABASE_SECRET_KEY: "server-secret-fixture",
  },
}))
vi.mock("./get-admin-auth-config.server", () => ({
  getAdminAuthConfig: () => (mocks.configured ? { url: "http://localhost", key: "publishable-fixture" } : null),
}))
vi.mock("./get-admin-auth-source.server", () => ({ getAdminAuthSource: mocks.getSource }))
vi.mock("./get-admin-database.server", () => ({ getAdminDatabase: () => ({}) }))
vi.mock("./create-admin-server-client.server", () => ({
  createAdminServerClient: () => ({
    auth: {
      getUser: mocks.getUser,
      signOut: mocks.signOut,
      signInWithOtp: mocks.signInWithOtp,
      verifyOtp: mocks.verifyOtp,
    },
  }),
}))
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { admin: { inviteUserByEmail: mocks.inviteUserByEmail } } }),
}))
vi.mock("./get-admin-actor.server", () => ({ getAdminActor: mocks.getActor }))
vi.mock("./admin-store.server", () => ({
  AdminStore: class {
    setupStatus = mocks.setupStatus
    allowAuthAttempt = mocks.allowAuthAttempt
    claimOwner = mocks.claimOwner
    isActiveMember = mocks.isActiveMember
  },
}))

beforeEach(() => {
  mocks.configured = true
  mocks.getSource.mockResolvedValue("192.0.2.1")
  mocks.setupStatus.mockResolvedValue("available")
  mocks.allowAuthAttempt.mockResolvedValue(true)
  mocks.claimOwner.mockResolvedValue(true)
  mocks.isActiveMember.mockResolvedValue(false)
  mocks.getActor.mockResolvedValue({ userId: "verified-owner" })
  mocks.inviteUserByEmail.mockResolvedValue({ error: null })
  mocks.signOut.mockResolvedValue({ error: null })
  mocks.signInWithOtp.mockResolvedValue({ error: null })
  mocks.verifyOtp.mockResolvedValue({ data: { user: { id: "otp-user" } }, error: null })
  mocks.getUser.mockResolvedValue({
    data: {
      user: {
        id: "verified-owner",
        email: "owner@example.test",
        email_confirmed_at: "2026-09-14T00:00:00Z",
        is_anonymous: false,
      },
    },
    error: null,
  })
})

describe("admin authentication server actions", () => {
  it.each([null, {}, { operation: "unknown" }, { operation: "verify-email", email: "x@y.test", token: "not-code" }])(
    "rejects malformed input before authentication",
    async (input) => {
      expect((await adminAuthAction(input)).ok).toBe(false)
      expect(mocks.verifyOtp).not.toHaveBeenCalled()
      expect(mocks.inviteUserByEmail).not.toHaveBeenCalled()
    }
  )

  it("keeps ordinary login invitation-only with indistinguishable unknown-email responses", async () => {
    const valid = await adminAuthAction({ operation: "request-email", email: "admin@example.test" })
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: "admin@example.test",
      options: { shouldCreateUser: false },
    })
    mocks.signInWithOtp.mockResolvedValueOnce({ error: { code: "user_not_found" } })
    expect(await adminAuthAction({ operation: "request-email", email: "stranger@example.test" })).toEqual(valid)
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled()
  })

  it("rejects a wrong setup key or a different email without provisioning or sending mail", async () => {
    for (const input of [
      {
        operation: "request-setup",
        email: "owner@example.test",
        proof: "incorrect-owner-key-with-at-least-32-characters",
      },
      { operation: "request-setup", email: "stranger@example.test", proof: mocks.secret },
    ])
      expect((await adminAuthAction(input)).ok).toBe(false)
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled()
    expect(mocks.signInWithOtp).not.toHaveBeenCalled()
  })

  it("invites only the configured owner without auto-confirming email or sending a second code", async () => {
    expect(
      (await adminAuthAction({ operation: "request-setup", email: "OWNER@example.test", proof: mocks.secret })).ok
    ).toBe(true)
    expect(mocks.inviteUserByEmail).toHaveBeenCalledWith("owner@example.test")
    expect(mocks.signInWithOtp).not.toHaveBeenCalled()
  })

  it("sends a regular OTP when the configured owner already has a confirmed account", async () => {
    mocks.inviteUserByEmail.mockResolvedValueOnce({ error: { code: "email_exists" } })
    expect(
      (await adminAuthAction({ operation: "request-setup", email: "owner@example.test", proof: mocks.secret })).ok
    ).toBe(true)
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: "owner@example.test",
      options: { shouldCreateUser: false },
    })
  })

  it("reports invitation delivery failures without claiming a code was sent", async () => {
    mocks.inviteUserByEmail.mockResolvedValueOnce({ error: { code: "unexpected_failure" } })
    expect(
      (await adminAuthAction({ operation: "request-setup", email: "owner@example.test", proof: mocks.secret })).ok
    ).toBe(false)
    expect(mocks.signInWithOtp).not.toHaveBeenCalled()
  })

  it("does not reopen consumed setup even with correct credentials", async () => {
    mocks.setupStatus.mockResolvedValue("recovery")
    expect(
      (
        await adminAuthAction({
          operation: "verify-setup",
          email: "owner@example.test",
          token: "123456",
          proof: mocks.secret,
        })
      ).ok
    ).toBe(false)
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
    expect(mocks.claimOwner).not.toHaveBeenCalled()
  })

  it("claims with the freshly verified Auth identity, never an input UUID or metadata", async () => {
    const result = await adminAuthAction({
      operation: "verify-setup",
      email: "owner@example.test",
      token: "123456",
      proof: mocks.secret,
      userId: "attacker",
      user_metadata: { admin: true },
    })
    expect(result.destination).toBe("/admin/account")
    expect(mocks.claimOwner).toHaveBeenCalledWith("verified-owner", "owner@example.test")
  })

  it("rejects an Auth identity whose current confirmed email does not match", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "other", email: "other@example.test", email_confirmed_at: "date" } },
      error: null,
    })
    expect(
      (
        await adminAuthAction({
          operation: "verify-setup",
          email: "owner@example.test",
          token: "123456",
          proof: mocks.secret,
        })
      ).ok
    ).toBe(false)
    expect(mocks.claimOwner).not.toHaveBeenCalled()
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" })
  })

  it("enforces rate limits before mail delivery or code verification", async () => {
    mocks.allowAuthAttempt.mockResolvedValue(false)
    expect((await adminAuthAction({ operation: "request-email", email: "owner@example.test" })).ok).toBe(false)
    expect(
      (await adminAuthAction({ operation: "verify-email", email: "owner@example.test", token: "123456" })).ok
    ).toBe(false)
    expect(mocks.signInWithOtp).not.toHaveBeenCalled()
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })

  it.each(["verify-email", "finish-passkey"])(
    "requires membership after %s authentication and clears non-admin sessions",
    async (operation) => {
      mocks.getActor.mockResolvedValue(null)
      expect((await adminAuthAction({ operation, email: "other@example.test", token: "123456" })).ok).toBe(false)
      expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" })
    }
  )

  it("counts setup guesses before checking proof and gives the same result when throttled", async () => {
    const command = {
      operation: "request-setup",
      email: "owner@example.test",
      proof: "incorrect-setup-proof-with-more-than-32-characters",
    }
    const wrong = await adminAuthAction(command)
    expect(mocks.allowAuthAttempt).toHaveBeenCalledWith("setup:192.0.2.1")
    expect(mocks.setupStatus).not.toHaveBeenCalled()
    mocks.allowAuthAttempt.mockResolvedValueOnce(false)
    expect(await adminAuthAction({ ...command, proof: mocks.secret })).toEqual(wrong)
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled()
  })

  it("bounds rotating send addresses without locking the same email out on another source", async () => {
    const attempts = new Map<string, number>()
    mocks.allowAuthAttempt.mockImplementation(async (key: string, limit = 5) => {
      const count = (attempts.get(key) ?? 0) + 1
      attempts.set(key, count)
      return count <= limit
    })
    for (let index = 0; index < 5; index++)
      expect((await adminAuthAction({ operation: "request-email", email: `guess${index}@example.test` })).ok).toBe(true)
    expect((await adminAuthAction({ operation: "request-email", email: "owner@example.test" })).ok).toBe(false)
    expect([...attempts.keys()]).toEqual(["send:192.0.2.1"])
    mocks.getSource.mockResolvedValue("192.0.2.2")
    expect((await adminAuthAction({ operation: "request-email", email: "owner@example.test" })).ok).toBe(true)
  })

  it("caps verification fanout before allocating per-email buckets and isolates sources", async () => {
    const attempts = new Map<string, number>()
    mocks.allowAuthAttempt.mockImplementation(async (key: string, limit = 5) => {
      const count = (attempts.get(key) ?? 0) + 1
      attempts.set(key, count)
      return count <= limit
    })
    for (let index = 0; index < 20; index++)
      await adminAuthAction({ operation: "verify-email", email: `guess${index}@example.test`, token: "123456" })
    expect(
      (await adminAuthAction({ operation: "verify-email", email: "owner@example.test", token: "123456" })).ok
    ).toBe(false)
    expect(attempts.has("verify:192.0.2.1:owner@example.test")).toBe(false)
    mocks.getSource.mockResolvedValue("192.0.2.2")
    const command = { operation: "verify-email", email: "owner@example.test", token: "123456" }
    for (let index = 0; index < 5; index++) expect((await adminAuthAction(command)).ok).toBe(true)
    expect((await adminAuthAction(command)).ok).toBe(false)
    mocks.getSource.mockResolvedValue("192.0.2.3")
    expect((await adminAuthAction(command)).ok).toBe(true)
  })

  it("rejects untrusted deployments before provisioning or verifying email", async () => {
    mocks.getSource.mockResolvedValue(null)
    expect((await adminAuthAction({ operation: "request-email", email: "owner@example.test" })).ok).toBe(false)
    expect(
      (await adminAuthAction({ operation: "verify-email", email: "owner@example.test", token: "123456" })).ok
    ).toBe(false)
    expect(mocks.allowAuthAttempt).not.toHaveBeenCalled()
    expect(mocks.signInWithOtp).not.toHaveBeenCalled()
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })

  it("clears the OTP session when a concurrent owner claim leaves this user without membership", async () => {
    mocks.claimOwner.mockResolvedValue(false)
    const result = await adminAuthAction({
      operation: "verify-setup",
      email: "owner@example.test",
      token: "123456",
      proof: mocks.secret,
    })
    expect(result.ok).toBe(false)
    expect(mocks.isActiveMember).toHaveBeenCalledWith("verified-owner")
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" })
  })

  it("keeps a session whose concurrent setup already granted active membership", async () => {
    mocks.claimOwner.mockResolvedValue(false)
    mocks.isActiveMember.mockResolvedValue(true)
    const result = await adminAuthAction({
      operation: "verify-setup",
      email: "owner@example.test",
      token: "123456",
      proof: mocks.secret,
    })
    expect(result.destination).toBe("/admin/account")
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it.each(["verify-email", "finish-passkey"])("lands %s in the private gallery", async (operation) => {
    expect((await adminAuthAction({ operation, email: "owner@example.test", token: "123456" })).destination).toBe(
      "/admin/concepts"
    )
  })

  it("fails closed without disclosing provider errors or submitted credentials", async () => {
    mocks.verifyOtp.mockRejectedValueOnce(new Error("private-provider-details"))
    const result = await adminAuthAction({ operation: "verify-email", email: "owner@example.test", token: "123456" })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain("private-provider-details")
    expect(JSON.stringify(result)).not.toContain("123456")
  })
})
